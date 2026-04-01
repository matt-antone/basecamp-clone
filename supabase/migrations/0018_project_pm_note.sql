-- PM-facing note on projects (list/board read-only one line; editable on project detail).
alter table projects add column if not exists pm_note text;

alter table projects drop constraint if exists projects_pm_note_len;

alter table projects
  add constraint projects_pm_note_len check (pm_note is null or char_length(pm_note) <= 256);
