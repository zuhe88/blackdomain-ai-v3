begin;
create table if not exists public.vip_line_transfers (
  id uuid primary key default gen_random_uuid(),
  three_a_account text not null,
  old_line_user_id text not null,
  new_line_user_id text not null,
  old_line_name text,
  new_line_name text,
  original_user jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  reviewed_at timestamptz,
  reviewed_by text
);
create unique index if not exists vip_line_transfer_pending_destination
  on public.vip_line_transfers(new_line_user_id) where status = 'pending';
alter table public.vip_line_transfers enable row level security;
revoke all on public.vip_line_transfers from public, anon, authenticated;
grant select, insert, update on public.vip_line_transfers to service_role;

create or replace function public.request_vip_line_transfer(p_account text, p_new_line text, p_name text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare u public.vip_users%rowtype; existing public.vip_line_transfers%rowtype; request_id uuid;
begin
  if lower(trim(p_account)) !~ '^[a-z0-9]+$' or p_new_line !~ '^U[0-9a-fA-F]{32}$'
     or p_account is null or p_new_line is null then
    return jsonb_build_object('ok', false, 'error', '申請格式不正確。');
  end if;
  lock table public.vip_users, public.vip_requests, public.vip_line_transfers in share row exclusive mode;
  select * into u from public.vip_users where lower(three_a_account) = lower(trim(p_account));
  if u.line_user_id is null or u.line_user_id = p_new_line or u.is_admin then
    return jsonb_build_object('ok', false, 'error', '無法申請轉移，請管理員確認原綁定。');
  end if;
  if exists (select 1 from public.vip_users where line_user_id = p_new_line)
    or exists (select 1 from public.vip_requests where line_user_id = p_new_line)
    or exists (select 1 from public.lottery_settings where key = 'vip_line_revoked:' || p_new_line and value->>'revoked' = 'true') then
    return jsonb_build_object('ok', false, 'error', '新 LINE 已有綁定、申請或轉出紀錄，請管理員確認。');
  end if;
  update public.vip_line_transfers set status = 'expired' where new_line_user_id = p_new_line and status = 'pending' and expires_at <= now();
  select * into existing from public.vip_line_transfers where new_line_user_id = p_new_line and status = 'pending';
  if found then
    if existing.three_a_account <> lower(trim(p_account)) then
      return jsonb_build_object('ok', false, 'error', '已有其他帳號轉移申請，請先由管理員處理。');
    end if;
    return jsonb_build_object('ok', true, 'id', existing.id);
  end if;
  insert into public.vip_line_transfers(three_a_account, old_line_user_id, new_line_user_id, old_line_name, new_line_name, original_user)
    values(lower(trim(p_account)), u.line_user_id, p_new_line, u.line_name, left(p_name,100), to_jsonb(u)) returning id into request_id;
  return jsonb_build_object('ok', true, 'id', request_id);
end $$;

create or replace function public.review_vip_line_transfer(p_id uuid, p_account text, p_admin text, p_approve boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r public.vip_line_transfers%rowtype; u public.vip_users%rowtype;
begin
  if coalesce(trim(p_admin),'') = '' or p_approve is null then
    return jsonb_build_object('ok', false, 'error', '缺少管理員或審核決定。');
  end if;
  lock table public.vip_users, public.vip_requests, public.vip_line_transfers in share row exclusive mode;
  select * into r from public.vip_line_transfers where id = p_id for update;
  if not found or r.three_a_account is distinct from lower(trim(p_account)) then
    return jsonb_build_object('ok', false, 'error', '申請編號與 3A 帳號不符。');
  end if;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', '申請已處理，請查詢狀態，勿重複轉移。');
  end if;
  if r.expires_at <= now() then
    update public.vip_line_transfers set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'error', '申請已超過 24 小時，請新 LINE 重新申請。');
  end if;
  if not p_approve then
    update public.vip_line_transfers set status = 'rejected', reviewed_at = now(), reviewed_by = p_admin where id = r.id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  select * into u from public.vip_users where line_user_id = r.old_line_user_id;
  if not found or to_jsonb(u) is distinct from r.original_user or u.is_admin then
    return jsonb_build_object('ok', false, 'error', '原會員資料已變更，請拒絕此申請後重新申請。');
  end if;
  if exists (select 1 from public.vip_users where line_user_id = r.new_line_user_id)
    or exists (select 1 from public.vip_requests where line_user_id = r.new_line_user_id)
    or exists (select 1 from public.lottery_settings where key = 'vip_line_revoked:' || r.new_line_user_id and value->>'revoked' = 'true')
    or exists (select 1 from public.vip_requests where
      (line_user_id = r.old_line_user_id and lower(three_a_account) <> r.three_a_account)
      or (lower(three_a_account) = r.three_a_account and line_user_id <> r.old_line_user_id)) then
    return jsonb_build_object('ok', false, 'error', '綁定已被使用或資料不一致，未轉移。');
  end if;
  update public.vip_users set line_user_id = r.new_line_user_id, line_name = r.new_line_name, updated_at = now() where id = u.id;
  update public.vip_requests set line_user_id = r.new_line_user_id, line_name = r.new_line_name, updated_at = now() where line_user_id = r.old_line_user_id;
  insert into public.lottery_settings(key,value,updated_at,updated_by)
    values('vip_line_revoked:' || r.old_line_user_id, jsonb_build_object('revoked',true,'transferId',r.id),now(),p_admin)
    on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  update public.vip_line_transfers set status = 'approved', reviewed_at = now(), reviewed_by = p_admin where id = r.id;
  insert into public.admin_logs(admin_line_user_id,action,target,result)
    values(p_admin,'轉移LINE',r.three_a_account,jsonb_build_object('transferId',r.id,'oldLineUserId',r.old_line_user_id,'newLineUserId',r.new_line_user_id,'before',r.original_user)::text);
  return jsonb_build_object('ok',true,'status','approved','oldLineUserId',r.old_line_user_id,'newLineUserId',r.new_line_user_id);
end $$;
revoke all on function public.request_vip_line_transfer(text,text,text) from public, anon, authenticated;
revoke all on function public.review_vip_line_transfer(uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.request_vip_line_transfer(text,text,text) to service_role;
grant execute on function public.review_vip_line_transfer(uuid,text,text,boolean) to service_role;
commit;
