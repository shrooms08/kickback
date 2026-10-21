-- One-off repair for the "plan sync drops send contact" bug (fixed in "Fix: plan sync drops send
-- contact"). The old client turned a send share with an unresolved recipient into
-- send 0% / contact null and moved the share into Keep before uploading.
--
-- 1. Find affected plans (read only): a send slice at 0% with no contact.
select address, network, slices, updated_at
from public.plans
where exists (
  select 1 from jsonb_array_elements(slices) s
  where s->>'type' = 'send' and (s->>'percent')::int = 0 and s->'contact_id' = 'null'::jsonb
)
order by updated_at;

-- 2. Delete only the reported broken plan, so that phone re-uploads its local plan on the next
--    sync. No other rows are touched. (Run on 2026-10-21.)
-- delete from public.plans
-- where network = 'testnet' and address = 'NQ07 A3J0 AA0Q 5SFA 3YC4 KF9E MYFX DKBT 1SE5'
--   and slices = '[{"type":"send","percent":0,"contact_id":null},{"type":"restake","percent":30,"contact_id":null},{"type":"keep","percent":70,"contact_id":null}]'::jsonb;
