-- Kickback backend, part 10: the 10-invites-a-season cap is enforced by the database.
--
-- The award code counted the inviter's invite rows once per request, so parallel season reads
-- could each add up to 10. Invite rows now take one of ten slot refs, 'invite#1' .. 'invite#10',
-- per wallet and season (the existing unique (address, network, season, source, ref) allows each
-- slot once), and carry the invitee as proof (the unique proof index allows one row per invitee).
-- Existing rows (ref = the invitee) are converted in award order; any past the 10th were over
-- the cap and are removed.

with ranked as (
  select id, row_number() over (partition by address, network, season order by created_at, id) as n
  from public.xp_ledger where source = 'invite' and ref !~ '^invite#'
)
delete from public.xp_ledger l using ranked r where l.id = r.id and r.n > 10;

with ranked as (
  select id, row_number() over (partition by address, network, season order by created_at, id) as n
  from public.xp_ledger where source = 'invite' and ref !~ '^invite#'
)
update public.xp_ledger l set proof = l.ref, ref = 'invite#' || r.n from ranked r where l.id = r.id;

alter table public.xp_ledger add constraint xp_ledger_invite_slots
  check (source <> 'invite' or (ref ~ '^invite#([1-9]|10)$' and proof is not null));
