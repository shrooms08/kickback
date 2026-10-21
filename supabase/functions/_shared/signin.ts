/**
 * The exact text a wallet signs to sign in. The app builds it (src/lib/signin.ts mirrors this
 * file; tests/backend.test.ts checks they match) and auth-verify rebuilds it from the nonce row,
 * so a signature only ever proves this one sign-in.
 */
export interface SignInFields { address: string, network: 'mainnet' | 'testnet', nonce: string, issuedAt: string }

export function signInMessage(f: SignInFields): string {
  return `Sign in to Kickback\nAddress: ${f.address}\nNetwork: ${f.network}\nNonce: ${f.nonce}\nIssued: ${f.issuedAt}\n\nThis only proves you own this wallet. It does not move any NIM.`
}

/** How long a nonce may be used for. */
export const NONCE_TTL_MS = 5 * 60_000
