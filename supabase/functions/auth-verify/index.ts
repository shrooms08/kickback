// auth-verify: POST { address, network, nonce, publicKey, signature } -> { token, expiresAt }.
// The nonce must be unused and under 5 minutes old (it is burned on the first try). The
// signature is checked over the sign-in message rebuilt from the nonce row, and the public key
// must derive to the claimed address. The token is a 30-day JWT signed with SESSION_SECRET.
// Rate limited in Postgres: AUTH_VERIFY_IP_MAX tries per caller IP per 10 minutes (default 30).
import { blake2b } from 'npm:@noble/hashes@2.4.0/blake2.js'
import { sha256 } from 'npm:@noble/hashes@2.4.0/sha2.js'
import { ed25519 } from 'npm:@noble/curves@2.4.0/ed25519.js'
import { db, spacedAddress } from '../_shared/db.ts'
import { corsHeaders, json, readJson } from '../_shared/http.ts'
import { createNimiqVerifier, hexToBytes, normalizeAddress } from '../_shared/nimiqSignature.ts'
import { signSession } from '../_shared/session.ts'
import { NONCE_TTL_MS, signInMessage } from '../_shared/signin.ts'
import { ValidationError, validateNetwork } from '../_shared/validate.ts'
import { allowHit, limitFromEnv } from '../_shared/rateLimit.ts'
import { clientIp } from '../_shared/rpcProxy.ts'

const IP_MAX = limitFromEnv('AUTH_VERIFY_IP_MAX', 30)

const secret = Deno.env.get('SESSION_SECRET')
if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters).')

const verifier = createNimiqVerifier({
  sha256: data => sha256(data),
  blake2b256: data => blake2b(data, { dkLen: 32 }),
  ed25519Verify: (signature, message, publicKey) => ed25519.verify(signature, message, publicKey),
})

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS') ?? '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, cors)
  if (!(await allowHit(`verify:ip:${clientIp(req.headers)}`, 600, IP_MAX))) return json({ error: 'Too many sign-in attempts. Try again in a few minutes.' }, 429, cors)
  const body = await readJson(req)
  try {
    const network = validateNetwork(body?.network)
    const address = typeof body?.address === 'string' ? spacedAddress(body.address) : ''
    const publicKey = hexToBytes(String(body?.publicKey ?? ''))
    const signature = hexToBytes(String(body?.signature ?? ''))
    if (!address || typeof body?.nonce !== 'string' || !publicKey || !signature) throw new ValidationError('address, nonce, publicKey and signature are required')

    // Burn the nonce first (atomic), so it can never be used twice.
    const { data: row, error } = await db.from('auth_nonces')
      .update({ used_at: new Date().toISOString() })
      .eq('nonce', body.nonce).is('used_at', null)
      .select('address, network, created_at').maybeSingle()
    if (error) throw error
    if (!row) return json({ error: 'Sign-in expired or already used. Try again.' }, 401, cors)
    if (row.address !== address || row.network !== network) return json({ error: 'Sign-in does not match this wallet.' }, 401, cors)
    if (Date.now() - new Date(row.created_at).getTime() > NONCE_TTL_MS) return json({ error: 'Sign-in expired. Try again.' }, 401, cors)

    const message = signInMessage({ address, network, nonce: body.nonce, issuedAt: new Date(row.created_at).toISOString() })
    if (!verifier.verifyMessage(message, signature, publicKey)) return json({ error: 'Signature does not match.' }, 401, cors)
    if (normalizeAddress(verifier.addressOf(publicKey)) !== normalizeAddress(address)) return json({ error: 'That key does not belong to this address.' }, 401, cors)

    const now = new Date().toISOString()
    const { error: uerr } = await db.from('users').upsert({ address, network, last_seen_at: now }, { onConflict: 'address,network' })
    if (uerr) throw uerr
    await db.from('events').insert({ address, network, kind: 'sign_in' })
    const { token, exp } = await signSession(secret!, address, network)
    return json({ token, expiresAt: exp, address, network }, 200, cors)
  }
  catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, 400, cors)
    console.error('auth-verify', error)
    return json({ error: 'Could not sign in' }, 500, cors)
  }
})
