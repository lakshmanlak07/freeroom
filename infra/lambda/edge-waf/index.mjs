// CloudFormation custom resource: a CLOUDFRONT-scope WAF WebACL. CloudFront WebACLs live in
// us-east-1, where this account's SCP denies CloudFormation, but allows the WAF API itself; so
// the (us-east-2) stack creates it through this function instead of a us-east-1 stack.
// Plain .mjs on purpose: the Node 20 runtime ships @aws-sdk/client-wafv2, so no bundling/deps.
import {
  CreateWebACLCommand,
  DeleteWebACLCommand,
  GetWebACLCommand,
  UpdateWebACLCommand,
  WAFV2Client,
} from '@aws-sdk/client-wafv2';

import { spec } from './spec.mjs';

const waf = new WAFV2Client({ region: 'us-east-1' });
const Scope = 'CLOUDFRONT';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const handler = async (event) => {
  const props = event.ResourceProperties;
  if (event.RequestType === 'Create') {
    const r = await waf.send(new CreateWebACLCommand({ Name: props.Name, Scope, ...spec(props) }));
    return { PhysicalResourceId: `${r.Summary.Id}|${props.Name}`, Data: { Arn: r.Summary.ARN } };
  }
  const [Id, Name] = event.PhysicalResourceId.split('|');
  const get = () => waf.send(new GetWebACLCommand({ Id, Name, Scope }));
  if (event.RequestType === 'Update') {
    const g = await get();
    await waf.send(
      new UpdateWebACLCommand({ Id, Name, Scope, LockToken: g.LockToken, ...spec(props) }),
    );
    return { PhysicalResourceId: event.PhysicalResourceId, Data: { Arn: g.WebACL.ARN } };
  }
  // Delete: CloudFront detaches the ACL asynchronously after the distribution changes.
  for (let i = 0; i < 40; i++) {
    try {
      const g = await get();
      await waf.send(new DeleteWebACLCommand({ Id, Name, Scope, LockToken: g.LockToken }));
      return { PhysicalResourceId: event.PhysicalResourceId };
    } catch (e) {
      if (e.name === 'WAFNonexistentItemException')
        return { PhysicalResourceId: event.PhysicalResourceId };
      if (e.name !== 'WAFAssociatedItemException' && e.name !== 'WAFOptimisticLockException')
        throw e;
      await sleep(20_000);
    }
  }
  throw new Error(`WebACL ${Name} is still associated with a distribution`);
};
