// Accès à AWS : déploiement de l'infrastructure, identités d'envoi, envoi SES, lecture de la file d'événements.
// LYNECHAT_FAKE_AWS=1 remplace AWS par une simulation locale (tests uniquement).
const crypto = require('crypto');
const { buildTemplate } = require('../aws/template');

const STACK = 'lynechat';

class RealAws {
  constructor({ region, accessKeyId, secretAccessKey }) {
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    const { SQSClient } = require('@aws-sdk/client-sqs');
    const { CloudFormationClient } = require('@aws-sdk/client-cloudformation');
    const cfg = { region, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 4 };
    this.region = region;
    this.ses = new SESv2Client(cfg);
    this.sqs = new SQSClient(cfg);
    this.cfn = new CloudFormationClient(cfg);
    this.sesCmd = require('@aws-sdk/client-sesv2');
    this.sqsCmd = require('@aws-sdk/client-sqs');
    this.cfnCmd = require('@aws-sdk/client-cloudformation');
  }

  async account() {
    const r = await this.ses.send(new this.sesCmd.GetAccountCommand({}));
    return {
      production: !!r.ProductionAccessEnabled,
      sendingEnabled: r.SendingEnabled !== false,
      max24h: r.SendQuota?.Max24HourSend ?? 0,
      maxRate: r.SendQuota?.MaxSendRate ?? 1,
      sent24h: r.SendQuota?.SentLast24Hours ?? 0,
      enforcement: r.EnforcementStatus || '',
    };
  }

  async identities() {
    const out = [];
    let NextToken;
    do {
      const r = await this.ses.send(new this.sesCmd.ListEmailIdentitiesCommand({ NextToken, PageSize: 100 }));
      for (const i of r.EmailIdentities || []) out.push({ name: i.IdentityName, type: i.IdentityType, verified: !!i.SendingEnabled, status: i.VerificationStatus });
      NextToken = r.NextToken;
    } while (NextToken);
    return out;
  }

  async identity(name) {
    const r = await this.ses.send(new this.sesCmd.GetEmailIdentityCommand({ EmailIdentity: name }));
    return {
      name, type: r.IdentityType, verified: !!r.VerifiedForSendingStatus,
      dkimStatus: r.DkimAttributes?.Status || '', dkimTokens: r.DkimAttributes?.Tokens || [],
      mailFrom: r.MailFromAttributes?.MailFromDomain || '',
    };
  }

  async createIdentity(name) {
    await this.ses.send(new this.sesCmd.CreateEmailIdentityCommand({ EmailIdentity: name }));
    return this.identity(name);
  }

  async deleteIdentity(name) { await this.ses.send(new this.sesCmd.DeleteEmailIdentityCommand({ EmailIdentity: name })); }

  /** Crée ou met à jour la pile CloudFormation et attend la fin. */
  async deploy(secret, configSetName, onStatus = () => {}) {
    const C = this.cfnCmd;
    const TemplateBody = JSON.stringify(buildTemplate());
    const Parameters = [{ ParameterKey: 'Secret', ParameterValue: secret }, { ParameterKey: 'ConfigSetName', ParameterValue: configSetName }];
    let exists = false;
    try { const d = await this.cfn.send(new C.DescribeStacksCommand({ StackName: STACK })); exists = d.Stacks?.[0] && d.Stacks[0].StackStatus !== 'DELETE_COMPLETE'; } catch { exists = false; }
    if (exists) {
      try { await this.cfn.send(new C.UpdateStackCommand({ StackName: STACK, TemplateBody, Parameters, Capabilities: ['CAPABILITY_IAM'] })); } catch (e) {
        if (!/No updates are to be performed/i.test(e.message)) throw e;
      }
    } else {
      await this.cfn.send(new C.CreateStackCommand({ StackName: STACK, TemplateBody, Parameters, Capabilities: ['CAPABILITY_IAM'], OnFailure: 'DELETE' }));
    }
    for (let i = 0; i < 180; i++) {
      const d = await this.cfn.send(new C.DescribeStacksCommand({ StackName: STACK })).catch((e) => ({ error: e }));
      if (d.error) throw new Error(`Création interrompue : ${d.error.message}`);
      const s = d.Stacks[0];
      onStatus(s.StackStatus);
      if (/_COMPLETE$/.test(s.StackStatus) && !/ROLLBACK|DELETE/.test(s.StackStatus)) {
        const out = Object.fromEntries((s.Outputs || []).map((o) => [o.OutputKey, o.OutputValue]));
        return { publicUrl: out.PublicUrl, inboxUrl: out.InboxUrl, configSet: out.ConfigSet };
      }
      if (/FAILED|ROLLBACK|DELETE/.test(s.StackStatus) && !/IN_PROGRESS/.test(s.StackStatus)) {
        const ev = await this.cfn.send(new C.DescribeStackEventsCommand({ StackName: STACK })).catch(() => ({ StackEvents: [] }));
        const why = (ev.StackEvents || []).find((x) => /FAILED/.test(x.ResourceStatus) && x.ResourceStatusReason);
        throw new Error(`Échec (${s.StackStatus})${why ? ` : ${why.LogicalResourceId} — ${why.ResourceStatusReason}` : ''}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error('Délai dépassé pendant la création de l’infrastructure.');
  }

  async send(msg) {
    const r = await this.ses.send(new this.sesCmd.SendEmailCommand({
      FromEmailAddress: msg.from,
      Destination: { ToAddresses: [msg.to] },
      ReplyToAddresses: msg.replyTo ? [msg.replyTo] : undefined,
      ConfigurationSetName: msg.configSet,
      EmailTags: Object.entries(msg.tags || {}).map(([Name, Value]) => ({ Name, Value })),
      Content: {
        Simple: {
          Subject: { Data: msg.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: msg.html, Charset: 'UTF-8' }, Text: { Data: msg.text, Charset: 'UTF-8' } },
          Headers: (msg.headers || []).map(([Name, Value]) => ({ Name, Value })),
          Attachments: msg.attachments?.length ? msg.attachments.map((a) => ({
            RawContent: a.data, FileName: a.filename, ContentType: a.mime, ContentId: a.cid,
            ContentDisposition: 'INLINE', ContentTransferEncoding: 'BASE64',
          })) : undefined,
        },
      },
    }));
    return r.MessageId;
  }

  async receive(queueUrl) {
    const r = await this.sqs.send(new this.sqsCmd.ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 10, VisibilityTimeout: 60 }));
    return (r.Messages || []).map((m) => ({ body: m.Body, handle: m.ReceiptHandle }));
  }

  async ack(queueUrl, handles) {
    if (!handles.length) return;
    await this.sqs.send(new this.sqsCmd.DeleteMessageBatchCommand({ QueueUrl: queueUrl, Entries: handles.map((h, i) => ({ Id: String(i), ReceiptHandle: h })) }));
  }
}

/** Simulation : envois réussis, événements de remise / ouverture / clic générés aléatoirement. */
class FakeAws {
  constructor() { this.region = 'fake-1'; this.queue = []; this.sent = []; this.ids = new Map(); }
  async account() { return { production: false, sendingEnabled: true, max24h: 200, maxRate: 14, sent24h: this.sent.length, enforcement: 'HEALTHY' }; }
  async identities() { return [...this.ids.values()]; }
  async identity(name) { return this.ids.get(name) || { name, verified: false, dkimTokens: [] }; }
  async createIdentity(name) {
    const domain = !name.includes('@');
    const i = { name, type: domain ? 'DOMAIN' : 'EMAIL_ADDRESS', verified: true, dkimStatus: 'SUCCESS', dkimTokens: domain ? ['abc123', 'def456', 'ghi789'] : [] };
    this.ids.set(name, i); return i;
  }
  async deleteIdentity(name) { this.ids.delete(name); }
  async deploy(secret, configSetName, onStatus) { onStatus('CREATE_IN_PROGRESS'); await new Promise((r) => setTimeout(r, 300)); onStatus('CREATE_COMPLETE'); return { publicUrl: 'https://fake.lambda-url.local/', inboxUrl: 'fake-queue', configSet: configSetName }; }
  async send(msg) {
    if (/fail@/.test(msg.to)) throw new Error('MessageRejected: Email address is not verified.');
    const mid = `fake-${crypto.randomBytes(8).toString('hex')}`;
    this.sent.push({ ...msg, messageId: mid });
    const tags = Object.fromEntries(Object.entries(msg.tags || {}).map(([k, v]) => [k, [v]]));
    const mail = { messageId: mid, destination: [msg.to], tags, timestamp: new Date().toISOString() };
    const push = (o) => this.queue.push({ body: JSON.stringify({ mail, ...o }), handle: crypto.randomUUID() });
    push({ eventType: 'Send', send: {} });
    if (/bounce@/.test(msg.to)) push({ eventType: 'Bounce', bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: msg.to }] } });
    else {
      push({ eventType: 'Delivery', delivery: {} });
      if (Math.random() < 0.6) push({ eventType: 'Open', open: { isBotEvent: 'Unlikely' } });
      const links = [...msg.html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.includes('/u?'));
      if (links.length && Math.random() < 0.3) push({ eventType: 'Click', click: { link: links[0], isBotEvent: 'Unlikely' } });
    }
    return mid;
  }
  async receive() { await new Promise((r) => setTimeout(r, 200)); return this.queue.splice(0, 10); }
  async ack() {}
}

function makeAws(creds) {
  if (process.env.LYNECHAT_FAKE_AWS === '1') return (makeAws.fake ||= new FakeAws());
  if (!creds?.accessKeyId || !creds?.secretAccessKey || !creds?.region) return null;
  return new RealAws(creds);
}

/** Politique IAM minimale recommandée pour l'utilisateur IAM d'Lynechat. */
const IAM_POLICY = {
  Version: '2012-10-17',
  Statement: [
    { Sid: 'SES', Effect: 'Allow', Action: ['ses:*'], Resource: '*' },
    { Sid: 'Infra', Effect: 'Allow', Action: ['cloudformation:*', 'sqs:*', 'sns:*', 'lambda:*', 'logs:*'], Resource: '*' },
    { Sid: 'Role', Effect: 'Allow', Action: ['iam:CreateRole', 'iam:DeleteRole', 'iam:GetRole', 'iam:PassRole', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy', 'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:TagRole', 'iam:GetRolePolicy'], Resource: 'arn:aws:iam::*:role/lynechat-*' },
  ],
};

module.exports = { makeAws, IAM_POLICY, STACK };
