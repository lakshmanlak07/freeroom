import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  FunctionCode,
  FunctionEventType,
  Function as CfFunction,
  OriginRequestPolicy,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { CfnAPIKey } from 'aws-cdk-lib/aws-location';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, devOrigins, type Stage } from './fn';

const WEB_DIST = join(ROOT, 'apps/web/dist');

/**
 * Private S3 + CloudFront (OAC, SPA fallback, security headers, optional WAF) + Amazon Location.
 * The API is served from the same distribution under /api/* so the WAF covers it too.
 */
export class Web extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly url: string;
  readonly mapApiKey: string;
  private headers!: ResponseHeadersPolicy;

  constructor(
    scope: Construct,
    id: string,
    private readonly props: { stage: Stage; webAclArn?: string },
  ) {
    super(scope, id);
    const prod = props.stage === 'prod';
    const region = Stack.of(this).region;

    this.bucket = new Bucket(this, 'Site', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !prod,
    });

    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'", // MapLibre sets inline styles
      `img-src 'self' data: blob: https://maps.geo.${region}.amazonaws.com`,
      "font-src 'self' data:",
      // API is same-origin (/api/*); Cognito for sign-in; Location v2 style/tiles/glyphs/sprites.
      `connect-src 'self' https://cognito-idp.${region}.amazonaws.com https://maps.geo.${region}.amazonaws.com`,
      // maplibre's worker is a hashed same-origin asset; blob: for its classic-worker fallback.
      "worker-src 'self' blob:",
      'child-src blob:',
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    const headers = new ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
      // Only geolocation (the map's opt-in Near me) is ever used, and only by our own origin.
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value:
              'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
            override: true,
          },
        ],
      },
    });

    this.headers = headers;
    // SPA fallback as a viewer-request rewrite (not distribution error pages, which would also
    // rewrite the API's 403/404 JSON into index.html).
    const spa = new CfFunction(this, 'SpaRewrite', {
      code: FunctionCode.fromInline(
        String.raw`function handler(e){var r=e.request;if(!/\.[A-Za-z0-9]+$/.test(r.uri))r.uri='/index.html';return r;}`,
      ),
    });
    this.distribution = new Distribution(this, 'Cdn', {
      webAclId: props.webAclArn,
      defaultBehavior: {
        functionAssociations: [{ function: spa, eventType: FunctionEventType.VIEWER_REQUEST }],
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
      },
      defaultRootObject: 'index.html',
      // TLS policy is fixed by the default *.cloudfront.net cert; set minimumProtocolVersion with a custom domain.
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
    });
    this.url = `https://${this.distribution.distributionDomainName}`;

    // Amazon Location Maps API v2: no map resource; the key reads the AWS-provided basemap.
    const key = new CfnAPIKey(this, 'MapKey', {
      keyName: `freeroom-${props.stage}-maps`,
      noExpiry: true,
      // Location refuses restriction changes on a recently used key without this (v1 → v2 move).
      forceUpdate: true,
      restrictions: {
        allowActions: ['geo-maps:GetTile', 'geo-maps:GetStaticMap'],
        allowResources: [`arn:aws:geo-maps:${region}::provider/default`],
        allowReferers: [`${this.url}/*`, ...devOrigins(props.stage, '/*')],
      },
    });
    const keyValue = new AwsCustomResource(this, 'MapKeyValue', {
      onUpdate: {
        service: 'Location',
        action: 'DescribeKey',
        parameters: { KeyName: key.keyName },
        physicalResourceId: PhysicalResourceId.of(key.keyName),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [key.attrKeyArn] }),
      installLatestAwsSdk: false,
    });
    keyValue.node.addDependency(key);
    this.mapApiKey = keyValue.getResponseField('Key');
  }

  /** /api/* → the HTTP API (prefix stripped), never cached, all viewer headers incl. Authorization. */
  routeApi(httpApi: HttpApi, originVerify: string): string {
    const strip = new CfFunction(this, 'ApiPrefixStrip', {
      code: FunctionCode.fromInline(
        // Also tells the API its public origin (invite links); overwrites anything a client sent.
        String.raw`function handler(e){var r=e.request;r.uri=r.uri.replace(/^\/api/,'')||'/';r.headers['x-freeroom-origin']={value:'https://'+r.headers.host.value};return r;}`,
      ),
    });
    this.distribution.addBehavior(
      '/api/*',
      new HttpOrigin(`${httpApi.apiId}.execute-api.${Stack.of(this).region}.amazonaws.com`, {
        customHeaders: { 'x-origin-verify': originVerify },
      }),
      {
        viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: this.headers,
        functionAssociations: [{ function: strip, eventType: FunctionEventType.VIEWER_REQUEST }],
      },
    );
    return `${this.url}/api`;
  }

  /** Upload the SPA build + a generated runtime config.json (never cached). */
  deploy(config: {
    apiUrl: string;
    userPoolId: string;
    clientId: string;
    demoMode: boolean;
    /** Prod landing "Try the live demo" target (the dev site). */
    demoUrl?: string;
    /** Feature flags read by the SPA. */
    features: { directions: boolean; invites: boolean };
  }) {
    const site = existsSync(join(WEB_DIST, 'index.html'))
      ? Source.asset(WEB_DIST)
      : Source.data(
          'index.html',
          '<!doctype html><title>FreeRoom</title><p>Build apps/web first.</p>',
        );
    new BucketDeployment(this, 'Assets', {
      sources: [site],
      destinationBucket: this.bucket,
      // demo-logins.json: uploaded to the dev bucket only, after deploy (never in git).
      exclude: ['config.json', 'demo-logins.json'],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });
    new BucketDeployment(this, 'Config', {
      sources: [
        Source.jsonData('config.json', {
          ...config,
          region: Stack.of(this).region,
          mapApiKey: this.mapApiKey,
        }),
      ],
      destinationBucket: this.bucket,
      prune: false,
      cacheControl: [CacheControl.noCache()],
      distribution: this.distribution,
      distributionPaths: ['/config.json'],
    });
  }
}
