import json
import os
import boto3

sns = boto3.client('sns')
glue = boto3.client('glue')

SNS_TOPIC_ARN = os.environ['SNS_TOPIC_ARN']


def handler(event, context):
    detail = event.get('detail', {})
    job_name = detail.get('jobName', 'unknown')
    job_run_id = detail.get('id', '')
    state = detail.get('state', 'UNKNOWN')

    error_message = ''
    if job_run_id and state != 'SUCCEEDED':
        try:
            run = glue.get_job_run(JobName=job_name, RunId=job_run_id)
            error_message = run['JobRun'].get('ErrorMessage', '')
        except Exception:
            pass

    subject = f'Glue Job {state}: {job_name}'
    body = f'Job: {job_name}\nStatus: {state}\nRun ID: {job_run_id}'
    if error_message:
        body += f'\nError: {error_message}'

    sns.publish(TopicArn=SNS_TOPIC_ARN, Subject=subject, Message=body)
    return {'statusCode': 200, 'body': json.dumps({'state': state})}
