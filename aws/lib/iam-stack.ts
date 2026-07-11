import { Stack, StackProps } from "aws-cdk-lib";
// import { Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";

interface IIAMStackProps extends StackProps {
  pipelineName: string;
  scriptsBucket: s3.IBucket;
  appSecretArn: string;
}

export class IamStack extends Stack {
  public readonly glueRole: iam.Role;

  constructor(scope: Construct, id: string, props: IIAMStackProps) {
    super(scope, id, props);

    // #1: if permission boundary is required (optional)
    // const permissionBoundary = iam.ManagedPolicy.fromManagedPolicyArn(
    //   this,
    //   'AppPermissionBoundary',
    //   `arn:aws:iam::${this.account}:policy/boundaries/app-permission-boundary-policyarn`
    // );

    // #2: create glue job role
    this.glueRole = new iam.Role(this, 'GlueJobRole', {
      roleName: `${props.pipelineName}-glue-job-role`,
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      // permissionsBoundary,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    // #3: s3 read/write on scripts bucket
    props.scriptsBucket.grantReadWrite(this.glueRole);

    // #4: secrets read for app credentials
    this.glueRole.addToPolicy(new iam.PolicyStatement({
      sid: 'SecretsRead',
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [props.appSecretArn],
    }));

    // #4. tags required (optional)
    // Tags.of(this.glueRole).add('project.name', props.pipelineName);
  }
}
