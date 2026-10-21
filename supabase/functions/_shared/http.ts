/** CORS and JSON helpers for Kickback's Edge Functions. */

/** Production, Vercel previews of the kickback project, and local dev. ALLOWED_ORIGINS adds more. */
const ORIGINS = [
  /^https:\/\/kickback-ecru\.vercel\.app$/,
  /^https:\/\/kickback-[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
]

export function corsHeaders(req: Request, extraOrigins = '', any = false): Record<string, string> {
  const origin = req.headers.get('origin') || ''
  const extra = extraOrigins.split(',').map(s => s.trim()).filter(Boolean)
  const allowed = any ? '*' : (ORIGINS.some(r => r.test(origin)) || extra.includes(origin) ? origin : 'https://kickback-ecru.vercel.app')
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

export function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

export async function readJson(req: Request): Promise<any> {
  try { return await req.json() }
  catch { return null }
}
