// auth-nonce: POST { address, network } -> { nonce, issuedAt }. The app puts both in the sign-in
// message; auth-verify accepts the nonce once, within 5 minutes.
// Rate limited in Postgres (every isolate counts together), per 10 minutes: AUTH_NONCE_IP_MAX per
// caller IP (default 30), AUTH_NONCE_ADDRESS_MAX per address from one IP (default 10; keyed by IP
// too, so another caller can't lock an address out) and AUTH_NONCE_GLOBAL_MAX for everyone
// together (default 3000, bounds how many nonces can pile up).
import { db, spacedAddress } from '../_shared/db.ts'
import { corsHeaders, json, readJson } from '../_shared/http.ts'
import { isValidAddress } from '../_shared/nimiqSignature.ts'
import { allowHit, limitFromEnv } from '../_shared/rateLimit.ts'
import { clientIp } from '../_shared/rpcProxy.ts'
import { ValidationError, validateNetwork } from '../_shared/validate.ts'

const WINDOW_S = 600
const IP_MAX = limitFromEnv('AUTH_NONCE_IP_MAX', 30)
const ADDRESS_MAX = limitFromEnv('AUTH_NONCE_ADDRESS_MAX', 10)
const GLOBAL_MAX = limitFromEnv('AUTH_NONCE_GLOBAL_MAX', 3000)
const tooMany = (cors: Record<string, string>) => json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429, cors)

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS') ?? '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, cors)
  const ip = clientIp(req.headers)
  if (!(await allowHit(`nonce:ip:${ip}`, WINDOW_S, IP_MAX))) return tooMany(cors)
  const body = await readJson(req)
  try {
    const network = validateNetwork(body?.network)
    if (typeof body?.address !== 'string' || !isValidAddress(body.address)) throw new ValidationError('address is not a valid Nimiq address')
    if (!(await allowHit(`nonce:addr:${network}:${spacedAddress(body.address)}:${ip}`, WINDOW_S, ADDRESS_MAX))) return tooMany(cors)
    if (!(await allowHit('nonce:global', WINDOW_S, GLOBAL_MAX))) return tooMany(cors)
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
    const { data, error } = await db.from('auth_nonces').insert({ nonce, address: spacedAddress(body.address), network }).select('created_at').single()
    if (error) throw error
    return json({ nonce, issuedAt: new Date(data.created_at).toISOString() }, 200, cors)
  }
  catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, 400, cors)
    console.error('auth-nonce', error)
    return json({ error: 'Could not start sign-in' }, 500, cors)
  }
})
