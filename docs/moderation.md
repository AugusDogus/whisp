# whisp moderation

Reports are allegations, not proof. Operators review them manually. Reporting
never attaches, copies, or preserves photos or videos. Blocking removes contact
between both accounts, including shared-group deliveries. A member cannot rename
a group while a block exists between them and another member. Unaffected members
can still rename it.

## Deletion and retention

Ordinary deletion removes the Discord ID, tokens, profile, sessions, notification
tokens, friendships, requests, blocks, policy acceptance, account-local suspension,
and reports submitted by or about the account. It also removes sent messages,
deliveries to that account, and groups it created. Other people's messages outside
those groups remain theirs. Foreign keys prevent in-flight writes from recreating
orphan records. Cloud file keys are queued atomically, without account identity,
and removed after the storage provider confirms deletion. Failed jobs retry daily.
Jobs are ordered by last attempt (or creation time before their first attempt),
so failures and newly queued files both get turns. Database retention completes
before storage requests, even when those requests fail.

Reports have a 30-day operational review window from submission, with daily purge.
Resolve promptly: resolution immediately clears free-text explanations. Deletion
of either involved account deletes the entire report. Do not copy reports into
logs, tickets, or an indefinite evidence archive. This window is an engineering
policy choice, not a statutory retention period. Revisit it if operational needs
or privacy risks change.

An ordinary suspension ends at its explicit expiry or account deletion. A report
alone never creates a deletion-surviving identifier. Only confirmed serious abuse
with a human finding of likely serious abuse on return can create an enforcement
record. It contains an HMAC of the Discord ID, key tag, random decision ID,
structured reason/necessity finding, policy revision, decision date, and expiry.
It contains no raw Discord ID, whisp user ID, email, profile, report text, media,
or report link. **The HMAC is pseudonymous personal data, not anonymous data.**

There is no default or permanent enforcement period. Choose the shortest justified
case-specific expiry after considering severity, recurrence, alternatives, age,
and impact on the person. Deletion and sign-in never extend it. Enforcement stops
at expiry even if cleanup is delayed; the daily job physically deletes the record.
Revocation immediately deletes it and every linked suspension.

## Approved policy and configuration

Augie approved this approach and its implementation. Policy revision
`2026-09-21.1` is recorded in
[abuse-retention-assessment.md](abuse-retention-assessment.md). There is no further
product-approval step. Configure `ABUSE_ENFORCEMENT_KEY` and
`ABUSE_RETENTION_POLICY_VERSION=2026-09-21.1` in the deployment and operator
CLI environment. Individual serious-abuse decisions still require human review,
necessity attestations, and explicit expiry. Ordinary reporting, blocking,
deletion, and account-local suspensions work without an enforcement key.

Generate a dedicated random key of at least 32 bytes in the environment's secret
store. Do not reuse OAuth/auth secrets or log the key, Discord IDs, or fingerprints.
Keep the key stable while records are active. Missing or changed keys fail new
session safety checks closed when active records exist. Restore the correct key
instead of disabling checks. A planned rotation must wait for expiry or explicitly
revoke old decisions after review. Production and previews use separate keys.
New preview database initialization removes copied production enforcement records
and linked suspensions before deployment. Redeployments preserve decisions made
within the preview. Never copy the production key into previews.

## Operator workflow

Only operators with database credentials can use the CLI. There is no public admin
endpoint. Run against the intended environment with its database and retention
configuration. Commands print JSON and never execute submitted report text.
The configured operator keys are also stored locally in mode-0600 files under
`~/.config/whisp/enforcement-production.env` and `enforcement-preview.env`.
Load the matching file with Bun's `--env-file` option and supply that environment's
database credentials separately. Never commit or print these files.

```sh
bun packages/api/src/moderation/cli.ts list
bun packages/api/src/moderation/cli.ts show REPORT_ID
bun packages/api/src/moderation/cli.ts resolve REPORT_ID dismiss
bun packages/api/src/moderation/cli.ts resolve REPORT_ID suspend EXPIRY_ISO
bun packages/api/src/moderation/cli.ts enforce REPORT_ID REASON EXPIRY_ISO confirmed-necessary-proportionate
bun packages/api/src/moderation/cli.ts restore USER_ID
bun packages/api/src/moderation/cli.ts enforcements
bun packages/api/src/moderation/cli.ts revoke ENFORCEMENT_ID
```

`EXPIRY_ISO` must be a future timestamp with timezone. Enforcement reasons are
`child_safety`, `credible_threat`, `nonconsensual_intimate_content`, and
`repeated_severe_harassment`. The final argument explicitly attests to confirmed
serious abuse, necessity despite deletion, insufficiency of a shorter period,
and consideration of the person's rights and age. Never infer those findings
from a report category. Active decisions cannot be silently overwritten or extended.

Suspended users can sign in, delete their accounts, block/report, and contact
augie@luebbers.email to appeal or object to retention. `restore USER_ID` also
revokes linked enforcement. After deletion use the decision ID with `revoke`.
To locate a decision for an authenticated erasure/appeal request, `lookup` reads
the Discord ID from standard input and prints only decision ID, reason, and expiry.
Keep that input out of shell history and logs. Verify identity proportionately,
reassess necessity, and respond with the outcome and reasons. Do not require a user
to recreate their whisp account to object. Do not automatically deny erasure requests.
No emails or external reports are sent by this tool.

## Release and operations

1. Apply migrations through `0004_file_deletion_attempts.sql`. The migrations preserve
   valid data, remove old orphan rows, queue known orphan media keys, and delete
   reports whose account references were already cleared.
2. Deploy server and privacy/terms changes with the mobile build. Accounts must
   accept policy version `2026-09-21.1` before sharing. Terms are a dedicated onboarding
   screen, also available from Profile. Users can decline and still access account
   deletion, blocking, and reporting; sharing remains restricted until acceptance.
3. Configure `CRON_SECRET` for the existing daily cleanup route. Missing credentials
   now return 401. Monitor failures and queue age; a 503 means file deletion jobs
   remain pending. Storage failures must be investigated, not treated as success.
4. Establish restricted backup lifetimes and a restore procedure that reapplies
   deletions and expiry before serving traffic. The application cannot purge
   provider backups or independently managed analytics/support systems. Resolve
   those operational retention details before claiming full deletion compliance.
5. Establish staffed review, child-safety escalation/legal reporting, the external
   deletion-request page, and accurate Play Data safety declarations before launch.

Do not ask users to forward illegal material. This implementation does not itself
establish GDPR compliance or guarantee store approval.
