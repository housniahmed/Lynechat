// Modèle CloudFormation déployé dans le compte AWS de l'utilisateur.
// Crée : file SQS (boîte de réception des événements), sujet SNS, jeu de configuration SES
// avec suivi (envois, ouvertures, clics, rebonds, plaintes), et une petite fonction Lambda
// publique (désinscription, confirmation d'inscription, formulaires).
const fs = require('fs');
const path = require('path');

function buildTemplate() {
  const code = fs.readFileSync(path.join(__dirname, 'lambda.js'), 'utf8');
  if (Buffer.byteLength(code) > 4096) throw new Error('Code Lambda trop long pour un modèle en ligne (4096 octets max).');
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Lynechat - infrastructure e-mailing (SES, SQS, SNS, Lambda)',
    Parameters: {
      Secret: { Type: 'String', NoEcho: true, MinLength: 32, Description: 'Cle de signature des liens (generee par Lynechat)' },
      ConfigSetName: { Type: 'String', Default: 'lynechat', AllowedPattern: '^[a-zA-Z0-9_-]{1,64}$' },
    },
    Resources: {
      Inbox: {
        Type: 'AWS::SQS::Queue',
        Properties: { MessageRetentionPeriod: 1209600, VisibilityTimeout: 60 },
      },
      Events: { Type: 'AWS::SNS::Topic', Properties: {} },
      EventsPolicy: {
        Type: 'AWS::SNS::TopicPolicy',
        Properties: {
          Topics: [{ Ref: 'Events' }],
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [{
              Effect: 'Allow',
              Principal: { Service: 'ses.amazonaws.com' },
              Action: 'sns:Publish',
              Resource: { Ref: 'Events' },
              Condition: { StringEquals: { 'AWS:SourceAccount': { Ref: 'AWS::AccountId' } } },
            }],
          },
        },
      },
      InboxPolicy: {
        Type: 'AWS::SQS::QueuePolicy',
        Properties: {
          Queues: [{ Ref: 'Inbox' }],
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [{
              Effect: 'Allow',
              Principal: { Service: 'sns.amazonaws.com' },
              Action: 'sqs:SendMessage',
              Resource: { 'Fn::GetAtt': ['Inbox', 'Arn'] },
              Condition: { ArnEquals: { 'aws:SourceArn': { Ref: 'Events' } } },
            }],
          },
        },
      },
      EventsToInbox: {
        Type: 'AWS::SNS::Subscription',
        Properties: { TopicArn: { Ref: 'Events' }, Protocol: 'sqs', Endpoint: { 'Fn::GetAtt': ['Inbox', 'Arn'] }, RawMessageDelivery: true },
      },
      ConfigSet: {
        Type: 'AWS::SES::ConfigurationSet',
        Properties: { Name: { Ref: 'ConfigSetName' } },
      },
      ConfigSetEvents: {
        Type: 'AWS::SES::ConfigurationSetEventDestination',
        DependsOn: ['EventsPolicy'],
        Properties: {
          ConfigurationSetName: { Ref: 'ConfigSet' },
          EventDestination: {
            Name: 'lynechat-events',
            Enabled: true,
            MatchingEventTypes: ['SEND', 'DELIVERY', 'OPEN', 'CLICK', 'BOUNCE', 'COMPLAINT', 'REJECT', 'RENDERING_FAILURE'],
            SnsDestination: { TopicARN: { Ref: 'Events' } },
          },
        },
      },
      FnRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
          },
          ManagedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
          Policies: [{
            PolicyName: 'send-to-inbox',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: { 'Fn::GetAtt': ['Inbox', 'Arn'] } }],
            },
          }],
        },
      },
      Fn: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          Runtime: 'nodejs22.x',
          Handler: 'index.handler',
          Role: { 'Fn::GetAtt': ['FnRole', 'Arn'] },
          Timeout: 10,
          MemorySize: 256,
          Environment: { Variables: { QUEUE_URL: { Ref: 'Inbox' }, SECRET: { Ref: 'Secret' } } },
          Code: { ZipFile: code },
        },
      },
      FnUrl: {
        Type: 'AWS::Lambda::Url',
        Properties: {
          AuthType: 'NONE',
          TargetFunctionArn: { 'Fn::GetAtt': ['Fn', 'Arn'] },
          Cors: { AllowOrigins: ['*'], AllowMethods: ['POST'], AllowHeaders: ['content-type'] },
        },
      },
      FnUrlPublic: {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          FunctionName: { Ref: 'Fn' },
          Action: 'lambda:InvokeFunctionUrl',
          Principal: '*',
          FunctionUrlAuthType: 'NONE',
        },
      },
      FnInvokePublic: {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          FunctionName: { Ref: 'Fn' },
          Action: 'lambda:InvokeFunction',
          Principal: '*',
          InvokedViaFunctionUrl: true,
        },
      },
    },
    Outputs: {
      PublicUrl: { Value: { 'Fn::GetAtt': ['FnUrl', 'FunctionUrl'] } },
      InboxUrl: { Value: { Ref: 'Inbox' } },
      ConfigSet: { Value: { Ref: 'ConfigSet' } },
    },
  };
}

module.exports = { buildTemplate };
