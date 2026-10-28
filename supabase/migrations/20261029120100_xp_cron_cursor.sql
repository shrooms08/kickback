-- Kickback backend, part 6: xp-cron covers everyone who can earn stake XP, in turns.
--
-- xp-cron used to walk every signed-in wallet from the most recently seen, once a day, and stop
-- after 2 minutes: the same wallets were always first and the rest never got a snapshot. Now:
--   * only wallets that can earn stake XP: a saved plan, or an active stake at the last snapshot
--   * only those without today's snapshot (the run after that is nearly free)
--   * in address order from a cursor kept here, so every run goes on where the last one stopped
--   * every hour instead of once a day (each run stays inside its 2-minute RPC budget)

create table public.cron_cursors (
  name       text        primary key,
  cursor     text        not null default '',
  updated_at timestamptz not null default now()
);
alter table public.cron_cursors enable row level security;
revoke all on public.cron_cursors from anon, authenticated;

create or replace function public.xp_cron_candidates(p_network text, p_day date, p_after text, p_limit integer)
returns table (address text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.address
  from public.users u
  where u.network = p_network
    and u.address > coalesce(p_after, '')
    and not exists (select 1 from public.stake_snapshots s where s.address = u.address and s.network = u.network and s.day = p_day)
    and (
      exists (select 1 from public.plans p where p.address = u.address and p.network = u.network)
      or coalesce((select s.active_luna from public.stake_snapshots s where s.address = u.address and s.network = u.network order by s.day desc limit 1), 0) > 0
    )
  order by u.address
  limit greatest(1, least(p_limit, 1000))
$$;
revoke execute on function public.xp_cron_candidates(text, date, text, integer) from public, anon, authenticated;
grant execute on function public.xp_cron_candidates(text, date, text, integer) to service_role;

-- Hourly: mainnet at :10, testnet at :25 (pool-stats-cron runs at :00/:15/:30/:45 and
-- :07/:22/:37/:52, so the two never share the RPC budget). The old daily jobs go.
select cron.unschedule(jobname) from cron.job where jobname in ('kickback-xp-daily-mainnet', 'kickback-xp-daily-testnet');
select cron.schedule('kickback-xp-mainnet', '10 * * * *', $$
  select net.http_post(
    url := 'https://dhjcilstkumeglweddev.supabase.co/functions/v1/xp-cron?network=mainnet',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kickback_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  ) as request_id;
$$);
select cron.schedule('kickback-xp-testnet', '25 * * * *', $$
  select net.http_post(
    url := 'https://dhjcilstkumeglweddev.supabase.co/functions/v1/xp-cron?network=testnet',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kickback_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  ) as request_id;
$$);
