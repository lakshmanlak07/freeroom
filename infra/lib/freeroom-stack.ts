import { Stack, Tags, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface FreeRoomStackProps extends StackProps {
  stage: 'dev' | 'prod';
}

/** The ONE FreeRoom stack (CLAUDE.md). Resources land in P4. */
export class FreeRoomStack extends Stack {
  constructor(scope: Construct, id: string, props: FreeRoomStackProps) {
    super(scope, id, props);
    Tags.of(this).add('app', 'freeroom');
    Tags.of(this).add('stage', props.stage);
  }
}
