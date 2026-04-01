create table if not exists project_expense_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  amount numeric(12,2) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_expense_lines_label_non_empty check (length(trim(label)) > 0),
  constraint project_expense_lines_amount_non_negative check (amount >= 0)
);

create index if not exists idx_project_expense_lines_project_id_sort_order
  on project_expense_lines(project_id, sort_order, created_at);
