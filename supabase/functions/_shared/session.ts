/**
 * Kickback session tokens: compact JWTs (HS256) signed with SESSION_SECRET, holding the
 * wallet address and network. WebCrypto only, so the same code runs in Deno and in vitest.
 */

export type Network = 'mainnet' | 'testnet'
export interface Session { address: string, network: Network, iat: number, exp: number }

export const SESSION_DAYS = 30
const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(b, c => c.charCodeAt(0))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signSession(secret: string, address: string, network: Network, now = Date.now()): Promise<{ token: string, exp: number }> {
  const iat = Math.floor(now / 1000), exp = iat + SESSION_DAYS * 86400
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64url(enc.encode(JSON.stringify({ sub: address, address, network, iat, exp, iss: 'kickback' })))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`)))
  return { token: `${head}.${body}.${b64url(sig)}`, exp: exp * 1000 }
}

/** The session in a token, or null when it is malformed, forged or expired. */
export async function verifySession(secret: string, token: string | null | undefined, now = Date.now()): Promise<Session | null> {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`))
    if (!ok) return null
    const head = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])))
    if (head.alg !== 'HS256') return null
    const p = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])))
    if (typeof p.address !== 'string' || (p.network !== 'mainnet' && p.network !== 'testnet')) return null
    if (typeof p.exp !== 'number' || p.exp * 1000 <= now) return null
    return { address: p.address, network: p.network, iat: p.iat, exp: p.exp }
  }
  catch {
    return null
  }
}

/** "Bearer <token>" -> token. */
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header || '')
  return m ? m[1] : null
}
