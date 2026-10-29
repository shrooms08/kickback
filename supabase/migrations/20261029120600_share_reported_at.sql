-- Kickback backend, part 11: when a share was reported, as the server saw it.
--
-- created_at never changes on upsert, so a share created early (e.g. as a keep) and turned into a
-- restake or send weeks later still looked "reported" at its first time. reported_at is set by the
-- server: now() on insert, and again by the trigger whenever the tx, amount or type changes (the
-- same changes that clear the proof). Existing rows start from created_at.

alter table public.shares add column reported_at timestamptz;
update public.shares set reported_at = created_at;
alter table public.shares alter column reported_at set default now();
alter table public.shares alter column reported_at set not null;

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
    new.reported_at := now();
  end if;
  return new;
end
$$;
