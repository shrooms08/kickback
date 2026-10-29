-- Kickback backend, part 7: invite XP needs the invitee to keep a stake for the 7 days after
-- the claim (checked from daily stake snapshots), so xp-cron also snapshots every invitee who
-- claimed a code as a new staker in the last 30 days, even before they save a plan.

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
      or exists (select 1 from public.referrals r where r.invitee = u.address and r.network = u.network and not r.had_stake_at_claim and r.claimed_at > now() - interval '30 days')
    )
  order by u.address
  limit greatest(1, least(p_limit, 1000))
$$;
revoke execute on function public.xp_cron_candidates(text, date, text, integer) from public, anon, authenticated;
grant execute on function public.xp_cron_candidates(text, date, text, integer) to service_role;
