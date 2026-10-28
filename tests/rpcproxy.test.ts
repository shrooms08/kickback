import { describe, expect, it } from 'vitest'
import { PROXY_METHODS, RateLimiter, TtlCache, checkProxyRequest } from '../supabase/functions/_shared/rpcProxy'
import { readFileSync } from 'node:fs'

const req = (method: string, params: unknown[] = []) => ({ jsonrpc: '2.0', id: 1, method, params })

describe('rpc-proxy allowlist', () => {
  it('forwards the read-only methods the app uses', () => {
    for (const m of ['getBlockNumber', 'getAccountByAddress', 'getStakerByAddress', 'getValidatorByAddress', 'getTransactionsByAddress', 'getTransactionByHash', 'getBlockAfterReportingWindow', 'getBlockByNumber', 'getActiveValidators']) expect(PROXY_METHODS.has(m)).toBe(true)
    expect(checkProxyRequest(req('getStakerByAddress', ['NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T']))).toMatchObject({ ok: true, method: 'getStakerByAddress' })
  })
  it('never forwards send, submit, sign or account methods', () => {
    for (const m of ['sendRawTransaction', 'sendTransaction', 'sendBasicTransaction', 'sendStakeTransaction', 'pushTransaction', 'submitTransaction', 'createAccount', 'importRawKey', 'unlockAccount', 'sign', 'setConsensus', 'createBasicTransaction'])
      expect(checkProxyRequest(req(m, []))).toMatchObject({ ok: false })
  })
  it('rejects batches, bad params and oversized history pages', () => {
    expect(checkProxyRequest([req('getBlockNumber')]).ok).toBe(false)
    expect(checkProxyRequest({ method: 'getBlockNumber', params: 'x' }).ok).toBe(false)
    expect(checkProxyRequest(req('getAccountByAddress', ['x'.repeat(500)])).ok).toBe(false)
    expect(checkProxyRequest(req('getAccountByAddress', [{ a: 1 }])).ok).toBe(false)
    expect(checkProxyRequest(req('getTransactionsByAddress', ['NQ00', 500, null])).ok).toBe(false)
    expect(checkProxyRequest(req('getTransactionsByAddress', ['NQ00', 100, null])).ok).toBe(true)
    expect(checkProxyRequest(req('getBlockNumber', [1, 2, 3, 4, 5])).ok).toBe(false)
  })
})

describe('rpc-proxy limits', () => {
  it('rate limits per IP per minute', () => {
    let t = 0
    const rl = new RateLimiter(3, 60_000, () => t)
    expect([rl.allow('1.2.3.4'), rl.allow('1.2.3.4'), rl.allow('1.2.3.4'), rl.allow('1.2.3.4')]).toEqual([true, true, true, false])
    expect(rl.allow('5.6.7.8')).toBe(true)
    t = 60_001
    expect(rl.allow('1.2.3.4')).toBe(true)
  })
  it('caches identical calls for 15 s', () => {
    let t = 0
    const c = new TtlCache<string>(15_000, 100, () => t)
    c.set('k', 'v')
    t = 14_999; expect(c.get('k')).toBe('v')
    t = 15_001; expect(c.get('k')).toBeUndefined()
  })
})

describe('endpoint pool copies stay identical', () => {
  it('src/lib/endpoints.ts and supabase/functions/_shared/endpoints.ts', () => {
    const strip = (s: string) => s.replace(/^\/\/ COPY.*\n/m, '')
    expect(strip(readFileSync('supabase/functions/_shared/endpoints.ts', 'utf8'))).toBe(strip(readFileSync('src/lib/endpoints.ts', 'utf8')))
  })
})

import { clientIp } from '../supabase/functions/_shared/rpcProxy'
describe('rpc-proxy hardening (audit)', () => {
  it('client IP: cf-connecting-ip, then x-real-ip, then the last x-forwarded-for hop (never the first, which the caller sets)', () => {
    const h = (o: Record<string, string>) => new Headers(o)
    expect(clientIp(h({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('9.9.9.9')
    expect(clientIp(h({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' }))).toBe('8.8.8.8')
    expect(clientIp(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('2.2.2.2')
    expect(clientIp(h({}))).toBe('unknown')
  })
  it('flooding with new IPs evicts old windows instead of resetting everyone', () => {
    let t = 0
    const rl = new RateLimiter(2, 60_000, () => t, 3)
    rl.allow('a'); rl.allow('a')
    expect(rl.allow('a')).toBe(false)
    for (const ip of ['b', 'c', 'd', 'e']) rl.allow(ip)
    expect(rl.allow('a')).toBe(false)
  })
  it('getBlockByNumber only without transaction bodies', () => {
    expect(checkProxyRequest(req('getBlockByNumber', [5, false])).ok).toBe(true)
    expect(checkProxyRequest(req('getBlockByNumber', [5])).ok).toBe(true)
    expect(checkProxyRequest(req('getBlockByNumber', [5, true])).ok).toBe(false)
  })
})
