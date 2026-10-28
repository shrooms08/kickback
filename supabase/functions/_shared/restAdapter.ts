// Nimiq.Watch REST API (https://v2.nimiqwatch.com/api, CORS open) as a mainnet fallback for the
// JSON-RPC methods it can answer. Pure: one function builds the URL (null = not supported here,
// try the next endpoint), one turns the reply into a JSON-RPC result or error (null = the
// endpoint failed). Kept identical in src/lib/restAdapter.ts (a test checks it).
// Not available here: validators, active validators, reporting window, history pages after the
// first (the API returns an address's latest 20 transactions).

export const REST_FALLBACK: Record<'mainnet' | 'testnet', string | null> = { mainnet: 'https://v2.nimiqwatch.com/api', testnet: null }

const compact = (a: unknown) => (typeof a === 'string' ? a.replace(/\s+/g, '').toUpperCase() : '')
const isAddr = (a: string) => /^NQ[0-9]{2}[0-9A-Z]{32}$/.test(a)
const spaced = (a: string) => a.replace(/(.{4})/g, '$1 ').trim()
const ACCOUNT_TYPES = ['basic', 'vesting', 'htlc', 'staking']

export function restUrl(base: string, method: string, params: unknown[]): string | null {
  const a = compact(params[0])
  switch (method) {
    case 'getBlockNumber': return `${base}/v1/latest/1`
    case 'getAccountByAddress': return isAddr(a) ? `${base}/v1/account/${a}` : null
    case 'getStakerByAddress': return isAddr(a) ? `${base}/v2/staker/${a}` : null
    case 'getTransactionsByAddress': return isAddr(a) && params[2] == null ? `${base}/v1/account-transactions/${a}` : null
    case 'getTransactionByHash': return typeof params[0] === 'string' && /^[0-9a-f]{64}$/i.test(params[0]) ? `${base}/v1/transaction/${params[0].toLowerCase()}` : null
    case 'getBlockByNumber': return Number.isSafeInteger(params[0]) && (params[0] as number) > 0 ? `${base}/v1/block/${params[0]}` : null
    default: return null
  }
}

type Reply = { result?: { data: unknown }, error?: { code: number, message: string, data?: string } } | null
const answer = (data: unknown): Reply => ({ result: { data } })
const notFound = (data: string): Reply => ({ error: { code: -32603, message: 'Internal error', data } })

/** Timestamps are seconds; anything that lands more than an hour in the future means the units changed. */
const FUTURE_SLACK_MS = 3600e3
// deno-lint-ignore no-explicit-any
function tx(t: any) {
  return {
    hash: String(t.hash).toLowerCase(), blockNumber: t.block_height, timestamp: Number(t.timestamp) * 1000,
    from: t.sender_address, to: t.receiver_address, value: t.value, fee: t.fee,
    // Only a real boolean: a missing or odd field must never read as "executed".
    executionResult: typeof t.executed === 'boolean' ? t.executed : undefined,
    recipientData: t.data, relatedAddresses: [],
  }
}
const sane = (x: { timestamp: number }) => Number.isFinite(x.timestamp) && x.timestamp <= Date.now() + FUTURE_SLACK_MS
// deno-lint-ignore no-explicit-any
const apiNotFound = (body: any) => !!body && typeof body === 'object' && body.error === true && /not found/i.test(String(body.message ?? ''))

// deno-lint-ignore no-explicit-any
export function restResult(method: string, params: unknown[], status: number, body: any): Reply {
  if (status >= 500 || status === 429) return null
  const a = compact(params[0])
  if (status === 404) {
    // Only the API's own "not found" is an answer; any other 404 (moved route, CDN page) is a failure.
    if (!apiNotFound(body)) return null
    if (method === 'getStakerByAddress') return notFound(`No staker with address: ${spaced(a)}`)
    if (method === 'getTransactionByHash') return notFound(`Transaction not found: ${String(params[0]).toLowerCase()}`)
    if (method === 'getAccountByAddress') return answer({ address: spaced(a), type: 'basic', balance: 0 })
    return null
  }
  if (status !== 200 || !body || typeof body !== 'object') return null
  switch (method) {
    case 'getBlockNumber': return Array.isArray(body) && Number.isSafeInteger(body[0]?.height) ? answer(body[0].height) : null
    case 'getAccountByAddress': return typeof body.balance === 'number' ? answer({ address: body.address, type: ACCOUNT_TYPES[body.type] ?? String(body.type), balance: body.balance }) : null
    case 'getStakerByAddress': return typeof body.balance === 'number' && typeof body.delegation === 'string' ? answer(body) : null
    case 'getTransactionsByAddress': {
      if (!Array.isArray(body)) return null
      const max = Number(params[1] ?? 500)
      const list = body.map(tx)
      if (!list.every(sane)) return null
      return answer(list.sort((x, y) => y.blockNumber - x.blockNumber).slice(0, max > 0 ? max : 500))
    }
    case 'getTransactionByHash': { if (typeof body.hash !== 'string') return null; const t = tx(body); return sane(t) ? answer(t) : null }
    case 'getBlockByNumber': return Number.isSafeInteger(body.height) ? answer({ number: body.height, hash: body.hash, timestamp: Number(body.timestamp) * 1000 }) : null
    default: return null
  }
}
