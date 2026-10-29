-- Kickback backend, part 8: replacing a wallet's contact list is one transaction.
--
-- sync used to delete the contacts left out and then upsert the rest in two requests: when the
-- upsert failed (e.g. the same address twice) the old contacts were already gone. This function
-- does both in one statement block, so a failure leaves the stored list exactly as it was.
-- Rows are validated by the sync function first; only the service role can call it.

create or replace function public.kickback_replace_contacts(p_address text, p_network text, p_contacts jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_contacts) is distinct from 'array' then
    raise exception 'kickback_replace_contacts: contacts must be a JSON array';
  end if;
  delete from public.contacts c
  where c.address = p_address and c.network = p_network
    and not exists (select 1 from jsonb_array_elements(p_contacts) e where e->>'id' = c.id);
  insert into public.contacts (id, address, network, name, contact_address)
  select e->>'id', p_address, p_network, e->>'name', e->>'contact_address'
  from jsonb_array_elements(p_contacts) e
  on conflict (address, network, id) do update set name = excluded.name, contact_address = excluded.contact_address;
end
$$;
revoke execute on function public.kickback_replace_contacts(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.kickback_replace_contacts(text, text, jsonb) to service_role;
