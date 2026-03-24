alter table project_files
  add column if not exists thread_id uuid references discussion_threads(id) on delete set null,
  add column if not exists comment_id uuid references discussion_comments(id) on delete set null;

alter table project_files
  drop constraint if exists project_files_comment_requires_thread;

alter table project_files
  add constraint project_files_comment_requires_thread
  check (comment_id is null or thread_id is not null);

create index if not exists idx_project_files_project_thread_created
  on project_files(project_id, thread_id, created_at desc);

create index if not exists idx_project_files_comment_id on project_files(comment_id);
