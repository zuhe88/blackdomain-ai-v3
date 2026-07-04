drop table if exists public.vip_members cascade;
drop table if exists public.users cascade;
drop table if exists public.members cascade;
drop table if exists public.user_profiles cascade;
drop table if exists public.profiles cascade;
drop table if exists public.accounts cascade;

create table if not exists public.vip_requests (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  line_name text,
  three_a_account text unique not null,
  status text not null default 'pending',
  request_time timestamptz not null default now(),
  review_time timestamptz,
  review_admin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vip_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique,
  line_name text,
  three_a_account text unique not null,
  vip_status text not null default 'approved',
  ai_permission boolean not null default true,
  expires_at timestamptz,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_line_user_id text not null,
  action text not null,
  target text,
  result text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  three_a_account text,
  module text not null,
  created_at timestamptz not null default now()
);

create index if not exists vip_requests_status_idx on public.vip_requests (status);
create index if not exists vip_requests_three_a_account_idx on public.vip_requests (three_a_account);
create index if not exists vip_users_line_user_id_idx on public.vip_users (line_user_id);
create index if not exists vip_users_three_a_account_idx on public.vip_users (three_a_account);
create index if not exists vip_users_vip_status_idx on public.vip_users (vip_status);
create index if not exists ai_usage_logs_line_user_id_idx on public.ai_usage_logs (line_user_id);
create index if not exists ai_usage_logs_module_idx on public.ai_usage_logs (module);

create unique index if not exists vip_requests_line_user_id_unique on public.vip_requests (line_user_id);
create unique index if not exists vip_requests_three_a_account_unique on public.vip_requests (three_a_account);
create unique index if not exists vip_users_line_user_id_unique on public.vip_users (line_user_id);
create unique index if not exists vip_users_three_a_account_unique on public.vip_users (three_a_account);

create table if not exists public.lucky_members (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique not null,
  line_name text,
  three_a_account text unique not null,
  nickname text,
  status text not null default 'pending',
  keys integer not null default 2,
  first_opened boolean not null default false,
  vip_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lucky_box_logs (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  three_a_account text,
  prize text not null,
  is_admin_test boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.lucky_marquee (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  three_a_account text,
  prize text not null,
  created_at timestamptz not null default now()
);

create index if not exists lucky_members_status_idx on public.lucky_members (status);
create index if not exists lucky_box_logs_line_user_id_idx on public.lucky_box_logs (line_user_id);
create index if not exists lucky_marquee_created_at_idx on public.lucky_marquee (created_at);
