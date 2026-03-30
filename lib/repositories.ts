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

export type NotificationRecipient = Pick<UserProfile, "id" | "email" | "firstName" | "lastName">;
export type SiteSettings = {
  siteTitle: string | null;
  logoUrl: string | null;
};

export type ProjectUserHours = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarUrl: string | null;
  hours: number | string;
};

function parseProjectFileSizeBytes(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
}

function normalizeProjectFileSizeRow<T extends Record<string, unknown>>(row: T): T {
  if (!Object.prototype.hasOwnProperty.call(row, "size_bytes")) {
    return row;
  }

  return {
    ...row,
    size_bytes: parseProjectFileSizeBytes((row as { size_bytes?: unknown }).size_bytes)
  } as T;
}

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

export async function listNotificationRecipients(excludeUserId: string): Promise<NotificationRecipient[]> {
  const result = await query(
    `select id,
            email,
            first_name as "firstName",
            last_name as "lastName"
     from user_profiles
     where id <> $1
       and lower(split_part(email, '@', 2)) = $2
     order by coalesce(first_name, ''), coalesce(last_name, ''), email`,
    [excludeUserId, config.workspaceDomain()]
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    firstName: typeof row.firstName === "string" ? row.firstName : null,
    lastName: typeof row.lastName === "string" ? row.lastName : null
  }));
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

export async function listArchivedProjectsPaginated(options: {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const search = (options.search ?? "").trim().toLowerCase();
  const status = options.status ?? "all";
  const limit = Math.min(options.limit ?? 20, 100);
  const page = Math.max(options.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const result = await query<{ total_count: string }>(
    `select p.*, c.name as client_name, c.code as client_code,
       case
         when p.project_code is not null and length(trim(p.project_code)) > 0 then p.project_code || '-' || p.name
         else p.name
       end as display_name,
       greatest(
         p.updated_at,
         coalesce((select max(t.updated_at) from discussion_threads t where t.project_id = p.id), p.updated_at),
         coalesce((select max(dc.updated_at) from discussion_comments dc where dc.project_id = p.id), p.updated_at),
         coalesce((select max(f.created_at) from project_files f where f.project_id = p.id), p.updated_at)
       ) as last_activity_at,
       count(*) over() as total_count
     from projects p
     left join clients c on c.id = p.client_id
     where p.archived = true
       and ($1 = '' or (
         lower(p.name) like '%' || $1 || '%'
         or lower(coalesce(p.description, '')) like '%' || $1 || '%'
         or lower(coalesce(c.name, '')) like '%' || $1 || '%'
         or lower(coalesce(p.project_code, '')) like '%' || $1 || '%'
       ))
       and ($2 = 'all' or p.status = $2)
     order by last_activity_at desc
     limit $3 offset $4`,
    [search, status, limit, offset]
  );

  const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
  return {
    projects: result.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
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
  deadline?: string | null;
  requestor?: string | null;
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
  const deadline = typeof args.deadline === "string" ? args.deadline.trim() || null : null;
  const requestor = typeof args.requestor === "string" ? args.requestor.trim() || null : null;
  const projectsRoot = config.dropboxProjectsRootFolder();
  const values = [
    projectTitle,
    args.description ?? null,
    args.createdBy,
    args.clientId,
    client.code,
    clientSlug,
    projectSlug,
    normalizedTags,
    projectsRoot,
    deadline,
    requestor
  ];

  try {
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
         name, slug, description, created_by, client_id, status, project_seq, project_code, client_slug, project_slug, tags, storage_project_dir, deadline, requestor
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
         $9 || '/' || $6 || '/' || $5 || '-' || lpad(next_seq.seq::text, 4, '0') || '-' || $7,
         $10::date,
         $11
       from next_seq
       returning *`,
      values
    );
    return result.rows[0];
  } catch (error) {
    if (!isMissingProjectDeadlineColumnError(error)) {
      throw error;
    }

    const fallback = await query(
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
         name, slug, description, created_by, client_id, status, project_seq, project_code, client_slug, project_slug, tags, storage_project_dir, requestor
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
         $9 || '/' || $6 || '/' || $5 || '-' || lpad(next_seq.seq::text, 4, '0') || '-' || $7,
         $10
       from next_seq
       returning *`,
      [...values.slice(0, 9), requestor]
    );
    return fallback.rows[0];
  }
}

export async function getProject(id: string, viewerUserId?: string | null) {
  try {
    const result = await query(
      `select p.*, c.name as client_name, c.code as client_code,
         case
           when p.project_code is not null and length(trim(p.project_code)) > 0 then p.project_code || '-' || p.name
           else p.name
         end as display_name,
         ${
           viewerUserId
             ? "puh.hours as my_hours"
             : "null::numeric as my_hours"
         }
       from projects p
       left join clients c on c.id = p.client_id
       ${
         viewerUserId
           ? "left join project_user_hours puh on puh.project_id = p.id and puh.user_id = $2"
           : ""
       }
       where p.id = $1`,
      viewerUserId ? [id, viewerUserId] : [id]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (!viewerUserId || !isMissingProjectUserHoursTableError(error)) {
      throw error;
    }

    const fallback = await query(
      `select p.*, c.name as client_name, c.code as client_code,
         case
           when p.project_code is not null and length(trim(p.project_code)) > 0 then p.project_code || '-' || p.name
           else p.name
         end as display_name,
         null::numeric as my_hours
       from projects p
       left join clients c on c.id = p.client_id
       where p.id = $1`,
      [id]
    );
    return fallback.rows[0] ?? null;
  }
}

export async function updateProject(args: {
  id: string;
  name: string;
  description?: string;
  clientId: string;
  tags?: string[];
  deadline?: string | null;
  requestor?: string | null;
}) {
  const current = await getProject(args.id);
  if (!current) {
    return null;
  }
  if (current.client_id !== args.clientId) {
    throw new Error("Cannot change project client after creation");
  }

  const nextTags = args.tags === undefined ? current.tags ?? [] : normalizeProjectTags(args.tags);
  const nextDeadline =
    args.deadline === undefined
      ? typeof current.deadline === "string"
        ? current.deadline
        : current.deadline ?? null
      : typeof args.deadline === "string"
        ? args.deadline.trim() || null
        : null;
  const nextRequestor =
    args.requestor === undefined
      ? current.requestor ?? null
      : typeof args.requestor === "string"
        ? args.requestor.trim() || null
        : null;

  try {
    const result = await query(
      `update projects
       set name = $2,
           description = $3,
           tags = $4::text[],
           deadline = $5::date,
           requestor = $6,
           updated_at = now()
       where id = $1
       returning *`,
      [args.id, args.name.trim(), args.description ?? null, nextTags, nextDeadline, nextRequestor]
    );

    return result.rows[0] ?? null;
  } catch (error) {
    if (isMissingProjectRequestorColumnError(error)) {
      const fallback = await query(
        `update projects
         set name = $2,
             description = $3,
             tags = $4::text[],
             deadline = $5::date,
             updated_at = now()
         where id = $1
         returning *`,
        [args.id, args.name.trim(), args.description ?? null, nextTags, nextDeadline]
      );

      return fallback.rows[0] ?? null;
    }

    if (!isMissingProjectDeadlineColumnError(error)) {
      throw error;
    }

    const fallback = await query(
      `update projects
       set name = $2,
           description = $3,
           tags = $4::text[],
           updated_at = now()
       where id = $1
       returning *`,
      [args.id, args.name.trim(), args.description ?? null, nextTags]
    );

    return fallback.rows[0] ?? null;
  }
}

export async function listProjectUserHours(projectId: string): Promise<ProjectUserHours[]> {
  try {
    const result = await query(
      `select
         puh.user_id as "userId",
         up.first_name as "firstName",
         up.last_name as "lastName",
         up.email,
         up.avatar_url as "avatarUrl",
         puh.hours
       from project_user_hours puh
       left join user_profiles up on up.id = puh.user_id
       where puh.project_id = $1
       order by coalesce(up.first_name, ''), coalesce(up.last_name, ''), up.email, puh.user_id`,
      [projectId]
    );

    return result.rows as ProjectUserHours[];
  } catch (error) {
    if (isMissingProjectUserHoursTableError(error)) {
      return [];
    }
    throw error;
  }
}

export async function getSiteSettings(): Promise<SiteSettings | null> {
  try {
    const result = await query(
      `select
         site_title as "siteTitle",
         logo_url as "logoUrl"
       from site_settings
       where id = 'default'`,
      []
    );
    return (result.rows[0] as SiteSettings | undefined) ?? null;
  } catch (error) {
    if (isMissingSiteSettingsTableError(error)) {
      return null;
    }
    throw error;
  }
}

export async function upsertSiteSettings(settings: SiteSettings): Promise<SiteSettings> {
  try {
    const result = await query(
      `insert into site_settings (id, site_title, logo_url)
       values ('default', $1, $2)
       on conflict (id)
       do update set
         site_title = excluded.site_title,
         logo_url = excluded.logo_url,
         updated_at = now()
       returning
         site_title as "siteTitle",
         logo_url as "logoUrl"`,
      [settings.siteTitle, settings.logoUrl]
    );
    return result.rows[0] as SiteSettings;
  } catch (error) {
    if (!isMissingSiteSettingsTableError(error)) {
      throw error;
    }

    throw new Error("site_settings table is not available. Apply migration 0010_site_settings_and_project_deadline.sql first.");
  }
}

export async function setProjectUserHours(args: {
  projectId: string;
  userId: string;
  hours: number | null;
}) {
  if (args.hours === null) {
    await query("delete from project_user_hours where project_id = $1 and user_id = $2", [args.projectId, args.userId]);
    return null;
  }

  const result = await query(
    `insert into project_user_hours (project_id, user_id, hours)
     values ($1, $2, $3)
     on conflict (project_id, user_id)
     do update set hours = excluded.hours, updated_at = now()
     returning *`,
    [args.projectId, args.userId, args.hours]
  );
  return result.rows[0] ?? null;
}

function isMissingProjectUserHoursTableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /project_user_hours/i.test(error.message) && /does not exist|undefined table/i.test(error.message);
}

function isMissingProjectRequestorColumnError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /requestor/i.test(error.message) && /does not exist|undefined column/i.test(error.message);
}

function isMissingProjectDeadlineColumnError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /deadline/i.test(error.message) && /does not exist|undefined column/i.test(error.message);
}

function isMissingSiteSettingsTableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /site_settings/i.test(error.message) && /does not exist|undefined table/i.test(error.message);
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
    `select id, project_id, thread_id, comment_id, filename, mime_type, size_bytes, thumbnail_url, created_at
     from project_files
     where project_id = $1 and thread_id = $2 and comment_id is not null
     order by created_at asc`,
    [projectId, threadId]
  );

  const filesByComment = new Map<string, typeof attachmentsResult.rows>();
  for (const attachment of attachmentsResult.rows) {
    const normalizedAttachment = normalizeProjectFileSizeRow(attachment);
    const commentId = String(attachment.comment_id ?? "");
    if (!commentId) {
      continue;
    }
    const current = filesByComment.get(commentId) ?? [];
    current.push(normalizedAttachment);
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
  return result.rows.map((row) => normalizeProjectFileSizeRow(row));
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
  thumbnailUrl?: string | null;
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
    args.commentId ?? null,
    args.thumbnailUrl ?? null
  ];

  try {
    const result = await query(
      `insert into project_files (
        project_id, uploader_user_id, filename, mime_type, size_bytes, dropbox_file_id, dropbox_path, checksum, thread_id, comment_id, thumbnail_url
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning *`,
      values
    );
    return result.rows[0] ? normalizeProjectFileSizeRow(result.rows[0]) : null;
  } catch (error) {
    if (!isMissingProjectFileColumnError(error)) {
      throw error;
    }

    try {
      const result = await query(
        `insert into project_files (
          project_id, uploader_user_id, filename, mime_type, size_bytes, dropbox_file_id, dropbox_path, checksum, thread_id, comment_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning *`,
        values.slice(0, 10)
      );
      return result.rows[0] ? normalizeProjectFileSizeRow(result.rows[0]) : null;
    } catch (legacyError) {
      if (!isMissingProjectFileColumnError(legacyError)) {
        throw legacyError;
      }

      if (args.threadId || args.commentId) {
        throw new Error("Comment attachments require database migration 0007_comment_attachments.sql");
      }
    }

    const result = await query(
      `insert into project_files (
        project_id, uploader_user_id, filename, mime_type, size_bytes, dropbox_file_id, dropbox_path, checksum
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      values.slice(0, 8)
    );
    return result.rows[0] ? normalizeProjectFileSizeRow(result.rows[0]) : null;
  }
}

export async function getFileById(projectId: string, fileId: string) {
  const result = await query(
    "select * from project_files where project_id = $1 and id = $2",
    [projectId, fileId]
  );
  return result.rows[0] ? normalizeProjectFileSizeRow(result.rows[0]) : null;
}

export async function setFileThumbnailUrl(args: {
  projectId: string;
  fileId: string;
  thumbnailUrl: string | null;
}) {
  const result = await query(
    `update project_files
     set thumbnail_url = $3
     where project_id = $1 and id = $2
     returning *`,
    [args.projectId, args.fileId, args.thumbnailUrl]
  );
  return result.rows[0] ? normalizeProjectFileSizeRow(result.rows[0]) : null;
}

export async function upsertThumbnailJob(args: { projectFileId: string }) {
  const existing = await query(
    `select id, project_file_id, status, attempt_count, next_attempt_at, last_error, created_at, updated_at
     from thumbnail_jobs
     where project_file_id = $1
     limit 1`,
    [args.projectFileId]
  );
  const current = existing.rows[0] as
    | {
        id: string;
        project_file_id: string;
        status: string;
        attempt_count: number;
        next_attempt_at: string;
        last_error: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!current) {
    const inserted = await query(
      `insert into thumbnail_jobs (project_file_id, status, attempt_count, next_attempt_at, last_error)
       values ($1, 'queued', 0, now(), null)
       returning id, project_file_id, status, attempt_count, next_attempt_at, last_error, created_at, updated_at`,
      [args.projectFileId]
    );
    return {
      action: "inserted" as const,
      job: inserted.rows[0] as NonNullable<typeof current>
    };
  }

  if (current.status === "permanent_failure") {
    return {
      action: "permanent_failure" as const,
      job: current
    };
  }

  if (current.status === "queued" || current.status === "processing") {
    const updatedAt = new Date(current.updated_at);
    const staleMs = 10 * 60 * 1000; // 10 minutes
    const isStale = Date.now() - updatedAt.getTime() > staleMs;

    if (!isStale) {
      const deduped = await query(
        `update thumbnail_jobs
         set updated_at = now()
         where project_file_id = $1
         returning id, project_file_id, status, attempt_count, next_attempt_at, last_error, created_at, updated_at`,
        [args.projectFileId]
      );
      return {
        action: "deduped" as const,
        job: deduped.rows[0] as NonNullable<typeof current>
      };
    }
  }

  const restarted = await query(
    `update thumbnail_jobs
     set status = 'queued',
         attempt_count = 0,
         next_attempt_at = now(),
         last_error = null,
         updated_at = now()
     where project_file_id = $1
     returning id, project_file_id, status, attempt_count, next_attempt_at, last_error, created_at, updated_at`,
    [args.projectFileId]
  );
  return {
    action: "inserted" as const,
    job: restarted.rows[0] as NonNullable<typeof current>
  };
}

export async function completeThumbnailJob(args: { projectFileId: string }) {
  await query(
    `update thumbnail_jobs
     set status = 'succeeded',
         last_error = null,
         updated_at = now()
     where project_file_id = $1`,
    [args.projectFileId]
  );
}

export async function failThumbnailJob(args: {
  projectFileId: string;
  error: string;
  permanent: boolean;
}) {
  const status = args.permanent ? "permanent_failure" : "failed";
  await query(
    `update thumbnail_jobs
     set status = $2,
         last_error = $3,
         attempt_count = attempt_count + 1,
         updated_at = now()
     where project_file_id = $1`,
    [args.projectFileId, status, args.error.slice(0, 1000)]
  );
}

function isMissingProjectFileColumnError(error: unknown) {
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
    message.includes('column "thumbnail_url"') ||
    message.includes("project_files.thread_id") ||
    message.includes("project_files.comment_id") ||
    message.includes("project_files.thumbnail_url")
  );
}
