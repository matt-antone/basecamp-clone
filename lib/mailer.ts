import { config } from "./config-core.ts";
import { marked } from "marked";

export type MailRecipient = {
  email: string;
  name?: string | null;
};

function buildProjectLabel(project: { name: string; client_code?: string | null; project_code?: string | null }): string {
  const parts = [project.project_code ?? project.client_code, project.name].filter(Boolean);
  return parts.join("-");
}

marked.setOptions({ gfm: true, breaks: true });

function markdownToEmailHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
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
  return `Basic ${btoa(`api:${apiKey}`)}`;
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
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] New discussion: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const bodyHtml = markdownToEmailHtml(args.thread.bodyMarkdown);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} started a new discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      args.thread.bodyMarkdown,
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> started a new discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      bodyHtml,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendCommentCreatedEmail(args: CommentEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] New comment on: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const commentBodyHtml = markdownToEmailHtml(args.comment.bodyMarkdown);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} commented on a discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      args.comment.bodyMarkdown,
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> commented on a discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      commentBodyHtml,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendCommentUpdatedEmail(args: CommentEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] Comment updated on: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const commentBodyHtml = markdownToEmailHtml(args.comment.bodyMarkdown);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} updated a comment in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      args.comment.bodyMarkdown,
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> updated a comment in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      commentBodyHtml,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendThreadUpdatedEmail(args: ThreadEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] Discussion updated: ${args.thread.title}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedThreadTitle = escapeHtml(args.thread.title);
  const escapedThreadUrl = escapeHtml(args.threadUrl);
  const bodyHtml = markdownToEmailHtml(args.thread.bodyMarkdown);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} updated a discussion in ${args.project.name}.`,
      "",
      `Thread: ${args.thread.title}`,
      args.thread.bodyMarkdown,
      `Open: ${args.threadUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> updated a discussion in <strong>${escapedProjectName}</strong>.</p>`,
      `<p><strong>Thread:</strong> ${escapedThreadTitle}</p>`,
      bodyHtml,
      `<p><a href="${escapedThreadUrl}">Open discussion</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendProjectCreatedEmail(args: ProjectEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] New project created`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedProjectUrl = escapeHtml(args.projectUrl);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} created a new project: ${args.project.name}.`,
      "",
      `Open: ${args.projectUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> created a new project: <strong>${escapedProjectName}</strong>.</p>`,
      `<p><a href="${escapedProjectUrl}">Open project</a></p>`,
      "</div>"
    ].join("")
  });
}

export async function sendProjectUpdatedEmail(args: ProjectEmailArgs) {
  const projectLabel = buildProjectLabel(args.project);
  const subject = `[${projectLabel}] Project updated: ${args.project.name}`;
  const escapedActorName = escapeHtml(args.actor.name);
  const escapedProjectName = escapeHtml(args.project.name);
  const escapedProjectUrl = escapeHtml(args.projectUrl);

  return sendMail({
    recipients: args.recipients,
    subject,
    text: [
      `${args.actor.name} updated project: ${args.project.name}.`,
      "",
      `Open: ${args.projectUrl}`
    ].join("\n"),
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;\">",
      `<p><strong>${escapedActorName}</strong> updated project: <strong>${escapedProjectName}</strong>.</p>`,
      `<p><a href="${escapedProjectUrl}">Open project</a></p>`,
      "</div>"
    ].join("")
  });
}
