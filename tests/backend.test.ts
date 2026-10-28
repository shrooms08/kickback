import { describe, expect, it } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createNimiqVerifier, hexToBytes, isValidAddress, signedMessageData } from '../supabase/functions/_shared/nimiqSignature'
import { signInMessage as serverMessage } from '../supabase/functions/_shared/signin'
import { signSession, verifySession, bearer } from '../supabase/functions/_shared/session'
import { ValidationError, positiveLuna, validateContact, validateEvent, validateShare, validateSlices } from '../supabase/functions/_shared/validate'
import { batchTimes, medianGapHours, nextPayoutAfter } from '../supabase/functions/_shared/payouts'
import { signInMessage as appMessage } from '../src/lib/signin'
import { splitLuna } from '../src/lib/money'

const verifier = createNimiqVerifier({
  sha256: d => sha256(d),
  blake2b256: d => blake2b(d, { dkLen: 32 }),
  ed25519Verify: (sig, msg, pub) => ed25519.verify(sig, msg, pub),
})
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

/** What Nimiq Pay's sign() does: Ed25519 over SHA-256 of the prefixed message. */
function nimiqSign(privateKey: Uint8Array, message: string) {
  return { publicKey: ed25519.getPublicKey(privateKey), signature: ed25519.sign(sha256(signedMessageData(message)), privateKey) }
}

describe('Nimiq signature verification (auth-verify)', () => {
  const priv = hexToBytes('cd'.repeat(32))!
  const msg = serverMessage({ address: 'NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G', network: 'mainnet', nonce: 'ab'.repeat(16), issuedAt: '2026-10-21T19:05:34.590Z' })

  it('derives the address @nimiq/core gives for the same key', () => {
    // Vector from Nimcade: @nimiq/core KeyPair.derive(PrivateKey.fromHex('cd'×32)).toAddress().
    expect(verifier.addressOf(ed25519.getPublicKey(priv))).toBe('NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G')
  })
  it('accepts a known-good signature', () => {
    const s = nimiqSign(priv, msg)
    expect(verifier.verifyMessage(msg, s.signature, s.publicKey)).toBe(true)
    // Round trip through the hex strings the SDK returns.
    expect(verifier.verifyMessage(msg, hexToBytes(hex(s.signature))!, hexToBytes(hex(s.publicKey))!)).toBe(true)
  })
  it('rejects a tampered message, signature or key', () => {
    const s = nimiqSign(priv, msg)
    expect(verifier.verifyMessage(msg.replace('mainnet', 'testnet'), s.signature, s.publicKey)).toBe(false)
    const bad = s.signature.slice(); bad[10] ^= 1
    expect(verifier.verifyMessage(msg, bad, s.publicKey)).toBe(false)
    const other = ed25519.getPublicKey(hexToBytes('ef'.repeat(32))!)
    expect(verifier.verifyMessage(msg, s.signature, other)).toBe(false)
    expect(verifier.verifyMessage(msg, s.signature.slice(0, 63), s.publicKey)).toBe(false)
  })
  it('the app and the server build the same sign-in message', () => {
    const f = { address: 'NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G', network: 'testnet' as const, nonce: '0f'.repeat(16), issuedAt: '2026-10-21T19:05:34.590Z' }
    expect(appMessage(f)).toBe(serverMessage(f))
    expect(appMessage(f)).toContain('Sign in to Kickback\nAddress: NQ98')
  })
})

describe('session tokens', () => {
  const secret = 'x'.repeat(40)
  it('round-trips address and network for 7 days (audit 16)', async () => {
    const { token, exp } = await signSession(secret, 'NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G', 'testnet', 1_000_000_000_000)
    expect(exp - 1_000_000_000_000).toBe(7 * 86400e3)
    const s = await verifySession(secret, token, 1_000_000_000_000 + 1000)
    expect(s).toMatchObject({ address: 'NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G', network: 'testnet' })
    expect(bearer(`Bearer ${token}`)).toBe(token)
  })
  it('rejects forged, tampered and expired tokens', async () => {
    const { token, exp } = await signSession(secret, 'NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G', 'mainnet')
    expect(await verifySession('y'.repeat(40), token)).toBeNull()
    const [h, b, s] = token.split('.')
    const body = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/')))
    const forged = btoa(JSON.stringify({ ...body, address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifySession(secret, `${h}.${forged}.${s}`)).toBeNull()
    expect(await verifySession(secret, token, exp + 1)).toBeNull()
    expect(await verifySession(secret, 'not.a.token')).toBeNull()
  })
  it('a token issued more than 7 days ago is refused even if it says it lasts 30 (older tokens)', async () => {
    const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const iat = 1_000_000_000, head = enc({ alg: 'HS256', typ: 'JWT' })
    const body = enc({ sub: 'NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G', address: 'NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G', network: 'mainnet', iat, exp: iat + 30 * 86400, iss: 'kickback' })
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`)))
    const token = `${head}.${body}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
    expect(await verifySession(secret, token, (iat + 6 * 86400) * 1000)).not.toBeNull()
    expect(await verifySession(secret, token, (iat + 8 * 86400) * 1000)).toBeNull()
  })
})

describe('slice validation (sync PUT)', () => {
  const ids = new Set(['c1'])
  const plan = (send: number, restake: number, keep: number, contact: string | null = 'c1') => [
    { type: 'send', percent: send, contact_id: contact }, { type: 'restake', percent: restake }, { type: 'keep', percent: keep },
  ]
  it('accepts plans that total 100', () => {
    expect(validateSlices(plan(10, 55, 35), ids).map(s => s.percent)).toEqual([10, 55, 35])
    expect(validateSlices(plan(0, 50, 50, null), ids)[0].contact_id).toBeNull()
  })
  it('rejects totals other than 100, fractions, negatives and missing slices', () => {
    expect(() => validateSlices(plan(10, 55, 36), ids)).toThrow('total 100')
    expect(() => validateSlices(plan(10.5, 55, 34.5), ids)).toThrow(ValidationError)
    expect(() => validateSlices(plan(-10, 75, 35), ids)).toThrow(ValidationError)
    expect(() => validateSlices(plan(10, 55, 35).slice(0, 2), ids)).toThrow(ValidationError)
  })
  it('a send slice needs one of the owner\'s contacts', () => {
    expect(() => validateSlices(plan(10, 55, 35, 'someone-else'), ids)).toThrow('not saved')
    expect(() => validateSlices(plan(10, 55, 35, null), ids)).toThrow('needs one of your contacts')
  })
})

describe('contact, share and event validation', () => {
  const me = 'NQ98 2S8A BUHK HN62 HC83 98CT NFTU KNVV C67G'
  it('contacts need a checksummed address that is not your own', () => {
    expect(validateContact({ id: 'c1', name: 'Ada', contact_address: 'nq03j45b27ltqhd72prm73qpsb15lm6hvcr8' }, me).contact_address).toBe('NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8')
    expect(() => validateContact({ id: 'c1', name: 'Ada', contact_address: 'NQ04 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8' }, me)).toThrow('valid Nimiq address')
    expect(() => validateContact({ id: 'c1', name: 'Me', contact_address: me }, me)).toThrow('own address')
    expect(() => validateContact({ id: 'c1', name: '', contact_address: 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8' }, me)).toThrow('name')
    expect(isValidAddress('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(true)
  })
  it('Luna amounts are positive whole numbers', () => {
    expect(positiveLuna(2_500_000)).toBe(2_500_000)
    for (const bad of [0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 2, Number.NaN]) expect(() => positiveLuna(bad)).toThrow(ValidationError)
  })
  it('shares need a uuid, a slice type and a hash unless kept', () => {
    const id = '0b6f1c1e-2f6a-4b7e-9a3c-5d2e1f0a9b8c'
    expect(validateShare({ id, amount_luna: 875_000, slice_type: 'keep' })).toMatchObject({ tx_hash: null, status: 'confirmed' })
    expect(() => validateShare({ id, amount_luna: 250_000, slice_type: 'send' })).toThrow('tx_hash')
    expect(() => validateShare({ id: 'nope', amount_luna: 1, slice_type: 'keep' })).toThrow('uuid')
    expect(validateShare({ id, amount_luna: 1, slice_type: 'keep', status: 'undone' }).status).toBe('undone')
    expect(validateEvent({ kind: 'stake', amount_luna: 10_000_000 })).toEqual({ kind: 'stake', amount_luna: 10_000_000, tx_hash: null })
    expect(() => validateEvent({ kind: 'hack' })).toThrow(ValidationError)
  })
})

describe('Luna maths', () => {
  it('a 25 NIM run split 10/55/35 is exact in Luna', () => {
    const parts = splitLuna(2_500_000, [10, 55, 35])
    expect(parts).toEqual([250_000, 1_375_000, 875_000])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(2_500_000)
  })
  it('server payout timing matches the app: batches, median gap, next payout', () => {
    const H = 3600e3, t0 = 1_800_000_000_000
    const times = [t0, t0 + 60e3, t0 - 12 * H, t0 - 12 * H + 30e3, t0 - 24 * H]
    expect(batchTimes(times)).toEqual([t0, t0 - 12 * H, t0 - 24 * H])
    expect(medianGapHours(batchTimes(times))).toBe(12)
    expect(nextPayoutAfter(t0, 12, t0 + 13 * H)).toBe(t0 + 24 * H)
  })
})
