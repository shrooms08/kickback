-- Kickback backend, part 5: one persistent rate limiter for every Edge Function.
--
-- In-memory limits only hold inside one isolate, and the platform runs many. This counter lives
-- in Postgres, so every isolate sees the same numbers. Keys are plain text chosen by the
-- function ('rpc:ip:<ip>', 'rpc:global', 'nonce:addr:<network>:<address>', ...). Fixed windows:
-- the first hit opens a window of p_window_s seconds, every hit in it counts, and the call is
-- allowed while the count is at most p_max. Only the service role (Edge Functions) can use it.

create table public.rate_limits (
  key          text        primary key,
  window_start timestamptz not null,
  hits         integer     not null check (hits >= 0),
  expires_at   timestamptz not null
);
create index rate_limits_expires on public.rate_limits (expires_at);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- One upsert per call: the row lock makes concurrent hits on the same key count one by one.
create or replace function public.hit_rate_limit(p_key text, p_window_s integer, p_max integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_key is null or p_window_s is null or p_window_s <= 0 or p_max is null or p_max < 0 then
    raise exception 'hit_rate_limit: bad arguments';
  end if;
  insert into public.rate_limits as r (key, window_start, hits, expires_at)
  values (p_key, now(), 1, now() + make_interval(secs => p_window_s))
  on conflict (key) do update set
    window_start = case when r.expires_at <= now() then now() else r.window_start end,
    -- Counting stops one past the limit, so a flood can't overflow the counter.
    hits = case when r.expires_at <= now() then 1 else least(r.hits + 1, p_max + 1) end,
    expires_at = case when r.expires_at <= now() then now() + make_interval(secs => p_window_s) else r.expires_at end
  returning hits into n;
  return n <= p_max;
end
$$;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- Expired windows go every 10 minutes, so the table never grows past the keys of one window.
select cron.schedule('kickback-rate-limit-cleanup', '*/10 * * * *', $$
  delete from public.rate_limits where expires_at < now();
$$);
