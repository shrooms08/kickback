/**
 * From Nimcade (github.com/shrooms08/nimcade, supabase/functions/_shared). Matches what Nimiq
 * Pay's sign() does (nimiq-pay-app src/composables/useMiniAppHost.ts: prefix + byte length,
 * SHA-256, Ed25519 over the digest; returns hex publicKey and signature).
 *
 * Nimiq signed-message verification, following Nimiq's own scheme (Keyguard / Hub signMessage;
 * see nimiq/php-utils SignatureUtils::verify_message). The signed data is
 *
 *   '\x16Nimiq Signed Message:\n' + <message length in bytes, decimal> + <message bytes>
 *
 * hashed with SHA-256; the 32-byte digest is signed with Ed25519. A signer's address is the
 * first 20 bytes of the Blake2b-256 hash of its public key, in Nimiq's IBAN-style form.
 * Crypto primitives are passed in, so this module has no runtime imports (the Edge Function
 * supplies @noble implementations).
 */

export const NIMIQ_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'

export interface NimiqCrypto {
  sha256: (data: Uint8Array) => Uint8Array
  blake2b256: (data: Uint8Array) => Uint8Array
  ed25519Verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean
}

const BASE32_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'
const encoder = new TextEncoder()

/** Hex (optionally 0x-prefixed) to bytes, or null when it isn't valid hex. */
export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().replace(/^0x/i, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean))
    return null
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** The bytes Nimiq hashes and signs for a text message. */
export function signedMessageData(message: string): Uint8Array {
  const body = encoder.encode(message)
  const head = encoder.encode(`${NIMIQ_MESSAGE_PREFIX}${body.length}`)
  const data = new Uint8Array(head.length + body.length)
  data.set(head)
  data.set(body, head.length)
  return data
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
    value &= (1 << bits) - 1
  }
  if (bits > 0)
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** ISO 13616 mod-97 over letters mapped to 10..35, computed in 6-digit chunks. */
function ibanCheck(text: string): number {
  const digits = text.toUpperCase().split('').map((char) => {
    const code = char.charCodeAt(0)
    return code >= 48 && code <= 57 ? char : String(code - 55)
  }).join('')
  let rest = ''
  for (let i = 0; i < digits.length; i += 6)
    rest = String(Number.parseInt(rest + digits.slice(i, i + 6), 10) % 97)
  return Number.parseInt(rest, 10)
}

/** A 20-byte address as "NQ.. .... ...." (spaces every 4 characters). */
export function toUserFriendlyAddress(address: Uint8Array): string {
  const base32 = toBase32(address)
  const check = String(98 - ibanCheck(`${base32}NQ00`)).padStart(2, '0')
  return `NQ${check}${base32}`.replace(/.{4}/g, '$& ').trim()
}

/** A Nimiq address with a valid IBAN-style checksum (spaces optional). */
export function isValidAddress(address: string): boolean {
  const a = normalizeAddress(address)
  if (!/^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(a))
    return false
  return ibanCheck(a.slice(4) + a.slice(0, 4)) === 1
}

/** Canonical form for comparing addresses: no spaces, upper case. */
export const normalizeAddress = (address: string) => address.replace(/\s+/g, '').toUpperCase()

export function createNimiqVerifier(crypto: NimiqCrypto) {
  return {
    /** The user-friendly address of an Ed25519 public key. */
    addressOf(publicKey: Uint8Array): string {
      return toUserFriendlyAddress(crypto.blake2b256(publicKey).subarray(0, 20))
    },
    /** Whether `signature` is this public key's Nimiq signature of the text message. */
    verifyMessage(message: string, signature: Uint8Array, publicKey: Uint8Array): boolean {
      if (signature.length !== 64 || publicKey.length !== 32)
        return false
      try {
        return crypto.ed25519Verify(signature, crypto.sha256(signedMessageData(message)), publicKey)
      }
      catch {
        return false
      }
    },
  }
}

export type NimiqVerifier = ReturnType<typeof createNimiqVerifier>
