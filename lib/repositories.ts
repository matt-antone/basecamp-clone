import slugify from "slugify";
import { config } from "./config";
import { query } from "./db";
import { renderMarkdown } from "./markdown";

export type UserProfile = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  timezone: string | null;
  bio: string | null;
};

export async function getUserProfileById(id: string) {
  const result = await query("select * from user_profiles where id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function createUserProfile(profile: UserProfile) {
  const result = await query(
    `insert into user_profiles (id, email, first_name, last_name, avatar_url, job_title, timezone, bio)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (id) do nothing
     returning *`,
    [
      profile.id,
      profile.email,
      profile.firstName,
      profile.lastName,
      profile.avatarUrl,
      profile.jobTitle,
      profile.timezone,
      profile.bio
    ]
  );
  return result.rows[0] ?? null;
}

export async function updateUserProfile(args: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  timezone: string | null;
  bio: string | null;
}) {
  const result = await query(
    `update user_profiles
     set first_name = $2,
         last_name = $3,
         avatar_url = $4,
         job_title = $5,
         timezone = $6,
         bio = $7,
         updated_at = now(),
         last_seen_at = now()
     where id = $1
     returning *`,
    [args.id, args.firstName, args.lastName, args.avatarUrl, args.jobTitle, args.timezone, args.bio]
  );
  return result.rows[0] ?? null;
}

export async function listClients() {
  const result = await query("select * from clients order by name asc");
  return result.rows;
}

export async function createClient(args: { name: string; code: string }) {
  const code = args.code.trim().toUpperCase();
  const result = await query(
    `insert into clients (name, code)
     values ($1, $2)
     returning *`,
    [args.name.trim(), code]
  );
  return result.rows[0];
}

export async function getClientById(id: string) {
  const result = await query("select * from clients where id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function listProjects(includeArchived = true) {
  const sql = includeArchived
    ? `select p.*, c.name as client_name, c.code as client_code,
         case
           when p.project_code is not null and length(trim(p.project_code)) > 0 then p.project_code || '-' || p.name
           else p.name
         end as display_name
       from projects p
       left join clients c on c.id = p.client_id
       order by p.created_at desc`
    : `select p.*, c.name as client_name, c.code as client_code,
         case
           when p.project_code is not null and length(trim(p.project_code)) > 0 then p.project_code || '-' || p.name
           else p.name
         end as display_name
       from projects p
       left join clients c on c.id = p.client_id
       where p.archived = false
       order by p.created_at desc`;
  const result = await query(sql);
  return result.rows;
}

function normalizeProjectTags(tags?: string[]) {
  if (!tags) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0)
    )
  );
}

export async function createProject(args: {
  name: string;
  description?: string;
  createdBy: string;
  clientId?: string;
  tags?: string[];
}) {
  const projectTitle = args.name.trim();
  if (!projectTitle) {
    throw new Error("Project name is required");
  }
  if (!args.clientId) {
    throw new Error("Client is required");
  }

  const client = await getClientById(args.clientId);
  if (!client) {
    throw new Error("Selected client not found");
  }

  const clientSlug = slugify(client.name, { strict: true }) || slugify(client.code, { strict: true }) || "client";
  const projectSlug = slugify(projectTitle, { lower: true, strict: true }) || "project";
  const normalizedTags = normalizeProjectTags(args.tags);
  const projectsRoot = config.dropboxProjectsRootFolder();
  const result = await query(
    `with lock as (
       select pg_advisory_xact_lock(hashtext('project-seq:' || $4::uuid::text))
     ),
     next_seq as (
       select coalesce(max(project_seq), 0) + 1 as seq
       from projects
       where client_id = $4::uuid
         and exists(select 1 from lock)
     )
     insert into projects (
       name, slug, description, created_by, client_id, status, project_seq, project_code, client_slug, project_slug, tags, storage_project_dir
     )
     select
       $1,
       lower($5 || '-' || lpad(next_seq.seq::text, 4, '0') || '-' || $7),
       $2,
       $3,
       $4::uuid,
       'new',
       next_seq.seq,
       $5 || '-' || lpad(next_seq.seq::text, 4, '0'),
       $6,
       $7,
       $8::text[],
       $9 || '/' || $6 || '/' || $5 || '-' || lpad(next_seq.seq::text, 4, '0') || '-' || $7
     from next_seq
     returning *`,
    [
      projectTitle,
      args.description ?? null,
      args.createdBy,
      args.clientId,
      client.code,
      clientSlug,
      projectSlug,
      normalizedTags,
      projectsRoot
    ]
  );
  return result.rows[0];
}

export async function getProject(id: string) {
  const result = await query(
    `select p.*, c.name as client_name, c.code as client_code,
       case
         when p.project_code is not null and length(trim(p.project_code)) > 0 then p.project_code || '-' || p.name
         else p.name
       end as display_name
     from projects p
     left join clients c on c.id = p.client_id
     where p.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function updateProject(args: {
  id: string;
  name: string;
  description?: string;
  clientId: string;
  tags?: string[];
  requestor?: string | null;
  personalHours?: number | string | null;
}) {
  const current = await getProject(args.id);
  if (!current) {
    return null;
  }
  if (current.client_id !== args.clientId) {
    throw new Error("Cannot change project client after creation");
  }

  const nextTags = args.tags === undefined ? current.tags ?? [] : normalizeProjectTags(args.tags);
  const nextRequestor =
    args.requestor === undefined
      ? current.requestor ?? null
      : typeof args.requestor === "string"
        ? args.requestor.trim() || null
        : null;
  const nextPersonalHours = args.personalHours === undefined ? current.personal_hours ?? null : args.personalHours;
  const result = await query(
    `update projects
     set name = $2,
         description = $3,
         tags = $4::text[],
         requestor = $5,
         personal_hours = $6,
         updated_at = now()
     where id = $1
     returning *`,
    [args.id, args.name.trim(), args.description ?? null, nextTags, nextRequestor, nextPersonalHours]
  );

  return result.rows[0] ?? null;
}

export async function setProjectStorageDir(id: string, storageProjectDir: string) {
  const result = await query(
    `update projects
     set storage_project_dir = $2,
         updated_at = now()
     where id = $1
     returning *`,
    [id, storageProjectDir]
  );
  return result.rows[0] ?? null;
}

export async function deleteProjectById(id: string) {
  await query("delete from projects where id = $1", [id]);
}

export async function setProjectArchived(id: string, archived: boolean) {
  const result = await query(
    `update projects
     set archived = $2, updated_at = now()
     where id = $1
     returning *`,
    [id, archived]
  );
  return result.rows[0] ?? null;
}

export async function setProjectArchivedWithStorageDir(id: string, archived: boolean, storageProjectDir: string) {
  const result = await query(
    `update projects
     set archived = $2,
         storage_project_dir = $3,
         updated_at = now()
     where id = $1
     returning *`,
    [id, archived, storageProjectDir]
  );
  return result.rows[0] ?? null;
}

export async function setProjectStatus(
  id: string,
  status: "new" | "in_progress" | "blocked" | "complete"
) {
  const result = await query(
    `update projects
     set status = $2, updated_at = now()
     where id = $1
     returning *`,
    [id, status]
  );
  return result.rows[0] ?? null;
}

export async function listThreads(projectId: string) {
  const result = await query(
    `select
       discussion_threads.*,
       user_profiles.email as starter_email,
       user_profiles.first_name as starter_first_name,
       user_profiles.last_name as starter_last_name
     from discussion_threads
     left join user_profiles on user_profiles.id = discussion_threads.author_user_id
     where discussion_threads.project_id = $1
     order by discussion_threads.created_at desc`,
    [projectId]
  );
  return result.rows;
}

export async function createThread(args: {
  projectId: string;
  title: string;
  bodyMarkdown: string;
  authorUserId: string;
}) {
  const bodyHtml = renderMarkdown(args.bodyMarkdown);
  const result = await query(
    `insert into discussion_threads (project_id, title, body_markdown, body_html, author_user_id)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [args.projectId, args.title, args.bodyMarkdown, bodyHtml, args.authorUserId]
  );
  return result.rows[0];
}

export async function getThread(projectId: string, threadId: string) {
  const threadResult = await query(
    `select
       discussion_threads.*,
       user_profiles.email as starter_email,
       user_profiles.first_name as starter_first_name,
       user_profiles.last_name as starter_last_name
     from discussion_threads
     left join user_profiles on user_profiles.id = discussion_threads.author_user_id
     where discussion_threads.project_id = $1 and discussion_threads.id = $2`,
    [projectId, threadId]
  );
  const thread = threadResult.rows[0] ?? null;
  if (!thread) {
    return null;
  }

  const commentsResult = await query(
    `select
       discussion_comments.*,
       user_profiles.email as author_email,
       user_profiles.first_name as author_first_name,
       user_profiles.last_name as author_last_name
     from discussion_comments
     left join user_profiles on user_profiles.id = discussion_comments.author_user_id
     where discussion_comments.project_id = $1 and discussion_comments.thread_id = $2
     order by discussion_comments.created_at asc`,
    [projectId, threadId]
  );

  const attachmentsResult = await query(
    `select id, project_id, thread_id, comment_id, filename, mime_type, size_bytes, created_at
     from project_files
     where project_id = $1 and thread_id = $2 and comment_id is not null
     order by created_at asc`,
    [projectId, threadId]
  );

  const filesByComment = new Map<string, typeof attachmentsResult.rows>();
  for (const attachment of attachmentsResult.rows) {
    const commentId = String(attachment.comment_id ?? "");
    if (!commentId) {
      continue;
    }
    const current = filesByComment.get(commentId) ?? [];
    current.push(attachment);
    filesByComment.set(commentId, current);
  }

  return {
    ...thread,
    comments: commentsResult.rows.map((comment) => ({
      ...comment,
      attachments: filesByComment.get(String(comment.id)) ?? []
    }))
  };
}

export async function getComment(projectId: string, threadId: string, commentId: string) {
  const result = await query(
    `select *
     from discussion_comments
     where project_id = $1 and thread_id = $2 and id = $3`,
    [projectId, threadId, commentId]
  );
  return result.rows[0] ?? null;
}

export async function createComment(args: {
  projectId: string;
  threadId: string;
  bodyMarkdown: string;
  authorUserId: string;
}) {
  const bodyHtml = renderMarkdown(args.bodyMarkdown);
  const result = await query(
    `insert into discussion_comments (project_id, thread_id, body_markdown, body_html, author_user_id)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [args.projectId, args.threadId, args.bodyMarkdown, bodyHtml, args.authorUserId]
  );
  return result.rows[0];
}

export async function editComment(args: {
  projectId: string;
  threadId: string;
  commentId: string;
  bodyMarkdown: string;
}) {
  const bodyHtml = renderMarkdown(args.bodyMarkdown);
  const result = await query(
    `update discussion_comments
     set body_markdown = $4, body_html = $5, edited_at = now(), updated_at = now()
     where project_id = $1 and thread_id = $2 and id = $3
     returning *`,
    [args.projectId, args.threadId, args.commentId, args.bodyMarkdown, bodyHtml]
  );
  return result.rows[0] ?? null;
}

export async function listFiles(projectId: string) {
  const result = await query(
    "select * from project_files where project_id = $1 order by created_at desc",
    [projectId]
  );
  return result.rows;
}

export async function createFileMetadata(args: {
  projectId: string;
  uploaderUserId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dropboxFileId: string;
  dropboxPath: string;
  checksum: string;
  threadId?: string | null;
  commentId?: string | null;
}) {
  const values = [
    args.projectId,
    args.uploaderUserId,
    args.filename,
    args.mimeType,
    args.sizeBytes,
    args.dropboxFileId,
    args.dropboxPath,
    args.checksum,
    args.threadId ?? null,
    args.commentId ?? null
  ];

  try {
    const result = await query(
      `insert into project_files (
        project_id, uploader_user_id, filename, mime_type, size_bytes, dropbox_file_id, dropbox_path, checksum, thread_id, comment_id
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *`,
      values
    );
    return result.rows[0];
  } catch (error) {
    if (!isMissingProjectFileAttachmentColumnError(error)) {
      throw error;
    }

    if (args.threadId || args.commentId) {
      throw new Error("Comment attachments require database migration 0007_comment_attachments.sql");
    }

    const result = await query(
      `insert into project_files (
        project_id, uploader_user_id, filename, mime_type, size_bytes, dropbox_file_id, dropbox_path, checksum
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      values.slice(0, 8)
    );
    return result.rows[0];
  }
}

export async function getFileById(projectId: string, fileId: string) {
  const result = await query(
    "select * from project_files where project_id = $1 and id = $2",
    [projectId, fileId]
  );
  return result.rows[0] ?? null;
}

function isMissingProjectFileAttachmentColumnError(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: string; message?: string };
  if (candidate.code === "42703") {
    return true;
  }

  const message = candidate.message?.toLowerCase() ?? "";
  return (
    message.includes('column "thread_id"') ||
    message.includes('column "comment_id"') ||
    message.includes("project_files.thread_id") ||
    message.includes("project_files.comment_id")
  );
}
