// The text a wallet signs to sign in to Kickback. Mirrors supabase/functions/_shared/signin.ts
// (auth-verify rebuilds it from the nonce row); tests/backend.test.ts checks the two match.
export interface SignInFields { address: string, network: 'mainnet' | 'testnet', nonce: string, issuedAt: string }

export function signInMessage(f: SignInFields): string {
  return `Sign in to Kickback\nAddress: ${f.address}\nNetwork: ${f.network}\nNonce: ${f.nonce}\nIssued: ${f.issuedAt}\n\nThis only proves you own this wallet. It does not move any NIM.`
}
