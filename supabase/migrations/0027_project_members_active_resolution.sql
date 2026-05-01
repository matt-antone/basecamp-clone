-- 0027_project_members_active_resolution.sql
--
-- Why:
--   Migration 0026 backfilled project_members from existing thread/comment activity.
--   Many of those rows point at legacy user_profiles (is_legacy=true) imported from BC2,
--   or at sentinel ids like bc2_import that have no user_profile row at all.
--   The picker only shows active users, so checkboxes never reflect membership for
--   those projects. This migration reconciles legacy/orphan rows to the active profile
--   that shares the same email, then drops the legacy/orphan leftovers.
--
-- Safe to re-run: ON CONFLICT DO NOTHING; DELETEs are scoped to legacy/orphan rows only.

with legacy_or_orphan as (
  select pm.project_id, pm.user_id, up.email
  from project_members pm
  left join user_profiles up on up.id = pm.user_id
  where up.is_legacy = true or up.id is null
),
resolved as (
  select lm.project_id, active.id as active_user_id
  from legacy_or_orphan lm
  join user_profiles active
    on active.email = lm.email
   and active.is_legacy = false
   and active.email is not null
)
insert into project_members (project_id, user_id)
select project_id, active_user_id from resolved
on conflict (project_id, user_id) do nothing;

-- Drop legacy rows; their active equivalents (where any) are now in place.
delete from project_members pm
where exists (
  select 1 from user_profiles up
  where up.id = pm.user_id and up.is_legacy = true
);

-- Drop orphan rows whose user_id has no matching user_profile (e.g., bc2_import sentinel).
delete from project_members pm
where not exists (
  select 1 from user_profiles up where up.id = pm.user_id
);
