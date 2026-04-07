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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toMailRecipients(recipients: MailRecipient[]): string[] {
  return recipients.map((recipient) =>
    recipient.name ? `"${recipient.name.replaceAll('"', '\\"')}" <${recipient.email}>` : recipient.email
  );
}

function buildMailgunMessagesUrl() {
  const baseUrl = config.mailgunBaseUrl().replace(/\/+$/, "");
  const domain = config.mailgunDomain();
  return `${baseUrl}/v3/${domain}/messages`;
}

function buildMailgunAuthorization() {
  const apiKey = config.mailgunApiKey();
  return `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`;
}

export function resetMailerForTests() {
  // No-op retained for compatibility with existing tests/importers.
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

  const form = new URLSearchParams();
  form.set("from", config.emailFrom());
  for (const recipient of toMailRecipients(args.recipients)) {
    form.append("to", recipient);
  }
  form.set("subject", args.subject);
  form.set("text", args.text);
  form.set("html", args.html);

  if (args.replyTo) {
    form.set("h:Reply-To", args.replyTo);
  }

  const response = await fetch(buildMailgunMessagesUrl(), {
    method: "POST",
    headers: {
      Authorization: buildMailgunAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mailgun API request failed (${response.status}): ${body || response.statusText}`);
  }

  const payload = (await response.json()) as { id?: string };

  return {
    skipped: false,
    recipientCount: args.recipients.length,
    messageId: payload.id
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
      `<p><a href=\"${escapedThreadUrl}\">Open discussion</a></p>`,
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
      `<p style=\"padding: 12px; border-left: 3px solid #d1d5db; background: #f9fafb;\">${escapedExcerpt}</p>`,
      `<p><a href=\"${escapedThreadUrl}\">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}
