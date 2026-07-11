import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";

interface IGlueStackProps extends StackProps {
  scriptsBucket: s3.IBucket;
  glueRole: iam.Role;
  pipelineName: string;
  appSecretsArn: string;
  scriptFileName?: string;
  glueSchedule?: string;
  numberOfWorkers?: number;
}

export class GlueStack extends Stack {

  public readonly glueJobName: string;

  constructor(scope: Construct, id: string, props: IGlueStackProps) {
    super(scope, id, props);

    // #1: init
    this.glueJobName = `${props.pipelineName}GlueJob`;
    const scriptFileName = props.scriptFileName ?? 'test_etl_job.py';
    const glueSchedule = props.glueSchedule ?? 'cron(0 12 ? * MON-FRI *)';
    const numberOfWorkers = props.numberOfWorkers ?? 2;

    // #2: init glue job
    const glueJob = new glue.CfnJob(this, `${props.pipelineName}GlueJob`, {
      name: `${props.pipelineName}GlueJob`,
      description: 'Connects to Turso and gets data',
      role: props.glueRole.roleArn,
      glueVersion: '4.0',
      workerType: 'G.1X',
      numberOfWorkers,
      maxRetries: 1,
      timeout: 60,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: `s3://${props.scriptsBucket.bucketName}/scripts/${scriptFileName}`,
      },
      defaultArguments: {
        '--job-language': 'python',
        '--enable-job-insights': 'true',
        '--TempDir': `s3://${props.scriptsBucket.bucketName}/tmp/`,
        '--APP_SECRETS_ARN': props.appSecretsArn,
        '--additional-python-modules': 'boto3,sqlalchemy,libsql',
      },
      executionProperty: {
        maxConcurrentRuns: 1,
      },
      tags: { 'project.name': props.pipelineName }
    });

    // #3: init glue trigger
    const glueTrigger = new glue.CfnTrigger(this, `${props.pipelineName}ScheduledTrigger`, {
      name: `${props.pipelineName}-glue-trigger`,
      description: `Triggers ${props.pipelineName}GlueJob on schedule: ${glueSchedule}`,
      type: 'SCHEDULED',
      schedule: glueSchedule,
      startOnCreation: true,
      actions: [{ jobName: `${props.pipelineName}GlueJob` }]
    });

    // #4: glue trigger dependencies
    glueTrigger.node.addDependency(glueJob);


    // #5: show outputs
    new CfnOutput(this, 'GlueJobName', {
      value: this.glueJobName,
      description: `Run manually: aws glue start-job-run --job-name ${this.glueJobName}`
    });
  }
}
