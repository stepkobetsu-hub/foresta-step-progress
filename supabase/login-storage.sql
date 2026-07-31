create table if not exists public.student_profiles (
  student_id text primary key,
  name text not null default '',
  campus text not null default '',
  grade text not null default '',
  grade_j_raw text not null default '',
  grade_k_raw text not null default '',
  grade_conflict boolean not null default false,
  school text not null default '',
  enrollment_status text not null default '',
  last_synced_at timestamptz not null default now()
);

create table if not exists public.homework (
  homework_id text primary key,
  student_id text not null,
  unit_id text not null,
  homework_type text not null default '',
  student_status text not null default '',
  teacher_status text not null default '',
  student_updated_at timestamptz,
  teacher_updated_at timestamptz,
  confirmed_by text not null default '',
  confirmation_memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  school_year text not null,
  round_number integer not null default 1,
  assigned_date date,
  student_completed_at timestamptz,
  student_completed_date date,
  student_no_target_at timestamptz,
  student_no_target_date date,
  series text not null default '',
  due_date date
);

create index if not exists homework_student_id_idx
  on public.homework (student_id);

create table if not exists public.student_auth (
  student_id text primary key,
  password_hash text not null,
  status text not null,
  name text not null default '',
  campus text not null default '',
  grade_j_raw text not null default '',
  grade_k_raw text not null default '',
  grade text not null default '',
  grade_conflict boolean not null default false,
  school text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.student_profiles enable row level security;
alter table public.homework enable row level security;
alter table public.student_auth enable row level security;

revoke all on table public.student_profiles from anon, authenticated;
revoke all on table public.homework from anon, authenticated;
revoke all on table public.student_auth from anon, authenticated;
