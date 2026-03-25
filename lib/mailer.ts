import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { SentMessageInfo, Transporter } from "nodemailer";
import { config } from "./config";

export type MailRecipient = {
  email: string;
  name?: string | null;
};

type ThreadEmailArgs = {
  recipients: MailRecipient[];
  actor: {
    name: string;
    email: string;
  };
  project: {
    id: string;
    name: string;
  };
  thread: {
    id: string;
    title: string;
  };
  threadUrl: string;
};

type CommentEmailArgs = ThreadEmailArgs & {
  comment: {
    id: string;
    excerpt: string;
  };
};

export type SendMailResult =
  | { skipped: true; reason: "disabled" | "no_recipients" }
  | { skipped: false; recipientCount: number; messageId?: string };

let cachedTransporter: Transporter<SentMessageInfo> | null = null;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toTransportRecipients(recipients: MailRecipient[]): string[] {
  return recipients.map((recipient) =>
    recipient.name ? `"${recipient.name.replaceAll('"', '\\"')}" <${recipient.email}>` : recipient.email
  );
}

export function createCommentExcerpt(bodyMarkdown: string, maxLength = 180) {
  const normalized = bodyMarkdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

export function buildSmtpTransportOptions(): SMTPTransport.Options {
  const username = config.smtpUsername();
  const password = config.smtpPassword();

  if ((username && !password) || (!username && password)) {
    throw new Error("SMTP_USERNAME and SMTP_PASSWORD must both be set when using SMTP auth");
  }

  return {
    host: config.smtpHost(),
    port: config.smtpPort(),
    secure: config.smtpSecure(),
    ...(username && password
      ? {
          auth: {
            user: username,
            pass: password
          }
        }
      : {})
  };
}

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport(buildSmtpTransportOptions());
  }

  return cachedTransporter;
}

export function resetMailerForTests() {
  cachedTransporter = null;
}

export async function sendMail(args: {
  recipients: MailRecipient[];
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}): Promise<SendMailResult> {
  if (!config.emailEnabled()) {
    return { skipped: true, reason: "disabled" };
  }

  if (args.recipients.length === 0) {
    return { skipped: true, reason: "no_recipients" };
  }

  const result = (await getTransporter().sendMail({
    from: config.emailFrom(),
    to: toTransportRecipients(args.recipients),
    subject: args.subject,
    text: args.text,
    html: args.html,
    ...(args.replyTo ? { replyTo: args.replyTo } : {})
  })) as SentMessageInfo;

  return {
    skipped: false,
    recipientCount: args.recipients.length,
    messageId: result.messageId
  };
}

export async function sendThreadCreatedEmail(args: ThreadEmailArgs) {
  const subject = `[${args.project.name}] New discussion: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} started a new discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> started a new discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendCommentCreatedEmail(args: CommentEmailArgs) {
  const subject = `[${args.project.name}] New comment on: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedExcerpt = escapeHtml(args.comment.excerpt);
  const escapedThreadUrl = escapeHtml(args.threadUrl);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} commented on a discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      `Comment: ${args.comment.excerpt}`,
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> commented on a discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      `<p style="padding: 12px; border-left: 3px solid #d1d5db; background: #f9fafb;">${escapedExcerpt}</p>`,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}
