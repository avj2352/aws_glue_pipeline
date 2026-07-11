# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Saved Sessions

- etl-cdk-stack

## Repository Layout

```
glue_job_project/
├── aws/          # CDK v2 TypeScript project — all infrastructure
├── scripts/      # Python Glue job scripts (Python 3.10, uv)
├── docs/         # Architecture and cost documentation
└── design/       # Pipeline design diagram
```

`aws/` and `scripts/` are each their own git repository (separate `.git` directories).

---

## CDK Project (`aws/`)

### Commands

```bash
cd aws

npm test                          # run all Jest CDK assertion tests
npm test -- --testNamePattern "S3" # run a single test by name pattern
npm run build                     # tsc compile (catches type errors)
npx cdk synth                     # synthesise CloudFormation templates
npx cdk diff                      # diff against deployed stacks
npx cdk deploy --all              # deploy all stacks (requires AWS credentials)
```

### Deploying with context variables

All runtime config is passed via `--context`. Defaults are set in `bin/glue_pipeline.ts`.

```bash
npx cdk deploy --all \
  --context vpcId=vpc-xxxxxxxx \
  --context subnetIds=subnet-aaa,subnet-bbb \
  --context notificationEmail=you@example.com \
  --context scriptFileName=main.py \
  --context numberOfWorkers=2 \
  --context createBucket=true
```

### Stack Architecture

Five stacks deploy in a fixed dependency order:

```
S3BucketStack ──┐
SecretsStack ───┤──► IamStack ──► GlueStack
                         NotificationStack (independent)
```

| Stack | Key resource | Notable detail |
|-------|-------------|----------------|
| `S3BucketStack` | Scripts S3 bucket | `createBucket=false` imports an existing bucket by name instead of creating one |
| `SecretsStack` | Secrets Manager secret | Placeholder values — must be updated manually before first run |
| `IamStack` | Glue IAM role | Grants `grantReadWrite` on the scripts bucket + `GetSecretValue` on the app secret |
| `GlueStack` | Glue job + scheduled trigger | Glue 4.0, G.1X, 2 workers; passes `--APP_SECRETS_ARN` (not the plaintext secret) |
| `NotificationStack` | Lambda + SNS + EventBridge | Lambda runs in the existing VPC; fires on SUCCEEDED / FAILED / ERROR / TIMEOUT |

### Key conventions

- **Bucket name normalisation:** `pipelineName` is lowercased and underscores replaced with hyphens before being embedded in the S3 bucket name (S3 does not allow uppercase or underscores).
- **Glue schedule:** `cron(0 12 ? * MON-FRI *)` = 8 AM EDT (UTC−4). Flip to `cron(0 13 ...)` for 8 AM EST (UTC−5) in winter if needed.
- **Secret ARN vs value:** The Glue job receives `--APP_SECRETS_ARN` (a Secrets Manager ARN). The Python script must call `GetSecretValue` at runtime to obtain the actual Turso credentials.
- **EventBridge filter:** `detail.jobName` must be an array — a plain string is silently ignored by EventBridge content-based filtering.
- **Lambda handler:** `aws/lambda/notify.py` — `notify.handler`. The `lambda/` directory must exist for `Code.fromAsset('lambda')` to synth successfully.

### Testing

Tests use `aws-cdk-lib/assertions` (`Template`, `Match`). CDK synthesises managed policy ARNs as `Fn::Join` objects, not plain strings — use `Match.objectLike({ 'Fn::Join': ... })` when asserting on managed policies or token-based resource names.

---

## Glue Scripts (`scripts/`)

Python 3.10, managed with `uv`.

```bash
cd scripts
uv run python main.py    # run the script locally
```

The actual ETL logic (Fly.io API → Turso API) lives in `scripts/main.py`. When deploying, upload the script to `s3://<bucket>/scripts/<scriptFileName>` before triggering the Glue job.

---

## DOCUMENTATION

Document every change / feature introducd, as a markdown file `.md` and save it under `docs` folder.

## VERSIONING

- To updatte the version of the scripts, update `version` under `pyproject.toml` file under `scripts` folder
- To update the version of the AWS, update `version` field under `package.json`, located under `aws` folder
- Update the badge "version" in README.md to be in sync with above version changes.
- Using semantic versioning, For eg: `1.3.1` gets updated as `1.3.2`. similarly `1.3.9` gets updated as `1.4.0` unless a specific version is specified.
- Update the file `CHANGELOG.md` with the version number, date stamp & provide a brief, one liner point changes.
