# FreeRoom runbook

Region **us-east-2**. Stacks `FreeRoom-dev` and `FreeRoom-prod`. The dashboard is CloudWatch →
Dashboards → `FreeRoom-<stage>`. Alarms email the SNS topic set by `alarmEmail` (DEPLOY.md), and
every alarm also emails when it returns to OK.

**First move for any incident:** open the dashboard, then trace a request. Every API response
carries `x-correlation-id`. The same id is stamped on the DynamoDB audit event, so it appears in
the stream notifier's logs too. In CloudWatch Logs Insights (select the `ApiFn`, `RevealFn` and
`OnChangeFn` log groups):

```
fields @timestamp, level, msg, path, status, correlationId, reservationId
| filter correlationId = "<id>"
| sort @timestamp asc
```

Logs never contain contact details, University IDs or tokens. They're redacted at the source.

## Alarms: what they mean and what to do

| Alarm (`freeroom-<stage>-…`)                                                    | Fires when                                                                                           | Do this                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Api5xxRate`                                                                    | > 2% of API requests return 5xx in 5 min (only once there are ≥ 20 requests)                         | 1. Logs Insights on `ApiFn`: `filter level = "error"`. Look for `unhandled` lines with the error name. 2. Recent deploy? Roll back by re-running _Deploy_ with the previous tag (prod), or revert on `main` (dev). 3. DynamoDB throttling or KMS errors → check those service metrics.                                                                                                                                           |
| `<Function>Errors` (ApiFn, RevealFn, SweeperFn, SyncFn, OnChangeFn, PreTokenFn) | Any invocation error in 5 min                                                                        | Open that function's log group and filter `level = "error"`. **PreTokenFn** errors block sign-in: fix first. **SweeperFn** errors pause auto-release and staleness reporting. BR-6 still holds: confirm and approve are refused after the cutoff at write time.                                                                                                                                                                  |
| `SyncFailedTwice`                                                               | Two 25Live sync runs in a row reported failure                                                       | `SyncFn` logs → `sync.finished` lines (status, error count) and any `errors[]`. Credentials expired? → update the `25live` secret (below). 25Live down? → nothing to do. The app serves the last synced schedule, and class locks from the last good sync still protect BR-1. Re-run by hand: `aws lambda invoke --function-name <SyncFnName> /dev/stdout`.                                                                      |
| `ScheduleStale`                                                                 | The newest successful sync is > 60 min old for 5 straight minutes (or the sweeper stopped reporting) | Same as above. If `SyncFn` isn't running at all, check the EventBridge Scheduler schedules `SyncDaytime` / `SyncOvernight` (state `ENABLED`) and the Lambda concurrency limit (the account limit is 10).                                                                                                                                                                                                                         |
| `StreamDlqNotEmpty`                                                             | onChange gave up on a stream batch (after 2 retries + bisect)                                        | 1. `OnChangeFn` logs around the message timestamp for the error. 2. The DLQ message holds the shard and sequence range, not the records. Stream records expire after 24 h. 3. Users can still see every change in-app (reservation status, claim status, event history). Only the in-app notification for that batch is missing. 4. Fix the cause and redeploy, then purge: `aws sqs purge-queue --queue-url <OnChangeDlq URL>`. |

WAF (prod): the dashboard's _WAF (CloudFront)_ widget shows allowed and blocked counts and
rate-limit blocks. If a venue's shared IP is being blocked during a demo, raise the limit and
redeploy prod with `-c wafRateLimit=1000`.

## Force-release a reservation

An ADMIN may cancel any reservation. This frees its slot locks and writes a `CANCELLED` audit
event with the admin as actor.

- **Dev:** sign in as `admin1` → **Demo** → pick the room/day → the reservation → _Fast-forward
  to cutoff_ (releases it if unconfirmed), or _Inject class conflict_ (BR-9 path with
  alternatives).
- **Any stage, API:** with an admin's ID token (from the browser's local storage after signing
  in):

  ```bash
  curl -X DELETE -H "Authorization: Bearer $ID_TOKEN" "$WEB_URL/api/reservations/<reservationId>"
  ```

- **Make someone an admin.** Roles live only in our table, never in self-service. Find their
  Cognito `sub`, then:

  ```bash
  aws dynamodb update-item --table-name <TableName> \
    --key '{"PK":{"S":"USER#<sub>"},"SK":{"S":"PROFILE"}}' \
    --update-expression "SET #r = :a" --expression-attribute-names '{"#r":"role"}' \
    --expression-attribute-values '{":a":{"S":"ADMIN"}}'
  ```

  The new role applies on their next token refresh (sign out and back in).

## Rotate secrets

| Secret                                            | How                                                                                                                                    | Notes                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `freeroom/<stage>/25live`                         | `aws secretsmanager put-secret-value --secret-id freeroom/<stage>/25live --secret-string '{"baseUrl":…,"username":…,"password":…}'`    | Picked up by the next sync; no deploy needed. Issued by UMass IT.                                                                                                                                                                                        |
| `freeroom/<stage>/test-users` (demo/smoke logins) | Remove the user's entry from the secret JSON, then re-run postDeploy (`pnpm run deploy -- --stage <stage>`, or push to `main` for dev) | postDeploy sets a fresh Cognito password for any missing entry.                                                                                                                                                                                          |
| KMS CMK `alias/freeroom-<stage>-pii`              | Automatic rotation is on. On demand: `aws kms rotate-key-on-demand --key-id alias/freeroom-<stage>-pii`                                | Old key material stays available for existing ciphertext; no re-encryption needed.                                                                                                                                                                       |
| `freeroom/<stage>/uid-pepper`                     | **Only if compromised.** Put a new random value, then delete all `UID#*` items                                                         | Every stored University-ID hash becomes unmatchable. Deleting `UID#*` lets everyone register their ID again (profiles and reservations are untouched). The HMAC still hides IDs if the pepper leaks, but brute-forcing short IDs gets easier, so rotate. |
| Amazon Location API key                           | Change `keyName` in `infra/lib/web.ts` and redeploy (CDK replaces the key; `config.json` picks up the new value)                       | The key is limited to map reads from our origin.                                                                                                                                                                                                         |
| Cognito user password                             | `aws cognito-idp admin-set-user-password --user-pool-id <id> --username <email> --password '<new>' --permanent`                        |                                                                                                                                                                                                                                                          |
| GitHub → AWS                                      | Nothing to rotate: OIDC tokens are per run and short-lived. To revoke, edit or delete the `freeroom-<stage>-github-deploy` role trust. |                                                                                                                                                                                                                                                          |

## Restore DynamoDB from PITR

PITR is on for both stages (35-day window). A restore always creates a **new** table.

1. Pick the restore time (UTC, before the bad write) and restore:

   ```bash
   SRC=$(jq -r '."FreeRoom-prod".TableName' infra/cdk-outputs.prod.json)
   DST="$SRC-restore-$(date +%Y%m%d%H%M)"
   aws dynamodb restore-table-to-point-in-time \
     --source-table-name "$SRC" --target-table-name "$DST" \
     --restore-date-time 2026-11-15T14:30:00Z
   aws dynamodb wait table-exists --table-name "$DST"
   ```

   The restored table has no stream, TTL or PITR settings. That's fine for inspection.

2. Inspect it (`aws dynamodb get-item` / `query` on the affected `RES#…` / `USER#…` keys).
3. Recover:
   - **A few items:** copy them back into the live table with `aws dynamodb put-item`. This goes
     through the stream, so notifications fire as if they were new events.
   - **Full rollback:** in a quiet window, disable the `SweepEveryMinute`, `SyncDaytime` and
     `SyncOvernight` schedules, scan the restored table and `batch-write-item` into the live
     table, then re-enable the schedules. The live table keeps its CDK-managed settings (stream,
     TTL, GSIs, PITR, deletion protection).
4. Delete the restored table when done: `aws dynamodb delete-table --table-name "$DST"`.

Prod has deletion protection, and the stack keeps the table on delete, so a bad `cdk destroy` or
stack replacement can't drop it.

## Routine checks

- After each prod deploy, the pipeline's smoke job must be green: login, search, reserve,
  claim → approve → reveal, map, and axe with 0 serious violations.
- Weekly: daytime staleness on the dashboard < 15 min, the DLQ empty, no alarm flapping.
