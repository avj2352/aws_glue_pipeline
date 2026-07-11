# Monthly Cost Estimate — ETL Pipeline

**Date:** 2026-07-10  
**Region:** us-east-1 (assumed)  
**Schedule:** Weekdays at 8 AM EST → `cron(0 13 ? * MON-FRI *)` (UTC)  
**Assumption:** ~22 business days/month, job succeeds on first attempt (no retries)

> **Note on DST:** The cron fires at 13:00 UTC year-round. That is 8:00 AM EST (Nov–Mar) but 9:00 AM EDT (Mar–Nov). Update the cron to `cron(0 12 ? * MON-FRI *)` if you want a consistent 8 AM wall-clock time during EDT.

---

## Resource Configuration (from CDK stack)

| Parameter | Value |
|-----------|-------|
| Glue version | 4.0 |
| Worker type | G.1X (1 DPU = 4 vCPU, 16 GB RAM) |
| Number of workers | 2 |
| Max timeout | 60 minutes |
| Max retries | 1 |
| Lambda memory | 128 MB (default) |
| Lambda timeout | 30 seconds |

---

## Per-Service Cost Breakdown

### 1. AWS Glue Job — dominant cost

**Pricing:** $0.44 per DPU-hour (Glue 4.0, G.1X)  
**DPUs per run:** 2 workers × 1 DPU = **2 DPUs**  
**Runs per month:** 22

| Scenario | Avg job duration | DPU-hours/run | Cost/run | Monthly cost |
|----------|-----------------|---------------|----------|-------------|
| Fast (API calls only) | 10 min | 2 × 0.167 = 0.33 | $0.15 | **$3.26** |
| Typical | 20 min | 2 × 0.333 = 0.67 | $0.29 | **$6.43** |
| Slow / large dataset | 45 min | 2 × 0.75 = 1.50 | $0.66 | **$14.52** |
| Max timeout (60 min) | 60 min | 2 × 1.00 = 2.00 | $0.88 | **$19.36** |

> Glue bills in 1-second increments with a 1-minute minimum per run.

**Retry scenario (maxRetries: 1):** If every run fails once and retries, double the Glue cost above.

---

### 2. AWS Secrets Manager

**Pricing:** $0.40 per secret/month + $0.05 per 10,000 API calls  
**Secrets:** 1  
**API calls:** 22/month (one `GetSecretValue` per job run) — well within the 10,000 free calls included per secret

| Item | Cost |
|------|------|
| 1 secret (flat fee) | $0.40 |
| API calls (22/month) | $0.00 |
| **Subtotal** | **$0.40/month** |

---

### 3. Amazon S3

**Pricing:** $0.023/GB storage, $0.0004 per 1,000 PUT requests, $0.00004 per 1,000 GET requests  
**Usage:** ~1 KB Python script + small tmp files per run

| Item | Estimate |
|------|---------|
| Script storage (~1 KB) | $0.00 |
| Tmp files (~50 MB/month) | $0.00 |
| Requests (reads/writes) | < $0.01 |
| **Subtotal** | **~$0.01/month** |

---

### 4. AWS Lambda (notification function)

**Pricing:** Free tier — 1M requests/month, 400,000 GB-seconds/month  
**Invocations:** ≤ 44/month (one per EventBridge rule × 22 runs)  
**Duration estimate:** ~3 seconds × 128 MB = 0.375 GB-seconds per invocation  
**Monthly GB-seconds:** 44 × 0.375 = **16.5 GB-seconds** (<<< free tier)

| Item | Cost |
|------|------|
| Invocations (44/month) | $0.00 |
| Duration (16.5 GB-sec) | $0.00 |
| **Subtotal** | **$0.00/month** |

---

### 5. Amazon SNS (email notifications)

**Pricing:** First 1,000 email deliveries free; $2.00 per 100,000 thereafter  
**Emails:** ≤ 44/month

| Item | Cost |
|------|------|
| Email deliveries (≤44/month) | $0.00 |
| **Subtotal** | **$0.00/month** |

---

### 6. Amazon EventBridge

**Pricing:** Events from AWS services to the default event bus are **free**  
**Events:** 22 Glue job state-change events/month

| Item | Cost |
|------|------|
| Glue job state change events | $0.00 |
| **Subtotal** | **$0.00/month** |

---

### 7. CloudWatch Logs (Glue job logs)

**Pricing:** $0.50/GB ingested, first 5 GB storage/month free  
**`--enable-job-insights: true`** is set — Glue writes structured logs to CloudWatch  
**Estimate:** ~5 MB logs per run × 22 runs = 110 MB/month

| Item | Cost |
|------|------|
| Log ingestion (0.11 GB) | $0.055 |
| Log storage (within free 5 GB) | $0.00 |
| **Subtotal** | **~$0.06/month** |

---

### 8. IAM / CloudFormation / VPC

- **IAM roles/policies:** No charge
- **CloudFormation (CDK stacks):** No charge after initial deployment
- **Existing VPC + subnets:** No additional charge (you are referencing an existing VPC via `vpcId`)

> **Important:** If your Lambda's private subnets route outbound traffic through a **NAT Gateway**, that is **not** provisioned by this stack but would add ~$32–$45/month. Check your existing VPC routing before deploying.

---

## Monthly Cost Summary

| Service | Low (10 min) | Typical (20 min) | High (45 min) |
|---------|-------------|-----------------|--------------|
| Glue Job | $3.26 | $6.43 | $14.52 |
| Secrets Manager | $0.40 | $0.40 | $0.40 |
| S3 | $0.01 | $0.01 | $0.01 |
| Lambda | $0.00 | $0.00 | $0.00 |
| SNS | $0.00 | $0.00 | $0.00 |
| EventBridge | $0.00 | $0.00 | $0.00 |
| CloudWatch Logs | $0.06 | $0.06 | $0.06 |
| **Total** | **~$3.73** | **~$6.90** | **~$14.99** |

> Worst case (job always hits 60 min timeout): **~$19.83/month**  
> Worst case with all retries fired: **~$39.23/month**

---

## Cost Optimisation Options

| Change | Saving | Trade-off |
|--------|--------|-----------|
| Reduce `numberOfWorkers` from 2 to 1 | 50% of Glue cost | Job takes ~2× longer; still within 60 min if job is fast |
| Switch worker type to `G.025X` (0.25 DPU) | 75% of Glue cost | Lower memory (4 GB); only viable if dataset is small |
| Set `maxRetries: 0` | Eliminates retry cost | No auto-recovery on transient failure |
| Lower Glue job timeout from 60 min to 15 min | Prevents runaway billing | Job hard-killed at 15 min if it hangs |
| Enable Glue job bookmarks | Reduces data processed per run | Requires script changes |
