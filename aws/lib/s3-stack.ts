import { Stack, StackProps, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";


interface IS3BucketStackProps extends StackProps {
  createBucket?: boolean;
  pipelineName: string;
}

export class S3BucketStack extends Stack {
  public readonly scriptsBucket: s3.IBucket;
  public readonly pipelineName: string;

  constructor(scope: Construct, id: string, props: IS3BucketStackProps = { pipelineName: 'glue-pipeline' }) {
    super(scope, id, props);
    this.pipelineName = props.pipelineName;

    const bucketName = `${this.pipelineName.toLowerCase().replace(/_/g, '-')}-scripts-${this.account}-${this.region}`;
    const createBucket = props.createBucket ?? true;

    // ..if the bucket does not exist
    if (createBucket) {
      this.scriptsBucket = new s3.Bucket(this, 'GlueScriptsBucket', {
        bucketName,
        removalPolicy: RemovalPolicy.RETAIN,
        versioned: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
      });
    } else {
      // ..else - reference existing bucket w/o creating it
      this.scriptsBucket = s3.Bucket.fromBucketName(this, 'GlueScriptsBucket', bucketName);
    }
  }
}
