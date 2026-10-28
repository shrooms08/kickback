import { describe, expect, it } from 'vitest'
import { EndpointPool, classifyFailure } from '../src/lib/endpoints'

const A = 'https://a.example', B = 'https://b.example', P = 'https://proxy.example'

describe('endpoint pool: ordered failover with recovery', () => {
  it('uses the endpoints in the configured order', () => {
    const pool = new EndpointPool([A, B, P], { now: () => 0 })
    expect(pool.order().map(e => e.url)).toEqual([A, B, P])
  })
  it('a failed endpoint is skipped, the next one used', () => {
    let t = 0
    const pool = new EndpointPool([A, B, P], { now: () => t })
    pool.markDown(A, 'HTTP 503')
    expect(pool.order().map(e => e.url)).toEqual([B, P])
    expect(pool.active()).toBe(B)
  })
  it('the failed endpoint is tried again after 60s', () => {
    let t = 0
    const pool = new EndpointPool([A, B], { now: () => t })
    pool.markDown(A, 'timeout')
    t = 59_999
    expect(pool.order()[0].url).toBe(B)
    t = 60_000
    expect(pool.order()[0].url).toBe(A)
  })
  it('a success clears the error and records latency', () => {
    let t = 0
    const pool = new EndpointPool([A, B], { now: () => t })
    pool.markDown(A, 'x'); t = 61_000
    pool.markOk(A, 120)
    expect(pool.status()).toEqual([
      { url: A, kind: 'direct', state: 'ok', lastError: '', latencyMs: 120 },
      { url: B, kind: 'direct', state: 'unknown', lastError: '', latencyMs: null },
    ])
  })
  it('everything down: nothing to try until the first one recovers', () => {
    let t = 0
    const pool = new EndpointPool([A, B], { now: () => t })
    pool.markDown(A, 'x'); pool.markDown(B, 'y')
    expect(pool.order()).toEqual([])
    expect(pool.active()).toBeNull()
    t = 60_000
    expect(pool.order().map(e => e.url)).toEqual([A, B])
  })
  it('the proxy is marked as the last resort', () => {
    const pool = new EndpointPool([A], { now: () => 0, proxy: P })
    expect(pool.order().map(e => [e.url, e.kind])).toEqual([[A, 'direct'], [P, 'proxy']])
  })
})

describe('what counts as an endpoint failure', () => {
  it('network errors, timeouts, 5xx, 429 and non-JSON bodies fail over', () => {
    expect(classifyFailure({ network: true })).toBe('failover')
    expect(classifyFailure({ timeout: true })).toBe('failover')
    expect(classifyFailure({ status: 503 })).toBe('failover')
    expect(classifyFailure({ status: 500 })).toBe('failover')
    expect(classifyFailure({ status: 429 })).toBe('failover')
    expect(classifyFailure({ status: 200, json: false })).toBe('failover')
  })
  it('a valid JSON-RPC answer, even an error like "No staker", is an answer', () => {
    expect(classifyFailure({ status: 200, json: true })).toBe('answer')
    expect(classifyFailure({ status: 200, json: true, rpcError: 'No staker with address' })).toBe('answer')
    expect(classifyFailure({ status: 400, json: true, rpcError: 'Invalid params' })).toBe('answer')
  })
})
