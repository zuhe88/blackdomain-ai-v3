begin;

-- Remove only malformed 3A account records. Valid alphanumeric accounts are untouched.
delete from public.vip_requests
where three_a_account is not null
  and three_a_account !~ '^[A-Za-z0-9]+$';

delete from public.vip_users
where three_a_account is not null
  and three_a_account !~ '^[A-Za-z0-9]+$';

alter table public.vip_requests
  drop constraint if exists vip_requests_three_a_account_format_check;

alter table public.vip_requests
  add constraint vip_requests_three_a_account_format_check
  check (three_a_account is null or three_a_account ~ '^[A-Za-z0-9]+$');

alter table public.vip_users
  drop constraint if exists vip_users_three_a_account_format_check;

alter table public.vip_users
  add constraint vip_users_three_a_account_format_check
  check (three_a_account is null or three_a_account ~ '^[A-Za-z0-9]+$');

commit;
