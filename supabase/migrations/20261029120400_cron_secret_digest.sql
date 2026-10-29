-- Kickback backend, part 9: the cron secret check compares SHA-256 digests.
--
-- Comparing the secret text with = can stop at the first differing byte, so response times could
-- leak how much of a guess was right. Both sides are hashed first: fixed-length values whose
-- bytes say nothing about the secret's bytes.

create or replace function public.cron_secret_ok(p text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select extensions.digest(decrypted_secret, 'sha256') = extensions.digest(coalesce(p, ''), 'sha256')
    from vault.decrypted_secrets where name = 'kickback_cron_secret'
  ), false)
$$;
revoke execute on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;
