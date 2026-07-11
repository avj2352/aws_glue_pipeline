import { Stack, StackProps, CfnOutput, Duration } from "aws-cdk-lib";
// import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as ec2 from "aws-cdk-lib/aws-ec2";

interface INotificationStackProps extends StackProps {
  notificationEmail: string;
  vpcId: string;
  subnetIds: string[];
  pipelineName: string;
}

export class NotificationStack extends Stack {
  public readonly lambdaArn: string;
  public readonly snsTopicArn: string;
  public readonly jobName: string;

  constructor(scope: Construct, id: string, props: INotificationStackProps) {
    super(scope, id, props);

    // #1: init
    this.jobName = `${props.pipelineName}GlueJob`;

    // #2: vpc lookup
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId });

    // #3: private/public subnets
    const privateSubnets = props.subnetIds.map((subnetId, idx) =>
      ec2.Subnet.fromSubnetId(this, `PrivateSubnet${idx}`, subnetId),
    );

    // #4: security groups
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaNotifierSG', {
      securityGroupName: `${props.pipelineName}-glue-notifier-sg`,
      description: 'Outbound-only security group for lambda notifier',
      vpc,
      allowAllOutbound: true,
    });

    // #5: add tags to security group (optional)
    // Tags.of(lambdaSg).add('Name', `${props.pipelineName}-glue-notifier-sg`);
    // Tags.of(lambdaSg).add('project.name', props.pipelineName);

    // #6: SNS topic + email subscription 
    const topic = new sns.Topic(this, `${props.pipelineName}GlueNotificationTopic`, {
      topicName: `${props.pipelineName}-glue-notifications`,
    });
    topic.addSubscription(new subscriptions.EmailSubscription(props.notificationEmail));

    // #7: permission boundary for lambda (optional)
    // const permissionBounday = iam.ManagedPolicy.fromManagedPolicyArn(
    //   this,
    //   'PermissionBoundary',
    //   `arn:aws:iam::${this.account}:policy/boundaries/permission-boundary`,
    // );

    // #8: iam role for lambda
    const lambdaRole = new iam.Role(this, 'LambdaNotifierRole', {
      roleName: `${props.pipelineName}-glue-notifier-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      // permissionsBoundary,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // #9: Add glub job run and sns publish policies to lambdaRole
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SnsPublish',
      effect: iam.Effect.ALLOW,
      actions: ['sns:Publish'],
      resources: [topic.topicArn],
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid: 'GlueGetJobRun',
      effect: iam.Effect.ALLOW,
      actions: ['glue:GetJobRun'],
      resources: [`arn:aws:glue:${this.region}:${this.account}:job/${this.jobName}`],
    }));

    // #10: add tags to lambda role (optional)
    // Tags.of(lambdaRole).add('project.name', props.pipelineName);

    // #11: define lambda function
    const notifierLambdaFn = new lambda.Function(this, `${props.pipelineName}GlueNotifierFunction`, {
      functionName: `${props.pipelineName}-glue-notifier`,
      description: `Sends email via SNS when the glue job succeeds or fails`,
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'notify.handler',
      timeout: Duration.seconds(30),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      securityGroups: [lambdaSg],
      environment: {
        SNS_TOPIC_ARN: topic.topicArn,
      },
      code: lambda.Code.fromAsset('lambda')
    });

    // #12: add tags to lambda function (optional)
    // Tags.of(notifierLambdaFn).add('project.name', props.pipelineName);

    // #13 a: eventbridge rules - job success
    const succeededRule = new events.Rule(this, `${props.pipelineName}GlueJobSuccessRule`, {
      ruleName: `${props.pipelineName}-glue-succeeded`,
      description: 'Fires when the job completes successfully',
      eventPattern: {
        source: ['aws.glue'],
        detailType: ['Glue Job State Change'],
        detail: {
          jobName: [this.jobName],
          state: ['SUCCEEDED'],
        },
      },
    });
    succeededRule.addTarget(new targets.LambdaFunction(notifierLambdaFn));

    // #13 b: eventbridge rules - job failure
    const failedRule = new events.Rule(this, `${props.pipelineName}GlueJobFailureRule`, {
      ruleName: `${props.pipelineName}-glue-failed`,
      description: 'Fires when the job fails to complete',
      eventPattern: {
        source: ['aws.glue'],
        detailType: ['Glue Job State Change'],
        detail: {
          jobName: [this.jobName],
          state: ['FAILED', 'ERROR', 'TIMEOUT'],
        },
      },
    });
    failedRule.addTarget(new targets.LambdaFunction(notifierLambdaFn));

    // #14: init arn
    this.lambdaArn = notifierLambdaFn.functionArn;
    this.snsTopicArn = topic.topicArn;

    // #15: output values
    new CfnOutput(this, 'NotificationLambdaArn', {
      value: notifierLambdaFn.functionArn,
      description: 'ARN of the lambda function that sends glue job notification emails',
    });

    new CfnOutput(this, 'GlueNotificationTopicArn', {
      value: topic.topicArn,
      description: 'SNS topic ARN used by lambda to deliver email notifications',
    });

  }
}
