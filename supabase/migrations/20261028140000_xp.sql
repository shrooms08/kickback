-- Kickback backend, part 4: Season XP, weekly quests, daily stake snapshots.
--
-- XP is never trusted from the app. Every point is a row in xp_ledger written by an Edge Function
-- from verified data (on-chain stake snapshots, shares whose tx was found on chain, credited
-- invites, completed quests). The unique constraints make double counting impossible:
--   one row per (wallet, network, season, source, ref)  -- e.g. stake '2026-10-28', run '2026-10-28#2'
--   one row per (wallet, network, source, proof)        -- e.g. a run id can only ever earn once
-- Run and share refs use day slots #1 and #2, so at most two runs count per UTC day.

create table public.xp_ledger (
  id         bigint generated always as identity primary key,
  address    text        not null,
  network    text        not null check (network in ('mainnet', 'testnet')),
  season     integer     not null check (season > 0),
  source     text        not null check (source in ('stake', 'run', 'share', 'invite', 'quest')),
  ref        text        not null,
  proof      text,
  amount     integer     not null check (amount > 0 and amount <= 2000),
  created_at timestamptz not null default now(),
  unique (address, network, season, source, ref),
  foreign key (address, network) references public.users (address, network) on delete cascade
);
create unique index xp_ledger_proof on public.xp_ledger (address, network, source, proof) where proof is not null;
create index xp_ledger_season on public.xp_ledger (network, season, address);

-- Each signed-in wallet's active stake, once per UTC day (xp-cron at 00:10, or the first season
-- read of the day). Feeds daily stake XP and the "Keep your stake all week" quest.
create table public.stake_snapshots (
  address     text        not null,
  network     text        not null check (network in ('mainnet', 'testnet')),
  day         date        not null,
  active_luna bigint      not null check (active_luna >= 0),
  taken_at    timestamptz not null default now(),
  primary key (address, network, day)
);

alter table public.xp_ledger       enable row level security;
alter table public.stake_snapshots enable row level security;
revoke all on public.xp_ledger, public.stake_snapshots from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 00:10 UTC mainnet, 00:25 UTC testnet (they never share the RPC budget).
select cron.schedule('kickback-xp-daily-mainnet', '10 0 * * *', $$
  select net.http_post(
    url := 'https://dhjcilstkumeglweddev.supabase.co/functions/v1/xp-cron?network=mainnet',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kickback_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  ) as request_id;
$$);
select cron.schedule('kickback-xp-daily-testnet', '25 0 * * *', $$
  select net.http_post(
    url := 'https://dhjcilstkumeglweddev.supabase.co/functions/v1/xp-cron?network=testnet',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kickback_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  ) as request_id;
$$);
