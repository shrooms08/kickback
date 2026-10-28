import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { restResult, restUrl } from '../supabase/functions/_shared/restAdapter'

const B = 'https://v2.nimiqwatch.com/api'
const ADDR = 'NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8'

describe('Nimiq.Watch REST as a JSON-RPC fallback: requests', () => {
  it('maps the methods it can answer', () => {
    expect(restUrl(B, 'getBlockNumber', [])).toBe(`${B}/v1/latest/1`)
    expect(restUrl(B, 'getAccountByAddress', [ADDR])).toBe(`${B}/v1/account/NQ03J45B27LTQHD72PRM73QPSB15LM6HVCR8`)
    expect(restUrl(B, 'getStakerByAddress', [ADDR])).toBe(`${B}/v2/staker/NQ03J45B27LTQHD72PRM73QPSB15LM6HVCR8`)
    expect(restUrl(B, 'getTransactionsByAddress', [ADDR, 100, null])).toBe(`${B}/v1/account-transactions/NQ03J45B27LTQHD72PRM73QPSB15LM6HVCR8`)
    expect(restUrl(B, 'getTransactionByHash', ['ab'.repeat(32)])).toBe(`${B}/v1/transaction/${'ab'.repeat(32)}`)
    expect(restUrl(B, 'getBlockByNumber', [65418000, false])).toBe(`${B}/v1/block/65418000`)
  })
  it('says "not supported" for the rest (and for history pages after the first)', () => {
    for (const m of ['getValidatorByAddress', 'getActiveValidators', 'getBlockAfterReportingWindow', 'sendRawTransaction']) expect(restUrl(B, m, [])).toBeNull()
    expect(restUrl(B, 'getTransactionsByAddress', [ADDR, 100, 'ab'.repeat(32)])).toBeNull()
    expect(restUrl(B, 'getAccountByAddress', ['../../etc'])).toBeNull()
    expect(restUrl(B, 'getTransactionByHash', ['xyz'])).toBeNull()
  })
})

describe('Nimiq.Watch REST as a JSON-RPC fallback: replies', () => {
  it('staker in the JSON-RPC shape; unknown staker = the "No staker" answer', () => {
    const st = { address: ADDR, balance: 3200000000000, delegation: 'NQ32 1U9X', inactiveBalance: 0, inactiveFrom: null, retiredBalance: 0 }
    expect(restResult('getStakerByAddress', [ADDR], 200, st)).toEqual({ result: { data: st } })
    expect(restResult('getStakerByAddress', [ADDR], 404, { error: true, message: 'Staker not found' })).toEqual({ error: { code: -32603, message: 'Internal error', data: `No staker with address: ${ADDR}` } })
  })
  it('account type as text; an unknown account is an empty basic one', () => {
    expect(restResult('getAccountByAddress', [ADDR], 200, { address: ADDR, type: 0, balance: 5 })).toEqual({ result: { data: { address: ADDR, type: 'basic', balance: 5 } } })
    expect(restResult('getAccountByAddress', [ADDR], 200, { address: ADDR, type: 1, balance: 5 })!.result!.data).toMatchObject({ type: 'vesting' })
    expect(restResult('getAccountByAddress', [ADDR], 404, {})).toEqual({ result: { data: { address: ADDR, type: 'basic', balance: 0 } } })
  })
  it('transactions newest first, in the JSON-RPC shape (ms timestamps), cut to max', () => {
    const list = [
      { block_height: 10, hash: 'a', sender_address: 'NQ16 POOL', receiver_address: ADDR, value: 5, fee: 0, executed: true, timestamp: 1000, data: '' },
      { block_height: 20, hash: 'b', sender_address: 'NQ16 POOL', receiver_address: ADDR, value: 6, fee: 0, executed: false, timestamp: 2000, data: '4b69' },
    ]
    const r = restResult('getTransactionsByAddress', [ADDR, 1, null], 200, list)!.result!.data as Array<Record<string, unknown>>
    expect(r).toEqual([{ hash: 'b', blockNumber: 20, timestamp: 2_000_000, from: 'NQ16 POOL', to: ADDR, value: 6, fee: 0, executionResult: false, recipientData: '4b69', relatedAddresses: [] }])
  })
  it('a missing transaction is the "not found" answer', () => {
    expect(restResult('getTransactionByHash', ['ab'.repeat(32)], 404, {})).toEqual({ error: { code: -32603, message: 'Internal error', data: `Transaction not found: ${'ab'.repeat(32)}` } })
  })
  it('head height and block timestamps', () => {
    expect(restResult('getBlockNumber', [], 200, [{ height: 65418141, timestamp: 1 }])).toEqual({ result: { data: 65418141 } })
    expect(restResult('getBlockByNumber', [7, false], 200, { height: 7, hash: 'h', timestamp: 1793208109 })).toEqual({ result: { data: { number: 7, hash: 'h', timestamp: 1_793_208_109_000 } } })
  })
  it('a 5xx or an unexpected body is an endpoint failure (null)', () => {
    expect(restResult('getBlockNumber', [], 503, null)).toBeNull()
    expect(restResult('getBlockNumber', [], 200, { nope: 1 })).toBeNull()
    expect(restResult('getStakerByAddress', [ADDR], 200, 'html')).toBeNull()
  })
})

describe('REST adapter copies stay identical', () => {
  it('src/lib/restAdapter.ts and supabase/functions/_shared/restAdapter.ts', () => {
    expect(readFileSync('src/lib/restAdapter.ts', 'utf8')).toBe(readFileSync('supabase/functions/_shared/restAdapter.ts', 'utf8'))
  })
})
