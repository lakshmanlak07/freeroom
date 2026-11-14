import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import {
  AccountRecovery,
  OAuthScope,
  ProviderAttribute,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolIdentityProviderSaml,
  UserPoolIdentityProviderSamlMetadata,
} from 'aws-cdk-lib/aws-cognito';
import type { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { apiFn, devOrigins, grantTable, type Stage } from './fn';

/** Cognito email/password (+ optional campus SAML) with the pre-token role/registered claims. */
export class Auth extends Construct {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly preTokenFn: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: { stage: Stage; table: Table; webUrl: string; samlMetadataUrl?: string },
  ) {
    super(scope, id);
    const prod = props.stage === 'prod';

    this.preTokenFn = apiFn(this, 'PreTokenFn', {
      stage: props.stage,
      entry: 'preToken.ts',
      timeoutSec: 5,
      memoryMb: 256,
      environment: { TABLE_NAME: props.table.tableName },
    });
    grantTable(this.preTokenFn, props.table, ['GetItem'], ['USER#*']);

    this.userPool = new UserPool(this, 'Users', {
      userPoolName: `freeroom-${props.stage}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      lambdaTriggers: { preTokenGeneration: this.preTokenFn },
      deletionProtection: prod,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Campus SSO is configuration, not code (PRD §0.1): pass -c samlMetadataUrl=... to enable.
    const saml = props.samlMetadataUrl
      ? new UserPoolIdentityProviderSaml(this, 'CampusSaml', {
          userPool: this.userPool,
          name: 'Campus',
          metadata: UserPoolIdentityProviderSamlMetadata.url(props.samlMetadataUrl),
          attributeMapping: { email: ProviderAttribute.other('urn:oid:0.9.2342.19200300.100.1.3') },
        })
      : undefined;
    if (saml)
      this.userPool.addDomain('Domain', {
        cognitoDomain: { domainPrefix: `freeroom-${props.stage}-campus` },
      });

    this.client = this.userPool.addClient('WebClient', {
      userPoolClientName: 'web',
      authFlows: { userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
        ...(saml ? [UserPoolClientIdentityProvider.custom('Campus')] : []),
      ],
      ...(saml
        ? {
            oAuth: {
              flows: { authorizationCodeGrant: true },
              scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
              callbackUrls: [`${props.webUrl}/`, ...devOrigins(props.stage, '/')],
              logoutUrls: [`${props.webUrl}/`, ...devOrigins(props.stage, '/')],
            },
          }
        : { disableOAuth: true }),
    });
    if (saml) this.client.node.addDependency(saml);
  }
}
