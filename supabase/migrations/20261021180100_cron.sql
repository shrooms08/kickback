-- Kickback backend, part 2: schedules.
--
-- pool-stats-cron runs every 15 minutes per network (testnet 7 minutes after mainnet, so the
-- two never share the RPC budget). pg_cron fires the job and pg_net makes the HTTP call.
-- The function only accepts calls carrying the cron secret. The secret is generated inside the
-- database (Vault) and never leaves it: the function checks it with cron_secret_ok().

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'kickback_cron_secret', 'Header pg_cron sends to pool-stats-cron')
where not exists (select 1 from vault.secrets where name = 'kickback_cron_secret');

create or replace function public.cron_secret_ok(p text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'kickback_cron_secret' and decrypted_secret = p)
$$;
revoke execute on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

-- Scheduling under an existing name replaces that job, so this is safe to run again.
select cron.schedule('kickback-pool-stats-mainnet', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://dhjcilstkumeglweddev.supabase.co/functions/v1/pool-stats-cron?network=mainnet',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kickback_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  ) as request_id;
$$);

select cron.schedule('kickback-pool-stats-testnet', '7,22,37,52 * * * *', $$
  select net.http_post(
    url := 'https://dhjcilstkumeglweddev.supabase.co/functions/v1/pool-stats-cron?network=testnet',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kickback_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  ) as request_id;
$$);

-- Used nonces and anything older than a day go every night.
select cron.schedule('kickback-nonce-cleanup', '30 3 * * *', $$
  delete from public.auth_nonces where created_at < now() - interval '1 day';
$$);
