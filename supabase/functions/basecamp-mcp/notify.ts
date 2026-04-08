// supabase/functions/basecamp-mcp/notify.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentIdentity } from "./auth.ts";
import * as db from "./db.ts";
import {
  sendCommentCreatedEmail,
  sendCommentUpdatedEmail,
  sendThreadCreatedEmail,
  sendThreadUpdatedEmail,
  sendProjectCreatedEmail,
  sendProjectUpdatedEmail,
} from "../../../lib/mailer.ts";

export type NotifyEvent =
  | { type: "comment_created"; projectId: string; threadId: string; threadTitle: string; commentId: string; excerpt: string }
  | { type: "comment_updated"; threadId: string; commentId: string; excerpt: string }
  | { type: "thread_created"; projectId: string; threadId: string; threadTitle: string }
  | { type: "thread_updated"; projectId: string; threadId: string; threadTitle: string }
  | { type: "project_created"; projectId: string }
  | { type: "project_updated"; projectId: string };

function resolveProjectId(
  supabase: SupabaseClient,
  event: NotifyEvent
): Promise<string | null> {
  if ("projectId" in event) return Promise.resolve(event.projectId);
  return db
    .getThreadForNotification(supabase, event.threadId)
    .then((t) => t?.project_id ?? null);
}

export function notifyBestEffort(
  supabase: SupabaseClient,
  agent: AgentIdentity,
  event: NotifyEvent
): void {
  const appUrl = (typeof Deno !== "undefined" ? Deno.env.get("APP_URL") : process.env.APP_URL) ?? "";
  const workspaceDomain = (typeof Deno !== "undefined" ? Deno.env.get("WORKSPACE_DOMAIN") : process.env.WORKSPACE_DOMAIN) ?? "";

  (async () => {
    try {
      const projectIdP = resolveProjectId(supabase, event);
      const recipientsP = db.listNotificationRecipients(supabase, workspaceDomain);
      const profileP = db.getProfile(supabase, agent.client_id);
      const threadP =
        event.type === "comment_updated"
          ? db.getThreadForNotification(supabase, event.threadId)
          : Promise.resolve(null);

      const [resolvedProjectId, recipients, profile] = await Promise.all([
        projectIdP,
        recipientsP,
        profileP,
      ]);

      if (recipients.length === 0) {
        console.info("mcp_notification_skipped", { type: event.type, reason: "no_recipients" });
        return;
      }
      if (!resolvedProjectId) return;

      const project = await db.getProjectForNotification(supabase, resolvedProjectId);
      if (!project) return;

      const actor = { name: profile?.name ?? "AI", email: "" };

      switch (event.type) {
        case "comment_created": {
          await sendCommentCreatedEmail({
            recipients,
            actor,
            project,
            thread: { id: event.threadId, title: event.threadTitle },
            threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
            comment: { id: event.commentId, excerpt: event.excerpt },
          });
          break;
        }
        case "comment_updated": {
          const thread = await threadP;
          if (!thread) return;
          await sendCommentUpdatedEmail({
            recipients,
            actor,
            project,
            thread: { id: thread.id, title: thread.title },
            threadUrl: `${appUrl}/${resolvedProjectId}/${thread.id}`,
            comment: { id: event.commentId, excerpt: event.excerpt },
          });
          break;
        }
        case "thread_created": {
          await sendThreadCreatedEmail({
            recipients,
            actor,
            project,
            thread: { id: event.threadId, title: event.threadTitle },
            threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
          });
          break;
        }
        case "thread_updated": {
          await sendThreadUpdatedEmail({
            recipients,
            actor,
            project,
            thread: { id: event.threadId, title: event.threadTitle },
            threadUrl: `${appUrl}/${resolvedProjectId}/${event.threadId}`,
          });
          break;
        }
        case "project_created": {
          await sendProjectCreatedEmail({
            recipients,
            actor,
            project,
            projectUrl: `${appUrl}/${resolvedProjectId}`,
          });
          break;
        }
        case "project_updated": {
          await sendProjectUpdatedEmail({
            recipients,
            actor,
            project,
            projectUrl: `${appUrl}/${resolvedProjectId}`,
          });
          break;
        }
      }

      console.info("mcp_notification_sent", { type: event.type, recipientCount: recipients.length });
    } catch (e) {
      console.error("mcp_notification_failed", { type: event.type, error: String(e) });
    }
  })();
}
