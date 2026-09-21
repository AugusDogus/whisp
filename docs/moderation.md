# whisp moderation

Reports identify the reporter, the reported account, a reason, and an optional
explanation. Reporting never attaches, copies, or preserves photos or videos.
Blocking removes the friendship, pending requests, and outstanding deliveries
between the accounts, including shared-group deliveries. Unblocking does not
restore those records. Other group members can still communicate normally.

## Operator workflow

Only an operator with database credentials can use the queue. There is no public
admin endpoint or client-supplied admin flag. Run from the repository root with
the intended environment's `DATABASE_URL` and `DATABASE_TOKEN` configured:

```sh
bun packages/api/src/moderation/cli.ts list
bun packages/api/src/moderation/cli.ts show REPORT_ID
bun packages/api/src/moderation/cli.ts resolve REPORT_ID dismiss
bun packages/api/src/moderation/cli.ts resolve REPORT_ID suspend
bun packages/api/src/moderation/cli.ts restore USER_ID
```

Review the queue regularly, prioritize child-safety and credible threat reports,
and assess reports before taking action. Reports are allegations, not proof.
Suspension prevents sending media, sending/accepting friend requests, and creating
or modifying groups. It also hides the account's messages from inboxes. Account
settings, deletion, blocking, and reporting remain available. Appeals go to
augie@luebbers.email. No automatic emails or external reports are sent by this tool.

Do not paste report explanations into shared logs or tickets. Do not ask users
to forward illegal material. Establish the required escalation and legal reporting
process for child-safety incidents before public launch. This code does not supply
a staffed moderation operation or guarantee store approval.

## Release order

1. Apply `0002_account_safety.sql` through the normal database migration workflow.
2. Deploy the API and updated terms/privacy pages together.
3. Release the mobile build with the acceptance prompt and safety controls.

Existing accounts must accept policy version `2026-09-21` before sharing. Old
mobile builds receive an actionable error until updated. Coordinate rollout with
TestFlight users. Do not deploy the server changes alone without this plan.

Account deletion and the external deletion-request page are separate outstanding
Play Console requirements. Report records currently survive account deletion with
their account references cleared; establish a retention/deletion policy before
completing the Data safety declaration.
