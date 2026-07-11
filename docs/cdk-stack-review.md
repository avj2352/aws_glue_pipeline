# CDK Stack Review — ETL Pipeline

**Date:** 2026-07-10  
**Scope:** `aws/` folder — AWS CDK v2 TypeScript project  
**Stacks reviewed:** S3BucketStack, SecretsStack, IamStack, GlueStack, NotificationStack

---

## Architecture Overview

The CDK project provisions the following pipeline:

```
Scheduled Trigger (cron)
    └── AWS Glue Job (Python 3, Glue 4.0)
            ├── Reads script from S3 (s3://scripts/)
            ├── Reads secrets from AWS Secrets Manager
            ├── Calls Fly.io API to fetch customers
            └── Calls Turso API to update records

Glue Job State Change (EventBridge)
    └── Lambda (notify.py)
            └── SNS Topic → Email (pramod.jingade@gmail.com)
```

### Stacks and Dependency Order

| Order | Stack | Purpose |
|-------|-------|---------|
| 1 | `S3BucketStack` | Scripts bucket (create or reference existing) |
| 2 | `SecretsStack` | Secrets Manager secret for Turso credentials |
| 3 | `IamStack` | Glue IAM role with S3 + Secrets permissions |
| 4 | `GlueStack` | Glue job + scheduled trigger |
| 5 | `NotificationStack` | Lambda + SNS + EventBridge rules |

---

## Bugs Fixed

### 1. S3 bucket name contained uppercase letters and underscores — `s3-stack.ts`

**Problem:** The pipeline name `PMD_ETL_JOB` was interpolated directly into the bucket name. S3 bucket names must be lowercase and cannot contain underscores.

```typescript
// Before — invalid S3 name
const bucketName = `${this.pipelineName}-scripts-${this.account}-${this.region}`;
// → "PMD_ETL_JOB-scripts-123456789012-us-east-1"  ❌

// After — normalized
const bucketName = `${this.pipelineName.toLowerCase().replace(/_/g, '-')}-scripts-${this.account}-${this.region}`;
// → "pmd-etl-job-scripts-123456789012-us-east-1"  ✅
```

---

### 2. S3 permissions were never granted to the Glue role — `iam-stack.ts`

**Problem:** `scriptsBucket` was accepted as a prop and a comment said "s3 read/write on scripts bucket", but no S3 policy statement was ever added. The Glue job would fail at runtime trying to read its own script.

```typescript
// Before — bucket prop accepted but unused
// (no S3 policy statement)

// After — grant read/write using CDK's built-in helper
props.scriptsBucket.grantReadWrite(this.glueRole);
```

---

### 3. Glue job argument name was semantically wrong — `glue-stack.ts`

**Problem:** The default argument `--TURSO_CONNECTION_URI` was being set to the Secrets Manager ARN, not the actual URI. The variable name implied a plaintext connection string.

```typescript
// Before — misleading name; value is a Secret ARN, not a URI
'--TURSO_CONNECTION_URI': props.appSecretsArn,

// After — accurate name
'--APP_SECRETS_ARN': props.appSecretsArn,
```

The Python script should call `secretsmanager:GetSecretValue` using this ARN to retrieve the actual URI at runtime.

---

### 4. EventBridge `detail.jobName` was a string, not an array — `notification-stack.ts`

**Problem:** EventBridge content-based filtering requires filter values to be arrays. A plain string is silently ignored, meaning both rules would fire for _every_ Glue job state change in the account, not just this pipeline's job.

```typescript
// Before — fires for all Glue jobs in the account
detail: {
  jobName: `${this.jobName}`,   // ❌ plain string
  state: ['SUCCEEDED'],
}

// After — correctly scoped to this job
detail: {
  jobName: [this.jobName],      // ✅ array
  state: ['SUCCEEDED'],
}
```

Applied to both the success rule and the failure rule.

---

### 5. `GlueStack` was missing the `env` prop — `bin/glue_pipeline.ts`

**Problem:** All other stacks were passed `env` (account + region), but `GlueStack` was not. Without `env`, CDK synthesises environment-agnostic tokens for account/region, which can cause cross-stack reference issues at deploy time.

```typescript
// Before
const glueStack = new GlueStack(app, `${PROJECT_NAME}GlueStack`, {
  scriptsBucket: s3Stack.scriptsBucket,
  ...
});

// After
const glueStack = new GlueStack(app, `${PROJECT_NAME}GlueStack`, {
  env,                           // ✅ added
  scriptsBucket: s3Stack.scriptsBucket,
  ...
});
```

---

### 6. Dead variable `appSecretName` — `bin/glue_pipeline.ts`

**Problem:** `appSecretName` was read from CDK context but never passed to any stack. It had no effect.

```typescript
// Removed
const appSecretName: string = app.node.tryGetContext('appSecretName')
  ?? '/secrets/project/dev';
```

---

### 7. Deprecated `addDependsOn` API — `glue-stack.ts`

**Problem:** `CfnTrigger.addDependsOn()` is deprecated in CDK v2.

```typescript
// Before — deprecated
glueTrigger.addDependsOn(glueJob);

// After — current API
glueTrigger.node.addDependency(glueJob);
```

---

### 8. Missing `lambda/` directory — `notification-stack.ts`

**Problem:** `Code.fromAsset('lambda')` referenced a directory that did not exist, causing `cdk synth` to fail.

**Fix:** Created `aws/lambda/notify.py` — a working Lambda handler that:
1. Reads `SNS_TOPIC_ARN` from environment variables
2. Calls `glue:GetJobRun` to fetch the error message on failure
3. Publishes a formatted notification email via SNS

---

### 9. TypeScript config missing `node` and `jest` types — `tsconfig.json`

**Problem:** `process.env` in `bin/glue_pipeline.ts` required Node.js types, and `describe`/`test`/`expect` in tests required Jest types. Neither was declared, causing TypeScript errors.

```json
// Added to tsconfig.json
"types": ["node", "jest"],
"isolatedModules": true
```

`isolatedModules: true` is also required by ts-jest when using `NodeNext` module resolution.

---

## Test Suite

**Location:** `aws/test/glue_pipeline.test.ts`  
**Framework:** Jest + `aws-cdk-lib/assertions`  
**Result:** 36 tests, 36 passing

### Coverage by stack

| Stack | Tests | What is verified |
|-------|-------|-----------------|
| `S3BucketStack` | 6 | Bucket created, name is lowercase/no underscores, versioning enabled, SSL enforced, RETAIN policy, `createBucket=false` skips creation |
| `SecretsStack` | 4 | Secret created, name matches prefix, contains credential keys, has project tag |
| `IamStack` | 5 | Glue service principal, role name, AWSGlueServiceRole policy, S3 read/write grant, SecretsManager read |
| `GlueStack` | 8 | Job created, Glue 4.0 / G.1X / 2 workers, Python 3 glueetl command, script location, `APP_SECRETS_ARN` arg, max concurrent runs=1, scheduled trigger, trigger targets correct job, `GlueJobName` output |
| `NotificationStack` | 13 | SNS topic, email subscription, Lambda runtime/handler/timeout, function name, SNS publish policy, `glue:GetJobRun` policy, VPC managed policy, success EventBridge rule, failure EventBridge rule, rules target Lambda, security group egress, Lambda+SNS outputs |

### Running the tests

```bash
cd aws
npm test
```
