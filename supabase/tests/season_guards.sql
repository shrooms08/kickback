-- Database guards for Season verification. Run against the LOCAL stack only (it rolls back):
--   docker exec -i supabase_db_kickback psql -U postgres -d postgres -q -t < supabase/tests/season_guards.sql
-- Every line printed must start with PASS.
begin;
insert into public.users (address, network) values ('NQ00 TEST', 'testnet');
insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, verified, block_at)
  values ('11111111-1111-4111-8111-111111111111', 'NQ00 TEST', 'testnet', 1000, 'send', repeat('ab', 32), true, now());
update public.shares set status = 'confirmed' where id = '11111111-1111-4111-8111-111111111111';
select 'PASS status-only edit keeps proof: ' || verified from public.shares where id = '11111111-1111-4111-8111-111111111111';
update public.shares set amount_luna = 9007199254740991 where id = '11111111-1111-4111-8111-111111111111';
select 'PASS amount edit clears proof: ' || (not verified and block_at is null) from public.shares where id = '11111111-1111-4111-8111-111111111111';
update public.shares set verified = true, block_at = now() where id = '11111111-1111-4111-8111-111111111111';
update public.shares set tx_hash = repeat('cd', 32) where id = '11111111-1111-4111-8111-111111111111';
select 'PASS hash edit clears proof: ' || (not verified) from public.shares where id = '11111111-1111-4111-8111-111111111111';
insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, verified) values ('22222222-2222-4222-8222-222222222222', 'NQ00 TEST', 'testnet', 5, 'send', repeat('ef', 32), true);
do $$ begin
  begin insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash, verified) values ('33333333-3333-4333-8333-333333333333', 'NQ00 TEST', 'testnet', 5, 'send', repeat('ef', 32), true); raise notice 'FAIL second verified share accepted';
  exception when unique_violation then raise notice 'PASS second verified share for one tx refused'; end;
  begin insert into public.shares (id, address, network, amount_luna, slice_type, tx_hash) values ('44444444-4444-4444-8444-444444444444', 'NQ00 TEST', 'testnet', 5, 'send', upper(repeat('ab', 32))); raise notice 'FAIL upper-case hash accepted';
  exception when check_violation then raise notice 'PASS upper-case hash refused'; end;
end $$;
rollback;
