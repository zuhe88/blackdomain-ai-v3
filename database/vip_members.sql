create table if not exists public.vip_members (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique,
  line_name text,
  three_a_account text unique not null,
  vip_status text not null default 'pending',
  ai_permission boolean not null default false,
  expires_at timestamptz,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vip_members_three_a_account_idx
  on public.vip_members (three_a_account);

create index if not exists vip_members_line_user_id_idx
  on public.vip_members (line_user_id);

create index if not exists vip_members_vip_status_idx
  on public.vip_members (vip_status);
