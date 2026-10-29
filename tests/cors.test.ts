import { describe, expect, it } from 'vitest'
import { corsHeaders } from '../supabase/functions/_shared/http'

const allowed = (origin: string, extra = '') => corsHeaders(new Request('https://x.supabase.co/functions/v1/sync', { headers: { origin } }), extra)['Access-Control-Allow-Origin'] === origin

describe('CORS: production, this Vercel team\'s previews and localhost only (audit 14)', () => {
  it('allows production and localhost', () => {
    expect(allowed('https://kickback-ecru.vercel.app')).toBe(true)
    expect(allowed('http://localhost:5173')).toBe(true)
    expect(allowed('http://127.0.0.1:4173')).toBe(true)
  })
  it('allows previews of the shrooms08s-projects team (hash and branch URLs)', () => {
    expect(allowed('https://kickback-a1b2c3d4e-shrooms08s-projects.vercel.app')).toBe(true)
    expect(allowed('https://kickback-git-audit-fixes-shrooms08s-projects.vercel.app')).toBe(true)
  })
  it('refuses any other kickback-*.vercel.app (anyone can name a Vercel project that way)', () => {
    expect(allowed('https://kickback-evil.vercel.app')).toBe(false)
    expect(allowed('https://kickback-a1b2c3d4e-someone-else.vercel.app')).toBe(false)
    expect(allowed('https://kickback-x-shrooms08s-projects.vercel.app.evil.com')).toBe(false)
    expect(allowed('https://evil-kickback-a1b2-shrooms08s-projects.vercel.app')).toBe(false)
    expect(allowed('http://kickback-a1b2-shrooms08s-projects.vercel.app')).toBe(false)
  })
  it('a refused origin gets production as the allowed origin', () => {
    const h = corsHeaders(new Request('https://x/', { headers: { origin: 'https://kickback-evil.vercel.app' } }))
    expect(h['Access-Control-Allow-Origin']).toBe('https://kickback-ecru.vercel.app')
  })
  it('ALLOWED_ORIGINS adds exact origins', () => {
    expect(allowed('https://kickback.example', 'https://kickback.example')).toBe(true)
  })
})
