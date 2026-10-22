begin;
create table if not exists public.web_members (
  id uuid primary key default gen_random_uuid(),
  account text not null unique check (account ~ '^[a-z0-9]{1,64}$'),
  password_hash text not null,
  auth_version uuid not null default gen_random_uuid(),
  enabled boolean not null default true,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);
alter table public.web_members enable row level security;
revoke all on public.web_members from public, anon, authenticated;
grant select, insert, update on public.web_members to service_role;
commit;
