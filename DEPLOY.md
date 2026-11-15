# Deploying FreeRoom

One CDK stack per stage (`FreeRoom-dev`, `FreeRoom-prod`) in **us-east-2**. That region is fixed
because the hackathon AWS account's SCP allows only Ohio; pass `-c region=…` in an unrestricted
account. After the first manual deploy, everything ships through GitHub Actions with OIDC
(no AWS keys anywhere).

## 1. Prerequisites

- Node ≥ 22.19 (CI uses 24) and pnpm (the version is pinned in `package.json → packageManager`):
  `corepack enable`.
- AWS CLI v2 ≥ 2.32 for `aws login` (short-lived credentials). Check with
  `aws sts get-caller-identity`.
- `pnpm install` at the repo root.

## 2. First-time setup (once per AWS account)

These first deploys run locally because they create the GitHub deploy roles that the pipeline
uses afterwards.

```bash
aws login
pnpm --filter @freeroom/infra exec cdk bootstrap aws://<ACCOUNT_ID>/us-east-2
# prod gets its own bootstrap, so the dev deploy role can never assume prod's deploy roles
pnpm --filter @freeroom/infra exec cdk bootstrap aws://<ACCOUNT_ID>/us-east-2 --qualifier frprod --toolkit-stack-name CDKToolkit-frprod -c stage=prod
```

Deploy dev **first**. It creates the account-wide GitHub OIDC provider that prod imports.

```bash
pnpm run deploy -- --stage dev  -c alarmEmail=<you@example.com>
pnpm run deploy -- --stage prod -c alarmEmail=<you@example.com>
```

In an OIDC-capable account, add `-c githubOidc=true` to both commands (dev first: it creates
the account-wide OIDC provider).

`deploy` builds the web app, runs `cdk deploy`, then `infra/scripts/postDeploy.ts`, which does
three things:

1. Runs the first 25Live sync (catalog + 14 days of classes).
2. Creates the test users: demo users in dev, and `smoke1`/`smoke2` in every stage. Their logins
   go to the `freeroom/<stage>/test-users` secret.
3. Seeds the demo data (dev only, first run only).

**Confirm the two SNS emails** ("AWS Notification – Subscription Confirmation"), or alarms won't
reach you.

Outputs are in `infra/cdk-outputs.<stage>.json` (gitignored): `WebUrl`, `DeployRoleArn`,
`DashboardName`, `TestUsersSecretArn`, and more.

### Connect GitHub (needs an account that allows GitHub OIDC)

The GitHub deploy roles are created only with `-c githubOidc=true`. The hackathon account's SCP
denies `iam:CreateOpenIDConnectProvider`, so there FreeRoom is deployed from a maintainer
machine with the commands above, while CI (lint, tests, audit, cdk-nag) still runs on GitHub. In
an account that allows OIDC, deploy once with `-c githubOidc=true` and then:

```bash
gh variable set AWS_DEV_ROLE_ARN  --body "$(jq -r '."FreeRoom-dev".DeployRoleArn'  infra/cdk-outputs.dev.json)"
gh variable set AWS_PROD_ROLE_ARN --body "$(jq -r '."FreeRoom-prod".DeployRoleArn' infra/cdk-outputs.prod.json)"
gh variable set ALARM_EMAIL --body "<you@example.com>"
gh api -X PUT repos/<owner>/<repo>/environments/prod   # the prod role trusts only this environment
```

If the repo isn't `lakshmanlak07/freeroom`, deploy once with `-c githubRepo=<owner>/<repo>` so
the role trust matches.

## 3. The pipeline (`.github/workflows/deploy.yml`)

| Trigger                                               | What happens                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push to `main`                                        | CI (lint, typecheck, tests against DynamoDB Local, `pnpm audit`, cdk-nag) → **deploy dev** → Playwright smoke + axe + Lighthouse against the dev URL |
| Push tag `v*`                                         | CI → **prod plan** (`cdk diff` in the run summary)                                                                                                   |
| Actions → Deploy → _Run workflow_ with `tag = vX.Y.Z` | **Deploy prod** from that tag → Playwright smoke + axe against prod                                                                                  |

The manual _Run workflow_ is the prod approval gate. GitHub Free doesn't offer required reviewers
on private repositories, and only collaborators with write access can dispatch a workflow. With
GitHub Pro/Team, add a required reviewer to the `prod` environment as well.

Typical release:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Read the prod plan in the run summary, then dispatch _Deploy_ with `tag=v1.0.1`.

## 4. Secrets and configuration

| Where            | Name                                                   | Content                             | Set by                                                      |
| ---------------- | ------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------- |
| Secrets Manager  | `freeroom/<stage>/uid-pepper`                          | 64-char HMAC pepper                 | Generated by CDK. **Never rotate casually** (see RUNBOOK)   |
| Secrets Manager  | `freeroom/<stage>/25live`                              | `{"baseUrl","username","password"}` | You, when UMass IT grants access (empty = seeded mock data) |
| Secrets Manager  | `freeroom/<stage>/test-users`                          | Demo/smoke logins                   | postDeploy                                                  |
| KMS              | `alias/freeroom-<stage>-pii`                           | Contact-info CMK (rotation on)      | CDK                                                         |
| GitHub variables | `AWS_DEV_ROLE_ARN`, `AWS_PROD_ROLE_ARN`, `ALARM_EMAIL` | See above                           | You                                                         |

No GitHub _secrets_ are needed. AWS access is OIDC, and test logins are read from Secrets
Manager at run time and masked in logs.

CDK context flags (`-c key=value`):

| Flag              | Default                        | Meaning                                         |
| ----------------- | ------------------------------ | ----------------------------------------------- |
| `stage`           | required                       | `dev` or `prod`                                 |
| `alarmEmail`      | none                           | SNS email for every alarm                       |
| `demoMode`        | `true` in dev, `false` in prod | Demo Controls + demo users. **Refused in prod** |
| `waf`             | `true` in prod, `false` in dev | CloudFront WAF (about $8/month)                 |
| `wafRateLimit`    | `300`                          | Requests per 5 min per IP on `/api/*`           |
| `githubRepo`      | `lakshmanlak07/freeroom`       | Repo trusted by the deploy role                 |
| `samlMetadataUrl` | none                           | Turns on campus SSO (below)                     |
| `region`          | `us-east-2`                    | Deployment region                               |

## 5. SES identity (email notifications)

v1 sends **in-app notifications only**. Email needs the recipient's address, which is
KMS-encrypted, and by design only RevealFn may decrypt it (BR-5). To turn email on:

1. SES (us-east-2) → _Verified identities_ → create a **domain** identity, publish the three DKIM
   CNAMEs, and add SPF/DMARC records.
2. Request **production access** (SES starts in the sandbox, which only sends to verified
   addresses).
3. Code change (v1.1): give a dedicated mailer function `kms:Decrypt` with an encryption-context
   condition, or route sends through RevealFn. Then set `SES_FROM` on it. Update the stack test
   that asserts RevealFn is the only decrypter, and SECURITY.md.

The notifier already supports `SES_FROM` (`services/api/src/notify/onChange.ts`). It logs only
error names on failure, never addresses.

## 6. Switch on real 25Live

1. Put the credentials UMass IT gives you into the secret (the next sync picks them up; no
   deploy needed):

   ```bash
   aws secretsmanager put-secret-value --secret-id freeroom/prod/25live \
     --secret-string '{"baseUrl":"https://<host>/25live/data/<inst>/run","username":"…","password":"…"}'
   ```

2. Trigger a sync right away instead of waiting up to 10 minutes:

   ```bash
   aws lambda invoke --function-name "$(jq -r '."FreeRoom-prod".SyncFnName' infra/cdk-outputs.prod.json)" /dev/stdout
   ```

3. Check the result on the dashboard (`SyncSuccess` = 1, `ScheduleStalenessMinutes` falling) and
   in the sync logs.
4. Field mapping lives only in `services/api/src/twentyfive/mapper.ts`, and every assumed field
   name has a `TODO`. Verify them against a real response and adjust that one file.

The client is rate-limited with backoff. If 25Live is down, the app keeps serving the last synced
schedule, and the `ScheduleStale` alarm fires after 60 minutes.

## 7. Switch on campus SAML SSO

1. Ask UMass IT for the IdP **metadata URL**. Give them these SP details:
   - Entity ID: `urn:amazon:cognito:sp:<UserPoolId>` (from the outputs)
   - ACS (reply) URL: `https://freeroom-<stage>-campus.auth.us-east-2.amazoncognito.com/saml2/idpresponse`
   - Required attribute: `mail` (`urn:oid:0.9.2342.19200300.100.1.3`), mapped to email
2. Deploy with the metadata URL:

   ```bash
   pnpm run deploy -- --stage prod -c samlMetadataUrl=https://idp.umass.edu/…/metadata
   ```

   This adds the `Campus` identity provider, the Cognito hosted domain and the OAuth code flow
   (callback = the site URL).

3. Users still complete `/register` once (University ID → HMAC) after their first SSO sign-in.

## 8. Custom domain (optional)

Request an ACM certificate **in us-east-1**. That needs the SCP to allow ACM there, or an
unrestricted account. Then add `domainNames` + `certificate` and
`minimumProtocolVersion: TLSv1.2_2021` to the distribution in `infra/lib/web.ts`, and point DNS at
CloudFront.

## Cost (demo scale)

Within the free tier except the prod WAF: about $5 for the WebACL + $1 per rule + $0.60 per
million requests, so roughly $8/month. KMS is $1/month per key per stage. Secrets Manager is
$0.40 per secret per month.
