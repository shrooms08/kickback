// stats (public): usage totals per network, last 7 days and all time. No addresses.
import { db } from '../_shared/db.ts'
import { corsHeaders, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const cors = corsHeaders(req, '', true)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405, cors)
  const { data, error } = await db.rpc('kickback_stats')
  if (error) {
    console.error('stats', error)
    return json({ error: 'Stats unavailable' }, 500, cors)
  }
  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), units: { luna: '1 NIM = 100,000 Luna' }, ...data }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  })
})
