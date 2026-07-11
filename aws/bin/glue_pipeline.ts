#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
// ..custom
import { S3BucketStack } from "../lib/s3-stack";
import { SecretsStack } from "../lib/secrets-stack";
import { IamStack } from "../lib/iam-stack";
import { GlueStack } from "../lib/glue-stack";
import { NotificationStack } from "../lib/notification-stack";

const PROJECT_NAME: string = 'PMD_ETL_JOB';

// init
const app = new cdk.App();

// configurations
// const environment: string = app.node.tryGetContext('environment') ?? 'dev';
// const appId = app.node.tryGetContext('appId') ?? 'ABCDEF';
const vpcId: string = app.node.tryGetContext('vpcId') ?? '';
const subnetIds: string[] = (app.node.tryGetContext('subnetIds') ?? '').split(',').filter(Boolean);

const notificationEmail: string = app.node.tryGetContext('notificationEmail')
  ?? 'pramod.jingade@gmail.com';


const scriptFileName: string = app.node.tryGetContext('scriptFileName') ?? 'test_etl_job.py';
const glueSchedule: string = app.node.tryGetContext('glueSchedule') ?? 'cron(0 12 ? * MON-FRI *)';
const numberOfWorkers: number = Number(app.node.tryGetContext('numberOfWorkers') ?? 2);
const createBucket: boolean = (app.node.tryGetContext('createBucket') ?? 'true') === 'true';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// ..create bucket
const s3Stack = new S3BucketStack(app, `${PROJECT_NAME}S3Stack`, {
  env,
  pipelineName: PROJECT_NAME,
  createBucket
});

// ..create secrets
const secretStack = new SecretsStack(app, `${PROJECT_NAME}SecretsStack`, {
  env,
  pipelineName: PROJECT_NAME,
});


// ..create iam roles
const iamStack = new IamStack(app, `${PROJECT_NAME}IamStack`, {
  env,
  pipelineName: PROJECT_NAME,
  appSecretArn: secretStack.appSecret.ref,
  scriptsBucket: s3Stack.scriptsBucket
});
iamStack.addDependency(s3Stack);
iamStack.addDependency(secretStack);


// ..create glue job
const glueStack = new GlueStack(app, `${PROJECT_NAME}GlueStack`, {
  env,
  scriptsBucket: s3Stack.scriptsBucket,
  glueRole: iamStack.glueRole,
  pipelineName: PROJECT_NAME,
  appSecretsArn: secretStack.appSecret.ref,
  scriptFileName,
  glueSchedule,
  numberOfWorkers,
});
glueStack.addDependency(iamStack);

// ..create notification stack
new NotificationStack(app, `${PROJECT_NAME}NotificationStack`, {
  notificationEmail,
  vpcId,
  subnetIds,
  pipelineName: PROJECT_NAME,
});
