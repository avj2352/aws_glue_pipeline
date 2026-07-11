import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

interface ISecretsStackProps extends StackProps {
  pipelineName: string;
}

export class SecretsStack extends Stack {
  public readonly pipelineName: string;
  public readonly appSecret: secretsmanager.CfnSecret;

  constructor(scope: Construct, id: string, props: ISecretsStackProps) {
    super(scope, id, props);
    // ..init
    this.pipelineName = props.pipelineName;

    // secret obj #1
    this.appSecret = new secretsmanager.CfnSecret(this, `${this.pipelineName}AppSecret`, {
      name: `${this.pipelineName}/app-credentials`,
      description: `App credentials - replace REPLACE_ME values before first run`,
      secretString: JSON.stringify({
        // ..add all dependent env variables for glue job here
        turso_connection_token: 'REPLACE_ME',
        turso_connection_uri: 'REPLACE_ME'
      }),
      tags: [{ key: 'project.name', value: props.pipelineName }],
    });
  }
}
