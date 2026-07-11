import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { S3BucketStack } from '../lib/s3-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { IamStack } from '../lib/iam-stack';
import { GlueStack } from '../lib/glue-stack';
import { NotificationStack } from '../lib/notification-stack';

const PIPELINE_NAME = 'TEST_ETL_JOB';
const ACCOUNT = '123456789012';
const REGION = 'us-east-1';
const env = { account: ACCOUNT, region: REGION };

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  return new cdk.App();
}

function makeS3Stack(app: cdk.App, createBucket = true) {
  return new S3BucketStack(app, 'TestS3Stack', { env, pipelineName: PIPELINE_NAME, createBucket });
}

function makeSecretsStack(app: cdk.App) {
  return new SecretsStack(app, 'TestSecretsStack', { env, pipelineName: PIPELINE_NAME });
}

function makeIamStack(app: cdk.App, s3Stack: S3BucketStack, secretsStack: SecretsStack) {
  return new IamStack(app, 'TestIamStack', {
    env,
    pipelineName: PIPELINE_NAME,
    scriptsBucket: s3Stack.scriptsBucket,
    appSecretArn: secretsStack.appSecret.ref,
  });
}

function makeGlueStack(app: cdk.App, s3Stack: S3BucketStack, iamStack: IamStack, secretsStack: SecretsStack) {
  return new GlueStack(app, 'TestGlueStack', {
    env,
    scriptsBucket: s3Stack.scriptsBucket,
    glueRole: iamStack.glueRole,
    pipelineName: PIPELINE_NAME,
    appSecretsArn: secretsStack.appSecret.ref,
    scriptFileName: 'test_etl_job.py',
    glueSchedule: 'cron(0 12 ? * MON-FRI *)',
    numberOfWorkers: 2,
  });
}

// ─── S3BucketStack ─────────────────────────────────────────────────────────

describe('S3BucketStack', () => {
  test('creates S3 bucket with correct configuration when createBucket=true', () => {
    const app = makeApp();
    const stack = makeS3Stack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('bucket name is lowercase and uses hyphens', () => {
    const app = makeApp();
    const stack = makeS3Stack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: Match.stringLikeRegexp('^[a-z0-9-]+$'),
    });
  });

  test('bucket name does not contain underscores', () => {
    const app = makeApp();
    const stack = makeS3Stack(app);
    const template = Template.fromStack(stack);

    const buckets = template.findResources('AWS::S3::Bucket');
    const bucketNames = Object.values(buckets)
      .map((b: any) => b.Properties?.BucketName as string | undefined)
      .filter(Boolean);

    bucketNames.forEach(name => {
      if (name) {
        expect(name).not.toMatch(/_/);
      }
    });
  });

  test('enforces SSL via bucket policy', () => {
    const app = makeApp();
    const stack = makeS3Stack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  test('bucket has RETAIN removal policy', () => {
    const app = makeApp();
    const stack = makeS3Stack(app);
    const template = Template.fromStack(stack);

    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('references existing bucket when createBucket=false', () => {
    const app = makeApp();
    const stack = makeS3Stack(app, false);
    const template = Template.fromStack(stack);

    // No new bucket resource should be synthesised
    template.resourceCountIs('AWS::S3::Bucket', 0);
  });
});

// ─── SecretsStack ──────────────────────────────────────────────────────────

describe('SecretsStack', () => {
  test('creates Secrets Manager secret', () => {
    const app = makeApp();
    const stack = makeSecretsStack(app);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });

  test('secret name matches pipeline prefix', () => {
    const app = makeApp();
    const stack = makeSecretsStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: `${PIPELINE_NAME}/app-credentials`,
    });
  });

  test('secret contains required credential keys', () => {
    const app = makeApp();
    const stack = makeSecretsStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      SecretString: Match.serializedJson(
        Match.objectLike({
          turso_connection_token: Match.anyValue(),
          turso_connection_uri: Match.anyValue(),
        }),
      ),
    });
  });

  test('secret has project tag', () => {
    const app = makeApp();
    const stack = makeSecretsStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'project.name', Value: PIPELINE_NAME }),
      ]),
    });
  });
});

// ─── IamStack ──────────────────────────────────────────────────────────────

describe('IamStack', () => {
  test('creates IAM role for Glue', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const stack = makeIamStack(app, s3Stack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'glue.amazonaws.com' },
            Action: 'sts:AssumeRole',
          }),
        ]),
      },
    });
  });

  test('role name matches pipeline prefix', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const stack = makeIamStack(app, s3Stack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: `${PIPELINE_NAME}-glue-job-role`,
    });
  });

  test('role has AWSGlueServiceRole managed policy', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const stack = makeIamStack(app, s3Stack, secretsStack);
    const template = Template.fromStack(stack);

    // ManagedPolicyArns are synthesised as Fn::Join objects
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('AWSGlueServiceRole')]),
          ]),
        }),
      ]),
    });
  });

  test('role has S3 read/write permissions on scripts bucket', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const stack = makeIamStack(app, s3Stack, secretsStack);
    const template = Template.fromStack(stack);

    // grantReadWrite generates separate Get+List and Put+Delete+Abort statements
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith(['s3:GetObject*', 's3:GetBucket*', 's3:List*']),
          }),
        ]),
      },
    });
  });

  test('role has SecretsManager read permissions', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const stack = makeIamStack(app, s3Stack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'SecretsRead',
            Effect: 'Allow',
            Action: Match.arrayWith([
              'secretsmanager:GetSecretValue',
              'secretsmanager:DescribeSecret',
            ]),
          }),
        ]),
      },
    });
  });
});

// ─── GlueStack ─────────────────────────────────────────────────────────────

describe('GlueStack', () => {
  test('creates a Glue job', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::Glue::Job', 1);
  });

  test('Glue job uses correct version and worker type', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Glue::Job', {
      GlueVersion: '4.0',
      WorkerType: 'G.1X',
      NumberOfWorkers: 2,
    });
  });

  test('Glue job uses Python 3 glueetl command', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Glue::Job', {
      Command: Match.objectLike({
        Name: 'glueetl',
        PythonVersion: '3',
      }),
    });
  });

  test('Glue job script location points to S3 scripts prefix', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    // ScriptLocation is synthesised as Fn::Join when bucket name has tokens
    template.hasResourceProperties('AWS::Glue::Job', {
      Command: Match.objectLike({
        ScriptLocation: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('/scripts/test_etl_job\\.py')]),
          ]),
        }),
      }),
    });
  });

  test('Glue job default arguments include APP_SECRETS_ARN', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Glue::Job', {
      DefaultArguments: Match.objectLike({
        '--APP_SECRETS_ARN': Match.anyValue(),
      }),
    });
  });

  test('Glue job has max concurrent runs = 1', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Glue::Job', {
      ExecutionProperty: { MaxConcurrentRuns: 1 },
    });
  });

  test('creates a scheduled Glue trigger', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Glue::Trigger', {
      Type: 'SCHEDULED',
      Schedule: 'cron(0 12 ? * MON-FRI *)',
      StartOnCreation: true,
    });
  });

  test('trigger references the correct Glue job', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Glue::Trigger', {
      Actions: Match.arrayWith([
        Match.objectLike({ JobName: `${PIPELINE_NAME}GlueJob` }),
      ]),
    });
  });

  test('stack has GlueJobName CfnOutput', () => {
    const app = makeApp();
    const s3Stack = makeS3Stack(app);
    const secretsStack = makeSecretsStack(app);
    const iamStack = makeIamStack(app, s3Stack, secretsStack);
    const stack = makeGlueStack(app, s3Stack, iamStack, secretsStack);
    const template = Template.fromStack(stack);

    template.hasOutput('GlueJobName', {
      Value: `${PIPELINE_NAME}GlueJob`,
    });
  });
});

// ─── NotificationStack ────────────────────────────────────────────────────

describe('NotificationStack', () => {
  function makeNotificationStack(app: cdk.App) {
    return new NotificationStack(app, 'TestNotificationStack', {
      env,
      notificationEmail: 'test@example.com',
      vpcId: 'vpc-12345678',
      subnetIds: ['subnet-aaa', 'subnet-bbb'],
      pipelineName: PIPELINE_NAME,
    });
  }

  test('creates SNS topic', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SNS::Topic', 1);
  });

  test('SNS topic has email subscription', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'test@example.com',
    });
  });

  test('creates Lambda function with correct runtime', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.10',
      Handler: 'notify.handler',
      Timeout: 30,
    });
  });

  test('Lambda function name matches pipeline prefix', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `${PIPELINE_NAME}-glue-notifier`,
    });
  });

  test('Lambda role has SNS publish permission', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'SnsPublish',
            Effect: 'Allow',
            Action: 'sns:Publish',
          }),
        ]),
      },
    });
  });

  test('Lambda role has glue:GetJobRun permission', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'GlueGetJobRun',
            Effect: 'Allow',
            Action: 'glue:GetJobRun',
          }),
        ]),
      },
    });
  });

  test('Lambda role has VPC execution managed policy', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    // ManagedPolicyArns are synthesised as Fn::Join objects
    template.hasResourceProperties('AWS::IAM::Role', {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('AWSLambdaVPCAccessExecutionRole')]),
          ]),
        }),
      ]),
    });
  });

  test('creates EventBridge success rule', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Events::Rule', {
      Name: `${PIPELINE_NAME}-glue-succeeded`,
      EventPattern: Match.objectLike({
        source: ['aws.glue'],
        'detail-type': ['Glue Job State Change'],
        detail: Match.objectLike({
          jobName: [`${PIPELINE_NAME}GlueJob`],
          state: ['SUCCEEDED'],
        }),
      }),
    });
  });

  test('creates EventBridge failure rule', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Events::Rule', {
      Name: `${PIPELINE_NAME}-glue-failed`,
      EventPattern: Match.objectLike({
        source: ['aws.glue'],
        'detail-type': ['Glue Job State Change'],
        detail: Match.objectLike({
          jobName: [`${PIPELINE_NAME}GlueJob`],
          state: Match.arrayWith(['FAILED', 'ERROR', 'TIMEOUT']),
        }),
      }),
    });
  });

  test('EventBridge rules target the Lambda function', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    const rules = template.findResources('AWS::Events::Rule');
    Object.values(rules).forEach((rule: any) => {
      expect(rule.Properties.Targets).toBeDefined();
      expect(rule.Properties.Targets.length).toBeGreaterThan(0);
    });
  });

  test('security group allows all outbound traffic', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Outbound-only security group for lambda notifier',
      SecurityGroupEgress: Match.arrayWith([
        Match.objectLike({ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }),
      ]),
    });
  });

  test('stack has Lambda and SNS ARN outputs', () => {
    const app = makeApp();
    const stack = makeNotificationStack(app);
    const template = Template.fromStack(stack);

    template.hasOutput('NotificationLambdaArn', {});
    template.hasOutput('GlueNotificationTopicArn', {});
  });
});
