import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  StreamViewType,
  Table,
} from 'aws-cdk-lib/aws-dynamodb';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { TABLE } from '../../services/api/src/data/schema';
import type { Stage } from './fn';

/** Single table (schema shared with the app), PII CMK, UID pepper, 25Live credentials. */
export class Data extends Construct {
  readonly table: Table;
  readonly piiKey: Key;
  readonly pepper: Secret;
  readonly twentyFiveLive: Secret;
  readonly testUsers: Secret;

  constructor(scope: Construct, id: string, props: { stage: Stage }) {
    super(scope, id);
    const prod = props.stage === 'prod';
    const removalPolicy = prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const s = (name: string) => ({ name, type: AttributeType.STRING });

    this.table = new Table(this, 'Table', {
      partitionKey: s(TABLE.partitionKey),
      sortKey: s(TABLE.sortKey),
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: TABLE.ttlAttribute,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: prod,
      removalPolicy,
    });
    for (const g of TABLE.gsis) {
      this.table.addGlobalSecondaryIndex({
        indexName: g.indexName,
        partitionKey: s(g.partitionKey),
        sortKey: s(g.sortKey),
        projectionType: ProjectionType.ALL,
      });
    }

    this.piiKey = new Key(this, 'PiiKey', {
      alias: `alias/freeroom-${props.stage}-pii`,
      description: 'FreeRoom contact-info envelope encryption (BR-5)',
      enableKeyRotation: true,
      pendingWindow: Duration.days(prod ? 30 : 7),
      removalPolicy,
    });

    this.pepper = new Secret(this, 'UidPepper', {
      secretName: `freeroom/${props.stage}/uid-pepper`,
      description: 'HMAC pepper for University IDs',
      generateSecretString: { passwordLength: 64, excludePunctuation: true, includeSpace: false },
      removalPolicy,
    });

    // Demo + smoke-test logins, written by postDeploy, read by the Playwright smoke (CI + local).
    this.testUsers = new Secret(this, 'TestUsers', {
      secretName: `freeroom/${props.stage}/test-users`,
      description: 'Demo/smoke Cognito logins {"<userId>":{"email","password"}} (postDeploy).',
      secretObjectValue: {},
      removalPolicy,
    });

    this.twentyFiveLive = new Secret(this, 'TwentyFiveLive', {
      secretName: `freeroom/${props.stage}/25live`,
      description:
        'Empty until UMass IT grants access. Fill with {"baseUrl","username","password"}.',
      secretObjectValue: {},
      removalPolicy,
    });
  }
}
