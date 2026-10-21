-- Kickback backend, part 1: tables, row level security, grants.
--
-- Every table has RLS on. The anon key can only SELECT pool_stats (public). Everything else is
-- written and read by Edge Functions with the service role (which bypasses RLS) after they
-- check a Kickback session token (a wallet-signed sign-in). Mainnet and testnet never mix: every
-- row carries its network. All Luna amounts are bigint.

create table public.users (
  address      text        not null,
  network      text        not null check (network in ('mainnet', 'testnet')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (address, network)
);

create table public.plans (
  address         text        not null,
  network         text        not null check (network in ('mainnet', 'testnet')),
  -- [{ "type": "send" | "restake" | "keep", "percent": 0..100, "contact_id": text | null }], total 100
  slices          jsonb       not null,
  plan_started_at timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (address, network),
  foreign key (address, network) references public.users (address, network) on delete cascade
);

create table public.contacts (
  id              text        not null,
  address         text        not null,
  network         text        not null check (network in ('mainnet', 'testnet')),
  name            text        not null check (char_length(name) between 1 and 40),
  contact_address text        not null,
  created_at      timestamptz not null default now(),
  primary key (address, network, id),
  unique (address, network, contact_address),
  foreign key (address, network) references public.users (address, network) on delete cascade
);

-- Processed shares of real (not dry-run) plan runs: replaces the local ledger.
create table public.shares (
  id          uuid        primary key,
  address     text        not null,
  network     text        not null check (network in ('mainnet', 'testnet')),
  amount_luna bigint      not null check (amount_luna > 0),
  slice_type  text        not null check (slice_type in ('send', 'restake', 'keep')),
  tx_hash     text,
  status      text        not null default 'confirmed' check (status in ('confirmed', 'undone')),
  created_at  timestamptz not null default now(),
  foreign key (address, network) references public.users (address, network) on delete cascade
);
create index shares_owner on public.shares (address, network);

-- Pool payout timing, computed every 15 minutes by pool-stats-cron. Public.
create table public.pool_stats (
  network                 text        not null check (network in ('mainnet', 'testnet')),
  validator_address       text        not null,
  name                    text,
  fee                     double precision,
  reward_address          text,
  last_payout_at          timestamptz,
  median_interval_s       integer,
  next_payout_estimate_at timestamptz,
  payout_kind             text        check (payout_kind in ('direct', 'restake', 'unknown')),
  active                  boolean     not null default false,
  elected                 boolean     not null default false,
  score                   double precision,
  score_status            text,
  listed                  boolean,
  payout_schedule         text,
  updated_at              timestamptz not null default now(),
  primary key (network, validator_address)
);

-- Usage counters. No personal data beyond the (optional) address.
create table public.events (
  id          bigint generated always as identity primary key,
  address     text,
  network     text        not null check (network in ('mainnet', 'testnet')),
  kind        text        not null check (kind in ('connect', 'sign_in', 'stake', 'add_stake', 'plan_saved', 'run_done', 'stop', 'withdraw', 'switch')),
  amount_luna bigint      check (amount_luna is null or amount_luna > 0),
  created_at  timestamptz not null default now()
);
create index events_kind on public.events (network, kind, created_at);

-- Sign-in nonces (one use, 5 minutes). Private.
create table public.auth_nonces (
  nonce      text        primary key,
  address    text        not null,
  network    text        not null check (network in ('mainnet', 'testnet')),
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

-- Known stakers per pool reward address ("probes") for cheap payout reads. Private.
create table public.pool_probes (
  network        text        not null check (network in ('mainnet', 'testnet')),
  reward_address text        not null,
  probe_address  text        not null,
  learned_at     timestamptz not null default now(),
  primary key (network, reward_address, probe_address)
);

-- Row level security and grants -----------------------------------------------------------

alter table public.users       enable row level security;
alter table public.plans       enable row level security;
alter table public.contacts    enable row level security;
alter table public.shares      enable row level security;
alter table public.pool_stats  enable row level security;
alter table public.events      enable row level security;
alter table public.auth_nonces enable row level security;
alter table public.pool_probes enable row level security;

create policy "Anyone can read pool stats" on public.pool_stats for select to anon, authenticated using (true);

-- New objects in public come with broad default grants to anon and authenticated: take them back.
revoke all on public.users, public.plans, public.contacts, public.shares, public.pool_stats, public.events, public.auth_nonces, public.pool_probes from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.pool_stats to anon, authenticated;

-- Seed probes (also in the app, src/services/chain.ts).
insert into public.pool_probes (network, reward_address, probe_address) values
  ('mainnet', 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717', 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'),
  ('mainnet', 'NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717', 'NQ33 VCNC TLSY 10X3 BKJ7 NSY1 B6F6 R0J9 1SUK'),
  ('mainnet', 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV', 'NQ11 NMR7 4E14 CD4Q 3YEQ DJ67 5L6G YAM7 RNF4'),
  ('mainnet', 'NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV', 'NQ47 P7A4 FB6L FCG1 LGU9 B8UE AXV8 ADH8 5XVR')
on conflict do nothing;

-- Public totals for the stats function (no addresses in the output) --------------------------

create or replace function public.kickback_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with nets(network) as (values ('mainnet'), ('testnet')),
  periods(period, since) as (values ('last_7_days', now() - interval '7 days'), ('all_time', '-infinity'::timestamptz))
  select jsonb_object_agg(n.network, (
    select jsonb_object_agg(p.period, jsonb_build_object(
      'wallets_connected',     (select count(distinct e.address) from public.events e where e.network = n.network and e.kind = 'connect' and e.address is not null and e.created_at >= p.since),
      'anonymous_connects',    (select count(*) from public.events e where e.network = n.network and e.kind = 'connect' and e.address is null and e.created_at >= p.since),
      'signed_in_users',       (select count(*) from public.users u where u.network = n.network and u.last_seen_at >= p.since),
      'new_signed_in_users',   (select count(*) from public.users u where u.network = n.network and u.created_at >= p.since),
      'stakers',               (select count(distinct e.address) from public.events e where e.network = n.network and e.kind in ('stake', 'add_stake') and e.address is not null and e.created_at >= p.since),
      'anonymous_stakes',      (select count(*) from public.events e where e.network = n.network and e.kind in ('stake', 'add_stake') and e.address is null and e.created_at >= p.since),
      'staked_luna',           (select coalesce(sum(e.amount_luna), 0) from public.events e where e.network = n.network and e.kind in ('stake', 'add_stake') and e.created_at >= p.since),
      'plans_saved',           (select count(*) from public.events e where e.network = n.network and e.kind = 'plan_saved' and e.created_at >= p.since),
      'runs_done',             (select count(*) from public.events e where e.network = n.network and e.kind = 'run_done' and e.created_at >= p.since),
      'shared_luna',           (select coalesce(sum(s.amount_luna), 0) from public.shares s where s.network = n.network and s.status = 'confirmed' and s.slice_type in ('send', 'restake') and s.created_at >= p.since),
      'sent_to_contacts_luna', (select coalesce(sum(s.amount_luna), 0) from public.shares s where s.network = n.network and s.status = 'confirmed' and s.slice_type = 'send' and s.created_at >= p.since)
    )) from periods p
  )) from nets n
$$;

revoke execute on function public.kickback_stats() from public, anon, authenticated;
grant execute on function public.kickback_stats() to service_role;
