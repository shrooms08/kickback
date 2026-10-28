// Award Season XP from verified data. Every write is an insert into xp_ledger that the unique
// constraints refuse when it would double count; a refused insert is simply skipped.
import { db } from './db.ts'
import { getStaker, rpcFor } from './chain.ts'
import type { Net } from './chain.ts'
import { XP, dailyStakeXp, daySlot, questProgress, runQualifies, seasonOf, utcDay } from './xp.ts'
import { weekKey } from './season.ts'

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
  if (!s.ended && active > 0) await grant({ address, network, season: s.id, source: 'stake', ref: day, amount: dailyStakeXp(active / 1e5) })
  return { ok: true, activeLuna: active }
}

interface ShareRow { id: string, run_id: string | null, slice_type: string, amount_luna: number, verified: boolean, block_at: string | null, created_at: string }

/** Award runs, shares, invites and quests for one wallet; returns quest progress for this week. */
export async function awardFromData(address: string, network: Net, now = Date.now()) {
  const s = seasonOf(now)
  const week = weekKey(now), weekStart = Date.parse(week + 'T00:00:00Z')
  const seasonStart = Date.parse(s.startsAt)
  const plan = must(await db.from('plans').select('slices, min_ready_luna, updated_at').eq('address', address).eq('network', network).maybeSingle())
  const minLuna = Number(plan?.min_ready_luna ?? 10_000)
  const shares = must(await db.from('shares').select('id, run_id, slice_type, amount_luna, verified, block_at, created_at')
    .eq('address', address).eq('network', network).eq('status', 'confirmed').not('run_id', 'is', null)) as ShareRow[]

  // One entry per run: its time is its first verified tx's block time.
  const runs = new Map<string, { at: number, verified: number, sends: number, total: number }>()
  for (const x of shares) {
    const r = runs.get(x.run_id!) ?? { at: Infinity, verified: 0, sends: 0, total: 0 }
    if (x.verified && x.block_at) { r.verified++; r.at = Math.min(r.at, Date.parse(x.block_at)); if (x.slice_type === 'send') r.sends++ }
    // Keep slices have no tx; they count toward the run's size, but a run still needs a verified tx.
    if (x.verified || x.slice_type === 'keep') r.total += Number(x.amount_luna)
    runs.set(x.run_id!, r)
  }
  const verifiedRuns = [...runs.entries()].filter(([, r]) => r.verified > 0 && Number.isFinite(r.at)).sort((a, b) => a[1].at - b[1].at)

  if (!s.ended) {
    const ledger = must(await db.from('xp_ledger').select('source, ref, proof').eq('address', address).eq('network', network).eq('season', s.id).in('source', ['run', 'share'])) as Array<{ source: string, ref: string, proof: string | null }>
    const done = new Set(ledger.map(l => `${l.source}:${l.proof}`))
    const perDay = (source: string, day: string) => ledger.filter(l => l.source === source && l.ref.startsWith(day + '#')).length
    for (const [id, r] of verifiedRuns) {
      if (r.at < seasonStart) continue
      const day = utcDay(r.at)
      for (const [source, amount, ok] of [['run', XP.run, runQualifies({ verifiedTxs: r.verified, totalLuna: r.total, minLuna })], ['share', XP.share, r.sends > 0]] as const) {
        if (!ok || done.has(`${source}:${id}`)) continue
        const slot = daySlot(perDay(source, day))
        if (!slot) continue
        if (await grant({ address, network, season: s.id, source, ref: `${day}#${slot}`, proof: id, amount })) {
          ledger.push({ source, ref: `${day}#${slot}`, proof: id })
          done.add(`${source}:${id}`)
        }
      }
    }
    // Invites credited this season.
    const credited = must(await db.from('referrals').select('invitee, credited_at').eq('network', network).eq('inviter', address).not('credited_at', 'is', null)) as Array<{ invitee: string, credited_at: string }>
    for (const c of credited) if (Date.parse(c.credited_at) >= seasonStart) await grant({ address, network, season: s.id, source: 'invite', ref: c.invitee, amount: XP.invite })
  }

  // Weekly quests.
  const runsThisWeek = verifiedRuns.filter(([, r]) => r.at >= weekStart && r.at < weekStart + 7 * 24 * H).length
  const send = (plan?.slices as Array<{ type: string, percent: number, contact_id: string | null }> | undefined)?.find(x => x.type === 'send')
  let addedAndUsed = false
  if (send && send.percent > 0 && send.contact_id && plan && Date.parse(plan.updated_at) >= weekStart) {
    const c = must(await db.from('contacts').select('created_at').eq('address', address).eq('network', network).eq('id', send.contact_id).maybeSingle())
    addedAndUsed = !!c && Date.parse(c.created_at) >= weekStart
  }
  const snaps = must(await db.from('stake_snapshots').select('day, active_luna').eq('address', address).eq('network', network).gte('day', week)) as Array<{ day: string, active_luna: number }>
  const stakeDays = snaps.filter(x => Date.parse(x.day + 'T00:00:00Z') < weekStart + 7 * 24 * H && Number(x.active_luna) > 0).length
  const quests = questProgress({ runsThisWeek, addedAndUsed, stakeDays })
  if (!s.ended) for (const q of quests) if (q.done) await grant({ address, network, season: s.id, source: 'quest', ref: `${q.key}:${week}`, amount: XP.quest })
  return { quests, week }
}

export async function seasonXp(address: string, network: Net, season: number): Promise<number> {
  const rows = must(await db.from('xp_ledger').select('amount').eq('address', address).eq('network', network).eq('season', season)) as Array<{ amount: number }>
  return rows.reduce((a, r) => a + r.amount, 0)
}
