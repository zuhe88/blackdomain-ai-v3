-- BLACKDOMAIN AI / 3A VIP 幸運轉盤資料庫 Migration
-- 可直接貼到 Supabase SQL Editor 執行。
-- 安全原則：
-- 1. 不刪除任何既有資料。
-- 2. 不引用任何舊抽獎資料表。
-- 3. 3A 官方 LINE 會員與黑域AI會員分開管理。

create extension if not exists pgcrypto;

-- 保留並補齊黑域AI既有資料表，不清空、不覆蓋資料。
create table if not exists public.vip_requests (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  line_name text,
  three_a_account text not null,
  status text not null default 'pending',
  request_time timestamptz not null default now(),
  review_time timestamptz,
  review_admin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vip_requests add column if not exists line_user_id text;
alter table public.vip_requests add column if not exists line_name text;
alter table public.vip_requests add column if not exists three_a_account text;
alter table public.vip_requests add column if not exists status text not null default 'pending';
alter table public.vip_requests add column if not exists request_time timestamptz not null default now();
alter table public.vip_requests add column if not exists review_time timestamptz;
alter table public.vip_requests add column if not exists review_admin text;
alter table public.vip_requests add column if not exists created_at timestamptz not null default now();
alter table public.vip_requests add column if not exists updated_at timestamptz not null default now();

create table if not exists public.vip_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text,
  line_name text,
  three_a_account text not null,
  vip_status text not null default 'approved',
  ai_permission boolean not null default true,
  expires_at timestamptz,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vip_users add column if not exists line_user_id text;
alter table public.vip_users add column if not exists line_name text;
alter table public.vip_users add column if not exists three_a_account text;
alter table public.vip_users add column if not exists vip_status text not null default 'approved';
alter table public.vip_users add column if not exists ai_permission boolean not null default true;
alter table public.vip_users add column if not exists expires_at timestamptz;
alter table public.vip_users add column if not exists is_admin boolean not null default false;
alter table public.vip_users add column if not exists created_at timestamptz not null default now();
alter table public.vip_users add column if not exists updated_at timestamptz not null default now();

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

-- 3A官方LINE會員：獨立於黑域AI會員。
create table if not exists public.three_a_members (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  line_name text,
  three_a_account text not null,
  nickname text,
  status text not null default 'pending',
  keys integer not null default 2,
  first_opened boolean not null default false,
  vip_expires_at timestamptz,
  referred_by text,
  referral_count integer not null default 0,
  spin_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.three_a_members add column if not exists line_user_id text;
alter table public.three_a_members add column if not exists line_name text;
alter table public.three_a_members add column if not exists three_a_account text;
alter table public.three_a_members add column if not exists nickname text;
alter table public.three_a_members add column if not exists status text not null default 'pending';
alter table public.three_a_members add column if not exists keys integer not null default 2;
alter table public.three_a_members add column if not exists first_opened boolean not null default false;
alter table public.three_a_members add column if not exists vip_expires_at timestamptz;
alter table public.three_a_members add column if not exists referred_by text;
alter table public.three_a_members add column if not exists referral_count integer not null default 0;
alter table public.three_a_members add column if not exists spin_status text not null default 'active';
alter table public.three_a_members add column if not exists created_at timestamptz not null default now();
alter table public.three_a_members add column if not exists updated_at timestamptz not null default now();

-- 3A幸運轉盤抽獎紀錄。
create table if not exists public.three_a_spin_logs (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  three_a_account text,
  prize text not null,
  is_admin_test boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.three_a_spin_logs add column if not exists line_user_id text;
alter table public.three_a_spin_logs add column if not exists three_a_account text;
alter table public.three_a_spin_logs add column if not exists prize text;
alter table public.three_a_spin_logs add column if not exists is_admin_test boolean not null default false;
alter table public.three_a_spin_logs add column if not exists created_at timestamptz not null default now();

-- 3A幸運轉盤跑馬燈資料。
create table if not exists public.three_a_marquee (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  three_a_account text,
  prize text not null,
  created_at timestamptz not null default now()
);

alter table public.three_a_marquee add column if not exists line_user_id text;
alter table public.three_a_marquee add column if not exists three_a_account text;
alter table public.three_a_marquee add column if not exists prize text;
alter table public.three_a_marquee add column if not exists created_at timestamptz not null default now();

-- 轉盤機率設定。
create table if not exists public.lottery_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.lottery_settings add column if not exists key text;
alter table public.lottery_settings add column if not exists value jsonb not null default '{}'::jsonb;
alter table public.lottery_settings add column if not exists updated_at timestamptz not null default now();
alter table public.lottery_settings add column if not exists updated_by text;

-- 黑域AI既有表索引。
create unique index if not exists vip_requests_line_user_id_unique on public.vip_requests (line_user_id);
create unique index if not exists vip_requests_three_a_account_unique on public.vip_requests (three_a_account);
create index if not exists vip_requests_status_idx on public.vip_requests (status);
create unique index if not exists vip_users_line_user_id_unique on public.vip_users (line_user_id);
create unique index if not exists vip_users_three_a_account_unique on public.vip_users (three_a_account);
create index if not exists vip_users_vip_status_idx on public.vip_users (vip_status);
create index if not exists admin_logs_admin_line_user_id_idx on public.admin_logs (admin_line_user_id);
create index if not exists ai_usage_logs_line_user_id_idx on public.ai_usage_logs (line_user_id);
create index if not exists ai_usage_logs_module_idx on public.ai_usage_logs (module);

-- 3A專用表索引。
create unique index if not exists three_a_members_line_user_id_unique on public.three_a_members (line_user_id);
create unique index if not exists three_a_members_three_a_account_unique on public.three_a_members (three_a_account);
create index if not exists three_a_members_status_idx on public.three_a_members (status);
create index if not exists three_a_members_spin_status_idx on public.three_a_members (spin_status);
create index if not exists three_a_spin_logs_line_user_id_idx on public.three_a_spin_logs (line_user_id);
create index if not exists three_a_spin_logs_created_at_idx on public.three_a_spin_logs (created_at);
create index if not exists three_a_marquee_created_at_idx on public.three_a_marquee (created_at);
create unique index if not exists lottery_settings_key_unique on public.lottery_settings (key);

-- 初始轉盤機率。
insert into public.lottery_settings (key, value, updated_at)
values ('spin_probability', '{"AI權限1天":45,"88":45,"888":9,"2888":1}'::jsonb, now())
on conflict (key) do nothing;

-- Railway 後端使用 SUPABASE_SERVICE_ROLE_KEY 存取。
-- 不從前端直接讀寫 Supabase，因此不開公開 RLS Policy。
alter table public.vip_requests disable row level security;
alter table public.vip_users disable row level security;
alter table public.admin_logs disable row level security;
alter table public.ai_usage_logs disable row level security;
alter table public.three_a_members disable row level security;
alter table public.three_a_spin_logs disable row level security;
alter table public.three_a_marquee disable row level security;
alter table public.lottery_settings disable row level security;
