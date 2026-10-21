// Service-role client for Edge Functions (bypasses RLS; only used after the function's own checks).
import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')

export const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/** Canonical stored address form: upper case, spaced every 4 characters. */
export const spacedAddress = (a: string) => a.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim()
