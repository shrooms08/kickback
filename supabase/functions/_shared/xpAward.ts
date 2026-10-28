// Award Season XP from verified data. Every write is an insert into xp_ledger that the unique
// constraints refuse when it would double count; a refused insert is simply skipped.
import { db } from './db.ts'
import { getStaker, rpcFor } from './chain.ts'
import type { Net } from './chain.ts'
import { XP, dailyStakeXp, daySlot, questProgress, runQualifies, seasonOf, utcDay } from './xp.ts'
import { countedRuns, weekKey } from './season.ts'

const H = 3600e3
// deno-lint-ignore no-explicit-any
const must = (r: { data: unknown, error: unknown }): any => { if (r.error) throw r.error; return r.data }

/** Insert one ledger row. false = it already exists (or would double count). */
async function grant(row: { address: string, network: Net, season: number, source: string, ref: string, proof?: string | null, amount: number }): Promise<boolean> {
  const { error } = await db.from('xp_ledger').insert({ ...row, proof: row.proof ?? null })
  if (!error) return true
  if (error.code === '23505') return false
  throw error
}

/** Snapshot today's active stake for one wallet (RPC) and award daily stake XP once. */
export async function snapshotStake(address: string, network: Net, now = Date.now()): Promise<{ ok: boolean, activeLuna: number }> {
  const day = utcDay(now)
  const have = must(await db.from('stake_snapshots').select('active_luna').eq('address', address).eq('network', network).eq('day', day).maybeSingle())
  let active: number
  if (have) active = Number(have.active_luna)
  else {
    try { active = Math.max(0, Number((await getStaker(rpcFor(network), address))?.balance ?? 0)) }
    catch { return { ok: false, activeLuna: 0 } }
    const { error } = await db.from('stake_snapshots').insert({ address, network, day, active_luna: active })
    if (error && error.code !== '23505') throw error
  }
  const s = seasonOf(now)
  const amount = dailyStakeXp(active / 1e5)
  if (!s.ended && amount > 0) await grant({ address, network, season: s.id, source: 'stake', ref: day, amount })
  return { ok: true, activeLuna: active }
}

interface ShareRow { id: string, run_id: string | null, slice_type: string, amount_luna: number, tx_hash: string | null, block_at: string | null, created_at: string }

/** Invitees must keep a real stake before the inviter earns: 3 daily snapshots of 10+ NIM. */
const INVITE_MIN_DAYS = 3, INVITE_MIN_LUNA = 1_000_000, INVITES_PER_SEASON = 10
/** The weekly "keep your stake" quest needs at least 1 NIM active. */
const KEEP_MIN_LUNA = 100_000
/** A share earns XP only if it was reported within a day of its tx (no back-filling old transfers). */
const REPORT_WINDOW_MS = 24 * H

/** Award runs, shares, invites and quests for one wallet; returns quest progress for this week. */
export async function awardFromData(address: string, network: Net, now = Date.now()) {
  const s = seasonOf(now)
  const week = weekKey(now), weekStart = Date.parse(week + 'T00:00:00Z'), weekEnd = weekStart + 7 * 24 * H
  const seasonStart = Date.parse(s.startsAt)
  const plan = must(await db.from('plans').select('slices, min_ready_luna, updated_at, plan_started_at, first_seen_at').eq('address', address).eq('network', network).maybeSingle())
  // The later of the app's plan start and when the server first saw the plan (which never moves).
  const since = plan?.plan_started_at ? Math.max(Date.parse(plan.plan_started_at), Date.parse(plan.first_seen_at)) : Infinity
  const minLuna = Math.max(10_000, Number(plan?.min_ready_luna ?? 10_000))
  const kickTimes = (must(await db.from('kickbacks_seen').select('at').eq('address', address).eq('network', network)) as Array<{ at: string }>).map(k => Date.parse(k.at))
  // Only verified shares count (keep slices have no tx and are never verified).
  const shares = must(await db.from('shares').select('id, run_id, slice_type, amount_luna, tx_hash, block_at, created_at')
    .eq('address', address).eq('network', network).eq('status', 'confirmed').eq('verified', true).not('run_id', 'is', null)) as ShareRow[]

  // One entry per run: its time is its first tx's block time, its proof that tx's hash (chain data,
  // so relabelling runs can't earn the same txs twice), its size the verified NIM it moved.
  const runs = new Map<string, { at: number, proof: string, verified: number, sends: number, total: number }>()
  for (const x of shares) {
    if (!x.block_at || !x.tx_hash) continue
    const at = Date.parse(x.block_at)
    if (Date.parse(x.created_at) > at + REPORT_WINDOW_MS) continue
    const r = runs.get(x.run_id!) ?? { at: Infinity, proof: '', verified: 0, sends: 0, total: 0 }
    r.verified++
    r.total += Number(x.amount_luna)
    if (x.slice_type === 'send') r.sends++
    if (at < r.at || (at === r.at && x.tx_hash < r.proof)) { r.at = at; r.proof = x.tx_hash }
    runs.set(x.run_id!, r)
  }
  // Same rule as milestones: after the plan started, and only runs that follow a kickback.
  const candidates = [...runs.entries()].filter(([, r]) => r.at >= since)
  const counted = new Set(countedRuns(kickTimes, candidates.map(([id, r]) => ({ id, at: r.at }))))
  const verifiedRuns = candidates.filter(([id]) => counted.has(id)).sort((a, b) => a[1].at - b[1].at)

  // Everything this season already has: known rows are skipped, not re-inserted.
  const ledger = must(await db.from('xp_ledger').select('source, ref, proof').eq('address', address).eq('network', network).eq('season', s.id)) as Array<{ source: string, ref: string, proof: string | null }>
  const has = new Set(ledger.map(l => `${l.source}:${l.ref}`))
  const proved = new Set(ledger.filter(l => l.proof).map(l => `${l.source}:${l.proof}`))
  const perDay = (source: string, day: string) => ledger.filter(l => l.source === source && l.ref.startsWith(day + '#')).length
  const give = async (row: { source: string, ref: string, proof?: string, amount: number }) => {
    if (has.has(`${row.source}:${row.ref}`) || (row.proof && proved.has(`${row.source}:${row.proof}`))) return false
    const ok = await grant({ address, network, season: s.id, ...row })
    has.add(`${row.source}:${row.ref}`)
    if (row.proof) proved.add(`${row.source}:${row.proof}`)
    if (ok) ledger.push({ source: row.source, ref: row.ref, proof: row.proof ?? null })
    return ok
  }

  if (!s.ended) {
    for (const [, r] of verifiedRuns) {
      if (r.at < seasonStart) continue
      const day = utcDay(r.at)
      for (const [source, amount, ok] of [['run', XP.run, runQualifies({ verifiedTxs: r.verified, totalLuna: r.total, minLuna })], ['share', XP.share, r.sends > 0]] as const) {
        if (!ok || proved.has(`${source}:${r.proof}`)) continue
        const slot = daySlot(perDay(source, day))
        if (slot) await give({ source, ref: `${day}#${slot}`, proof: r.proof, amount })
      }
    }
    // Invites credited this season whose invitee kept a real stake for 3 days; at most 10 a season.
    const credited = must(await db.from('referrals').select('invitee, credited_at').eq('network', network).eq('inviter', address).not('credited_at', 'is', null).order('credited_at')) as Array<{ invitee: string, credited_at: string }>
    let granted = ledger.filter(l => l.source === 'invite').length
    for (const c of credited) {
      if (granted >= INVITES_PER_SEASON) break
      if (Date.parse(c.credited_at) < seasonStart || has.has(`invite:${c.invitee}`)) continue
      const { count } = await db.from('stake_snapshots').select('day', { count: 'exact', head: true }).eq('address', c.invitee).eq('network', network).gte('day', s.startsAt.slice(0, 10)).gte('active_luna', INVITE_MIN_LUNA)
      if ((count ?? 0) < INVITE_MIN_DAYS) continue
      if (await give({ source: 'invite', ref: c.invitee, amount: XP.invite })) granted++
    }
  }

  // Weekly quests.
  const thisWeek = verifiedRuns.filter(([, r]) => r.at >= weekStart && r.at < weekEnd)
  const send = (plan?.slices as Array<{ type: string, percent: number, contact_id: string | null }> | undefined)?.find(x => x.type === 'send')
  let addedAndUsed = false
  // "Add someone": a contact saved this week, in the plan's send slice, and a verified send this week.
  if (send && send.percent > 0 && send.contact_id && plan && Date.parse(plan.updated_at) >= weekStart && thisWeek.some(([, r]) => r.sends > 0)) {
    const c = must(await db.from('contacts').select('created_at').eq('address', address).eq('network', network).eq('id', send.contact_id).maybeSingle())
    addedAndUsed = !!c && Date.parse(c.created_at) >= weekStart
  }
  const snaps = must(await db.from('stake_snapshots').select('day, active_luna').eq('address', address).eq('network', network).gte('day', week)) as Array<{ day: string, active_luna: number }>
  const stakeDays = snaps.filter(x => Date.parse(x.day + 'T00:00:00Z') < weekEnd && Number(x.active_luna) >= KEEP_MIN_LUNA).length
  const quests = questProgress({ runsThisWeek: thisWeek.length, addedAndUsed, stakeDays })
  if (!s.ended) for (const q of quests) if (q.done) await give({ source: 'quest', ref: `${q.key}:${week}`, amount: XP.quest })
  return { quests, week }
}

export async function seasonXp(address: string, network: Net, season: number): Promise<number> {
  const rows = must(await db.from('xp_ledger').select('amount').eq('address', address).eq('network', network).eq('season', season)) as Array<{ amount: number }>
  return rows.reduce((a, r) => a + r.amount, 0)
}
