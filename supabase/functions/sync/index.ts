// sync: the signed-in user's plan, contacts and processed shares.
//   GET                         -> { plan, contacts, shares }
//   PUT  { contacts?, plan? }   -> contacts is the full list (upserted; ones left out are removed),
//                                 then the plan (validated against them)
//   POST { share }              -> records (or updates the status of) a processed share
//   POST { event, network? }    -> records an event; without a session the address is left empty
// Every write is validated here: slices total 100, contact addresses pass the Nimiq checksum
// and aren't the user's own, Luna amounts are positive whole numbers.
import { db } from '../_shared/db.ts'
import { corsHeaders, json, readJson } from '../_shared/http.ts'
import { bearer, verifySession } from '../_shared/session.ts'
import type { Session } from '../_shared/session.ts'
import { ValidationError, positiveLuna, validateContact, validateEvent, validateNetwork, validateShare, validateSlices } from '../_shared/validate.ts'
import { rpcFor } from '../_shared/chain.ts'
import { verifyShare, verifyStakeEvent } from '../_shared/proofs.ts'

const secret = Deno.env.get('SESSION_SECRET')
if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters).')

async function getAll(s: Session) {
  const own = <T>(q: any): Promise<T> => q.eq('address', s.address).eq('network', s.network).then((r: any) => { if (r.error) throw r.error; return r.data })
  const [plan, contacts, shares] = await Promise.all([
    own<any[]>(db.from('plans').select('slices, plan_started_at, updated_at, min_ready_luna')),
    own<any[]>(db.from('contacts').select('id, name, contact_address, created_at').order('created_at')),
    own<any[]>(db.from('shares').select('id, amount_luna, slice_type, tx_hash, status, created_at, run_id, verified').order('created_at')),
  ])
  await db.from('users').update({ last_seen_at: new Date().toISOString() }).eq('address', s.address).eq('network', s.network)
  return { plan: plan[0] ?? null, contacts, shares }
}

async function put(s: Session, body: any) {
  const own = { address: s.address, network: s.network }
  if (body?.contacts !== undefined) {
    if (!Array.isArray(body.contacts) || body.contacts.length > 50) throw new ValidationError('contacts must be a list of at most 50')
    const rows = body.contacts.map((c: unknown) => ({ ...validateContact(c, s.address), ...own }))
    const ids = rows.map((r: { id: string }) => r.id)
    let del = db.from('contacts').delete().eq('address', s.address).eq('network', s.network)
    if (ids.length) del = del.not('id', 'in', `(${ids.map((i: string) => `"${i}"`).join(',')})`)
    const { error: derr } = await del
    if (derr) throw derr
    if (rows.length) {
      const { error } = await db.from('contacts').upsert(rows, { onConflict: 'address,network,id' })
      if (error) {
        if (error.code === '23505') throw new ValidationError('that contact address is already saved under another name')
        throw error
      }
    }
  }
  if (body?.plan !== undefined) {
    const { data: cs, error: cerr } = await db.from('contacts').select('id').eq('address', s.address).eq('network', s.network)
    if (cerr) throw cerr
    const slices = validateSlices(body.plan?.slices, new Set((cs ?? []).map((c: { id: string }) => c.id)))
    let started: string | null = null
    if (body.plan?.plan_started_at != null) {
      const t = Date.parse(body.plan.plan_started_at)
      if (!Number.isFinite(t) || t > Date.now() + 5 * 60_000) throw new ValidationError('plan_started_at must be a past time')
      started = new Date(t).toISOString()
    }
    const min = body.plan?.min_ready_luna == null ? undefined : positiveLuna(body.plan.min_ready_luna, 'min_ready_luna')
    if (min !== undefined && min > 100_000_000) throw new ValidationError('min_ready_luna is at most 1,000 NIM')
    const { error } = await db.from('plans').upsert({ ...own, slices, plan_started_at: started, updated_at: new Date().toISOString(), ...(min !== undefined ? { min_ready_luna: min } : {}) }, { onConflict: 'address,network' })
    if (error) throw error
  }
  return getAll(s)
}

async function post(s: Session | null, body: any) {
  if (body?.share !== undefined) {
    if (!s) return { status: 401, body: { error: 'Sign in to back up shares.' } }
    const share = validateShare(body.share)
    const { data: existing, error: e1 } = await db.from('shares').select('address, network, amount_luna, slice_type, tx_hash, run_id, verified').eq('id', share.id).maybeSingle()
    if (e1) throw e1
    if (existing && (existing.address !== s.address || existing.network !== s.network)) return { status: 403, body: { error: 'Not your share.' } }
    // A verified share keeps its proof only while its tx, amount and type stay the same.
    const same = !!existing && existing.verified && existing.tx_hash === share.tx_hash && Number(existing.amount_luna) === share.amount_luna && existing.slice_type === share.slice_type
    const row = { ...share, run_id: share.run_id ?? existing?.run_id ?? null, address: s.address, network: s.network, ...(same ? {} : { verified: false, block_at: null }) }
    const { error } = await db.from('shares').upsert(row, { onConflict: 'id' })
    if (error) throw error
    const verified = same || await verifyShare(rpcFor(s.network), row)
    return { status: 200, body: { ok: true, verified } }
  }
  if (body?.event !== undefined) {
    const ev = validateEvent(body.event)
    const network = s ? s.network : validateNetwork(body.network)
    // Only a signed-in wallet's stake tx can be verified (it must come from that wallet).
    const { data, error } = await db.from('events').insert({ ...ev, tx_hash: s ? ev.tx_hash : null, network, address: s?.address ?? null }).select('id').single()
    if (error) throw error
    const verified = !!(s && ev.tx_hash) && await verifyStakeEvent(rpcFor(s.network), data.id, s.address, ev.tx_hash!, ev.amount_luna)
    return { status: 200, body: { ok: true, verified } }
  }
  throw new ValidationError('send a share or an event')
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS') ?? '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const session = await verifySession(secret!, bearer(req.headers.get('authorization')))
  try {
    if (req.method === 'GET') {
      if (!session) return json({ error: 'Sign in first.' }, 401, cors)
      return json(await getAll(session), 200, cors)
    }
    if (req.method === 'PUT') {
      if (!session) return json({ error: 'Sign in first.' }, 401, cors)
      return json(await put(session, await readJson(req)), 200, cors)
    }
    if (req.method === 'POST') {
      const r = await post(session, await readJson(req))
      return json(r.body, r.status, cors)
    }
    return json({ error: 'GET, PUT or POST' }, 405, cors)
  }
  catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, 400, cors)
    console.error('sync', error)
    return json({ error: 'Sync failed' }, 500, cors)
  }
})
