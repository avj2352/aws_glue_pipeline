# CHANGELOG

## [1.0.3] — 2026-07-10

- **fix:** S3 bucket name normalised to lowercase with hyphens (was invalid due to uppercase + underscores from pipeline name)
- **fix:** Added missing `scriptsBucket.grantReadWrite(glueRole)` in IamStack — Glue role previously had no S3 permissions
- **fix:** Renamed Glue default argument `--TURSO_CONNECTION_URI` → `--APP_SECRETS_ARN` to accurately reflect the value type (ARN, not a plaintext URI)
- **fix:** EventBridge `detail.jobName` filter changed from plain string to array — previously fired for all Glue jobs in the account
- **fix:** Added missing `env` prop to `GlueStack` in `bin/glue_pipeline.ts`
- **fix:** Removed unused `appSecretName` context variable from `bin/glue_pipeline.ts`
- **fix:** Replaced deprecated `glueTrigger.addDependsOn()` with `glueTrigger.node.addDependency()`
- **fix:** Added `tsconfig.json` entries `types: ["node", "jest"]` and `isolatedModules: true` to resolve TypeScript errors
- **feat:** Created `aws/lambda/notify.py` — Lambda handler that publishes Glue job success/failure notifications via SNS
- **feat:** Added full CDK assertion test suite (`aws/test/glue_pipeline.test.ts`) — 36 tests covering all 5 stacks
- **chore:** Updated Glue schedule from `cron(0 13 ? * MON-FRI *)` to `cron(0 12 ? * MON-FRI *)` for consistent 8 AM EDT trigger
- **docs:** Added `docs/cdk-stack-review.md` — bug summary with before/after code snippets
- **docs:** Added `docs/cost-estimate.md` — monthly cost breakdown (~$4–$15/month typical)
- **docs:** Added `CLAUDE.md` at project root with architecture guidance and development commands
