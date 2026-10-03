begin;

-- Older production installations use target_3a_account and have no result field.
-- Add the audit columns used by the application without rewriting existing logs.
alter table public.admin_logs add column if not exists target text;
alter table public.admin_logs add column if not exists result text;

-- Only the server service role may call this transaction. The server validates
-- the actual LINE sender against config/admin before calling it.
create or replace function public.admin_change_vip_binding(
  p_old_account text, p_new_account text, p_admin_id text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_account text := lower(trim(p_old_account));
  new_account text := lower(trim(p_new_account));
  owner_id text;
  owners integer;
  before_users jsonb;
  before_requests jsonb;
begin
  if old_account is null or old_account !~ '^[a-z0-9]+$'
     or (p_new_account is not null and (new_account = '' or new_account !~ '^[a-z0-9]+$'))
     or coalesce(trim(p_admin_id), '') = '' then
    return jsonb_build_object('ok', false, 'error', '帳號格式不正確。');
  end if;
  if new_account = old_account then
    return jsonb_build_object('ok', false, 'error', '新帳號與舊帳號相同，未變更。');
  end if;

  -- Serialize with all ordinary inserts/updates too, not just other RPC calls.
  lock table public.vip_users, public.vip_requests in share row exclusive mode;
  select count(distinct line_user_id), min(line_user_id) into owners, owner_id
  from (
    select line_user_id from public.vip_users where lower(three_a_account) = old_account
    union all
    select line_user_id from public.vip_requests where lower(three_a_account) = old_account
  ) bindings;
  if owners = 0 then
    return jsonb_build_object('ok', false, 'error', '查無此帳號的綁定或申請。');
  end if;
  if owners <> 1 or exists (
    select 1 from public.vip_users where line_user_id = owner_id and lower(three_a_account) <> old_account
    union all
    select 1 from public.vip_requests where line_user_id = owner_id and lower(three_a_account) <> old_account
  ) then
    return jsonb_build_object('ok', false, 'error', '綁定紀錄不一致，未變更，請先檢查會員資料。');
  end if;
  if new_account is not null and exists (
    select 1 from public.vip_users where lower(three_a_account) = new_account
    union all
    select 1 from public.vip_requests where lower(three_a_account) = new_account
  ) then
    return jsonb_build_object('ok', false, 'error', '新帳號已被綁定或已有申請紀錄，未變更。');
  end if;

  select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into before_users
    from public.vip_users u where line_user_id = owner_id;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into before_requests
    from public.vip_requests r where line_user_id = owner_id;
  -- Keep full original records in the audit log for recovery; usage logs stay intact.
  insert into public.admin_logs(admin_line_user_id, action, target, result)
  values (p_admin_id, case when new_account is null then '解除綁定' else '更換綁定' end,
    old_account, jsonb_build_object('status', 'success', 'lineUserId', owner_id,
      'newAccount', new_account, 'vip_users', before_users, 'vip_requests', before_requests)::text);

  if new_account is null then
    delete from public.vip_requests where line_user_id = owner_id;
    delete from public.vip_users where line_user_id = owner_id;
  else
    update public.vip_users set three_a_account = new_account, updated_at = now()
      where line_user_id = owner_id;
    update public.vip_requests set three_a_account = new_account, updated_at = now()
      where line_user_id = owner_id;
  end if;
  return jsonb_build_object('ok', true, 'lineUserId', owner_id,
    'oldAccount', old_account, 'newAccount', new_account);
end;
$$;

revoke all on function public.admin_change_vip_binding(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_change_vip_binding(text, text, text) to service_role;
notify pgrst, 'reload schema';
commit;
