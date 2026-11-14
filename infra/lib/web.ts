import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import {
  CachePolicy,
  Distribution,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { CfnAPIKey, CfnMap } from 'aws-cdk-lib/aws-location';
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

/** Private S3 + CloudFront (OAC, SPA fallback, security headers) + Amazon Location map & key. */
export class Web extends Construct {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly url: string;
  readonly mapName: string;
  readonly mapApiKey: string;

  constructor(
    scope: Construct,
    id: string,
    private readonly props: { stage: Stage },
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
      `connect-src 'self' https://*.execute-api.${region}.amazonaws.com https://cognito-idp.${region}.amazonaws.com https://maps.geo.${region}.amazonaws.com`,
      'worker-src blob:',
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
    });

    this.distribution = new Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
      },
      defaultRootObject: 'index.html',
      // SPA fallback: client-side routes resolve to index.html.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      })),
      // TLS policy is fixed by the default *.cloudfront.net cert; set minimumProtocolVersion with a custom domain.
      priceClass: PriceClass.PRICE_CLASS_100,
      httpVersion: HttpVersion.HTTP2_AND_3,
    });
    this.url = `https://${this.distribution.distributionDomainName}`;

    // ---- Amazon Location: map + API key limited to map reads from our origins.
    const map = new CfnMap(this, 'Map', {
      mapName: `freeroom-${props.stage}`,
      configuration: { style: 'VectorEsriNavigation' },
    });
    this.mapName = map.mapName;
    const key = new CfnAPIKey(this, 'MapKey', {
      keyName: `freeroom-${props.stage}-maps`,
      noExpiry: true,
      restrictions: {
        allowActions: ['geo:GetMap*'],
        allowResources: [map.attrArn],
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

  /** Upload the SPA build + a generated runtime config.json (never cached). */
  deploy(config: { apiUrl: string; userPoolId: string; clientId: string; demoMode: boolean }) {
    const site = existsSync(join(WEB_DIST, 'index.html'))
      ? Source.asset(WEB_DIST)
      : Source.data(
          'index.html',
          '<!doctype html><title>FreeRoom</title><p>Build apps/web first.</p>',
        );
    new BucketDeployment(this, 'Assets', {
      sources: [site],
      destinationBucket: this.bucket,
      exclude: ['config.json'],
      distribution: this.distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });
    new BucketDeployment(this, 'Config', {
      sources: [
        Source.jsonData('config.json', {
          ...config,
          region: Stack.of(this).region,
          mapName: this.mapName,
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
