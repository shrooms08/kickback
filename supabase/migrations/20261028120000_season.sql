-- Kickback backend, part 3: Season 1 (milestones, streak, skins, invites) and verified stats.
--
-- Nothing here trusts the app: shares and stakes count only after the server found the matching
-- transaction on chain (sync and season functions, supabase/functions/_shared/verify.ts).
-- Milestones and unlocks are only ever added by the season function, never removed. Every new
-- table has RLS on and no policy: only Edge Functions (service role) touch them.

-- Shares: which run they belong to, and whether the tx was found on chain.
alter table public.shares
  add column run_id     uuid,
  add column verified   boolean     not null default false,
  add column block_at   timestamptz,
  add column checked_at timestamptz;
-- One on-chain tx proves one share, however many share ids claim it.
create unique index shares_verified_hash on public.shares (network, tx_hash) where verified;
create index shares_unverified on public.shares (network, address) where not verified and tx_hash is not null;

-- Stake events can carry their tx hash; only verified ones count in public stats.
alter table public.events
  add column tx_hash  text check (tx_hash is null or tx_hash ~ '^[0-9a-f]{64}$'),
  add column verified boolean not null default false;
create unique index events_verified_hash on public.events (network, tx_hash) where verified;

-- "Run when ready reaches": the plan's minimum, Luna (default 0.10 NIM).
-- Null = never set on the server (the phone's choice is kept on the first sync).
alter table public.plans add column min_ready_luna bigint check (min_ready_luna is null or min_ready_luna > 0);

-- The Stack skin the user applied (must be one of their unlocks; checked by the function).
alter table public.users add column skin text not null default 'spark'
  check (skin in ('spark', 'kick', 'bounce', 'rally', 'surge', 'legend'));

create table public.invite_codes (
  address    text        not null,
  network    text        not null check (network in ('mainnet', 'testnet')),
  code       text        not null unique check (code ~ '^KICK-[2-9A-HJ-NP-Z]{4}$'),
  created_at timestamptz not null default now(),
  primary key (address, network),
  foreign key (address, network) references public.users (address, network) on delete cascade
);

-- One inviter per wallet per network. It counts once the invitee's first stake is on chain
-- and they had no stake when they claimed the code.
create table public.referrals (
  invitee            text        not null,
  network            text        not null check (network in ('mainnet', 'testnet')),
  inviter            text        not null,
  code               text        not null,
  claimed_at         timestamptz not null default now(),
  had_stake_at_claim boolean     not null,
  credited_at        timestamptz,
  primary key (invitee, network),
  check (invitee <> inviter),
  foreign key (invitee, network) references public.users (address, network) on delete cascade
);
create index referrals_inviter on public.referrals (network, inviter);

-- Kickbacks found on chain (payouts from a direct pool's reward address to the user).
create table public.kickbacks_seen (
  address      text        not null,
  network      text        not null check (network in ('mainnet', 'testnet')),
  hash         text        not null,
  at           timestamptz not null,
  luna         bigint      not null check (luna > 0),
  from_address text        not null,
  primary key (address, network, hash)
);

-- Where the last history scan stopped, so the next one only reads what's new.
create table public.chain_scan (
  address     text        not null,
  network     text        not null check (network in ('mainnet', 'testnet')),
  newest_hash text,
  staked      boolean     not null default false,
  scanned_at  timestamptz not null default now(),
  primary key (address, network)
);

create table public.milestones (
  address     text        not null,
  network     text        not null check (network in ('mainnet', 'testnet')),
  key         text        not null check (key in ('first_stake', 'first_kickback', 'first_share', 'ten_runs', 'hundred_shared', 'streak_30', 'invited_staker')),
  unlocked_at timestamptz not null default now(),
  primary key (address, network, key),
  foreign key (address, network) references public.users (address, network) on delete cascade
);

create table public.unlocks (
  address     text        not null,
  network     text        not null check (network in ('mainnet', 'testnet')),
  skin        text        not null check (skin in ('spark', 'kick', 'bounce', 'rally', 'surge', 'legend')),
  source      text        not null,
  unlocked_at timestamptz not null default now(),
  primary key (address, network, skin),
  foreign key (address, network) references public.users (address, network) on delete cascade
);

alter table public.invite_codes   enable row level security;
alter table public.referrals      enable row level security;
alter table public.kickbacks_seen enable row level security;
alter table public.chain_scan     enable row level security;
alter table public.milestones     enable row level security;
alter table public.unlocks        enable row level security;
revoke all on public.invite_codes, public.referrals, public.kickbacks_seen, public.chain_scan, public.milestones, public.unlocks from anon, authenticated;

-- Public totals: signed-in wallets only, and only stakes, runs and shares with a confirmed tx.
-- Anonymous events stay internal (not in this output).
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
      'signed_in_users',       (select count(*) from public.users u where u.network = n.network and u.last_seen_at >= p.since),
      'new_signed_in_users',   (select count(*) from public.users u where u.network = n.network and u.created_at >= p.since),
      'stakers',               (select count(distinct e.address) from public.events e where e.network = n.network and e.kind in ('stake', 'add_stake') and e.verified and e.address is not null and e.created_at >= p.since),
      'staked_luna',           (select coalesce(sum(e.amount_luna), 0) from public.events e where e.network = n.network and e.kind in ('stake', 'add_stake') and e.verified and e.address is not null and e.created_at >= p.since),
      'runs_done',             (select count(distinct s.run_id) from public.shares s where s.network = n.network and s.verified and s.status = 'confirmed' and s.run_id is not null and s.created_at >= p.since),
      'shared_luna',           (select coalesce(sum(s.amount_luna), 0) from public.shares s where s.network = n.network and s.verified and s.status = 'confirmed' and s.slice_type in ('send', 'restake') and s.created_at >= p.since),
      'sent_to_contacts_luna', (select coalesce(sum(s.amount_luna), 0) from public.shares s where s.network = n.network and s.verified and s.status = 'confirmed' and s.slice_type = 'send' and s.created_at >= p.since)
    )) from periods p
  )) from nets n
$$;
revoke execute on function public.kickback_stats() from public, anon, authenticated;
grant execute on function public.kickback_stats() to service_role;

-- Audit hardening ---------------------------------------------------------------------------

-- Hashes are compared as lower-case hex (older rows may be upper case).
update public.shares set tx_hash = lower(tx_hash) where tx_hash is not null and tx_hash <> lower(tx_hash);
alter table public.shares add constraint shares_tx_hash_hex check (tx_hash is null or tx_hash ~ '^[0-9a-f]{64}$');

-- How many times the chain was asked about an unverified share (stops after 10, or after 48h).
alter table public.shares add column check_count integer not null default 0;

-- If the app changes what a share claims (tx, amount, type), its proof is gone.
create or replace function public.kickback_shares_reset_verified()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tx_hash is distinct from old.tx_hash or new.amount_luna is distinct from old.amount_luna or new.slice_type is distinct from old.slice_type then
    new.verified := false;
    new.block_at := null;
    new.check_count := 0;
  end if;
  return new;
end
$$;
create trigger shares_reset_verified before update on public.shares
  for each row execute function public.kickback_shares_reset_verified();

create or replace function public.kickback_share_checked(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$ update public.shares set check_count = check_count + 1 where id = p_id $$;
revoke execute on function public.kickback_share_checked(uuid) from public, anon, authenticated;
grant execute on function public.kickback_share_checked(uuid) to service_role;

-- Public stats by on-chain time, and only shares made after the wallet's plan started.
create or replace function public.kickback_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with nets(network) as (values ('mainnet'), ('testnet')),
  periods(period, since) as (values ('last_7_days', now() - interval '7 days'), ('all_time', '-infinity'::timestamptz)),
  good as (
    select s.* from public.shares s
    join public.plans p on p.address = s.address and p.network = s.network
    where s.verified and s.status = 'confirmed' and s.block_at is not null
      and p.plan_started_at is not null and s.block_at >= p.plan_started_at
  )
  select jsonb_object_agg(n.network, (
    select jsonb_object_agg(pe.period, jsonb_build_object(
      'signed_in_users',       (select count(*) from public.users u where u.network = n.network and u.last_seen_at >= pe.since),
      'new_signed_in_users',   (select count(*) from public.users u where u.network = n.network and u.created_at >= pe.since),
      'stakers',               (select count(distinct e.address) from public.events e where e.network = n.network and e.kind in ('stake', 'add_stake') and e.verified and e.address is not null and e.created_at >= pe.since),
      'staked_luna',           (select coalesce(sum(e.amount_luna), 0) from public.events e where e.network = n.network and e.kind in ('stake', 'add_stake') and e.verified and e.address is not null and e.created_at >= pe.since),
      'runs_done',             (select count(distinct g.run_id) from good g where g.network = n.network and g.run_id is not null and g.block_at >= pe.since),
      'shared_luna',           (select coalesce(sum(g.amount_luna), 0) from good g where g.network = n.network and g.slice_type in ('send', 'restake') and g.block_at >= pe.since),
      'sent_to_contacts_luna', (select coalesce(sum(g.amount_luna), 0) from good g where g.network = n.network and g.slice_type = 'send' and g.block_at >= pe.since)
    )) from periods pe
  )) from nets n
$$;
revoke execute on function public.kickback_stats() from public, anon, authenticated;
grant execute on function public.kickback_stats() to service_role;
