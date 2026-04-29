import { config } from "./config-core.ts";
import { marked } from "marked";

type MailRecipient = {
  email: string;
  name?: string | null;
};

function buildProjectLabel(project: { name: string; client_code?: string | null; project_code?: string | null }): string {
  const parts = [project.project_code ?? project.client_code, project.name].filter(Boolean);
  return parts.join("-");
}

function markdownToEmailHtml(md: string): string {
  return marked.parse(md, { gfm: true, breaks: true }) as string;
}

type ThreadEmailArgs = {
  recipients: MailRecipient[];
  actor: {
    name: string;
    email: string;
  };
  project: {
    id: string;
    name: string;
    client_code?: string | null;
    project_code?: string | null;
  };
  thread: {
    id: string;
    title: string;
    bodyMarkdown: string;
  };
  threadUrl: string;
};

type CommentEmailArgs = ThreadEmailArgs & {
  comment: {
    id: string;
    bodyMarkdown: string;
  };
};

type ProjectEmailArgs = {
  recipients: MailRecipient[];
  actor: { name: string; email: string };
  project: { id: string; name: string; client_code?: string | null; project_code?: string | null };
  projectUrl: string;
};

type SendMailResult =
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
  return `Basic ${btoa(`api:${apiKey}`)}`;
}

type ThreadEmailContentOpts = {
  subjectPrefix: string;
  actionDescription: string;
  bodyMarkdown: string;
};

function buildThreadEmailContent(args: ThreadEmailArgs, opts: ThreadEmailContentOpts) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] ${opts.subjectPrefix}: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const bodyHtml = markdownToEmailHtml(opts.bodyMarkdown);

  const text = [
    `${args.actor.name} ${opts.actionDescription} in ${args.project.name}.`,
    "",
    `Thread: ${args.thread.title}`,
    opts.bodyMarkdown,
    `Open: ${args.threadUrl}`
  ].join("\n");

  const html = [
    "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
    `<p><strong>${escapedActorName}</strong> ${opts.actionDescription} in <strong>${escapedProjectName}</strong>.</p>`,
    `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
    bodyHtml,
    `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
    "</div>"
  ].join("");

  return { subject, text, html };
}

type ProjectEmailContentOpts = {
  subjectPrefix: string;
  actionDescription: string;
};

function buildProjectEmailContent(args: ProjectEmailArgs, opts: ProjectEmailContentOpts) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] ${opts.subjectPrefix}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedProjectUrl = escapeHtml(args.projectUrl);

  const text = [
    `${args.actor.name} ${opts.actionDescription}: ${args.project.name}.`,
    "",
    `Open: ${args.projectUrl}`
  ].join("\n");

  const html = [
    "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
    `<p><strong>${escapedActorName}</strong> ${opts.actionDescription}: <strong>${escapedProjectName}</strong>.</p>`,
    `<p><a href="${escapedProjectUrl}">Open project</a></p>`,
    "</div>"
  ].join("");

  return { subject, text, html };
}

export function resetMailerForTests() {
  // No-op retained for compatibility with existing tests/importers.
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
  const { subject, text, html } = buildThreadEmailContent(args, {
    subjectPrefix: "New discussion",
    actionDescription: "started a new discussion",
    bodyMarkdown: args.thread.bodyMarkdown
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendCommentCreatedEmail(args: CommentEmailArgs) {
  const { subject, text, html } = buildThreadEmailContent(args, {
    subjectPrefix: "New comment on",
    actionDescription: "commented on a discussion",
    bodyMarkdown: args.comment.bodyMarkdown
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendCommentUpdatedEmail(args: CommentEmailArgs) {
  const { subject, text, html } = buildThreadEmailContent(args, {
    subjectPrefix: "Comment updated on",
    actionDescription: "updated a comment",
    bodyMarkdown: args.comment.bodyMarkdown
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendThreadUpdatedEmail(args: ThreadEmailArgs) {
  const { subject, text, html } = buildThreadEmailContent(args, {
    subjectPrefix: "Discussion updated",
    actionDescription: "updated a discussion",
    bodyMarkdown: args.thread.bodyMarkdown
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendProjectCreatedEmail(args: ProjectEmailArgs) {
  const { subject, text, html } = buildProjectEmailContent(args, {
    subjectPrefix: "New project created",
    actionDescription: "created a new project"
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}

export async function sendProjectUpdatedEmail(args: ProjectEmailArgs) {
  const { subject, text, html } = buildProjectEmailContent(args, {
    subjectPrefix: `Project updated: ${args.project.name}`,
    actionDescription: "updated project"
  });
  return sendMail({ recipients: args.recipients, subject, text, html });
}
