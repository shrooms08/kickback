// season: Season 1 for the signed-in wallet, computed here from verified data only.
//   GET                -> { season, code, milestones, unlocked, skin, streak, invites, chainOk }
//   POST { skin }      -> apply an unlocked Stack skin
//   POST { ref }       -> claim an invite code (once per wallet; not your own)
// Milestones come from the chain (stake, kickbacks from a direct pool's reward address) and from
// shares whose tx was found on chain. Nothing the app says about itself is trusted. Unlocks are
// only ever added. When the RPC is down the last stored state is returned (chainOk: false).
import { db } from '../_shared/db.ts'
import { corsHeaders, json, readJson } from '../_shared/http.ts'
import { bearer, verifySession } from '../_shared/session.ts'
import type { Session } from '../_shared/session.ts'
import { getStaker, hasStake, rpcFor, txPage } from '../_shared/chain.ts'
import { verifyShare } from '../_shared/proofs.ts'
import type { ShareRow } from '../_shared/proofs.ts'
import { SKINS, countedRuns, inviteCode, isInviteCode, milestonesFrom, streak } from '../_shared/season.ts'
import type { Skin } from '../_shared/season.ts'
import { STAKING_CONTRACT, everStaked } from '../_shared/verify.ts'
import { TIERS, XP, seasonOf, tierInfo } from '../_shared/xp.ts'
import { awardFromData, seasonXp, snapshotStake } from '../_shared/xpAward.ts'

const secret = Deno.env.get('SESSION_SECRET')
if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters).')

const norm = (a: string) => String(a || '').replace(/\s+/g, '').toUpperCase()
// deno-lint-ignore no-explicit-any
const must = (r: { data: unknown, error: unknown }): any => { if (r.error) throw r.error; return r.data }

async function codeFor(s: Session): Promise<string> {
  const have = must(await db.from('invite_codes').select('code').eq('address', s.address).eq('network', s.network).maybeSingle()) as { code: string } | null
  if (have) return have.code
  for (let i = 0; i < 8; i++) {
    const code = inviteCode(crypto.getRandomValues(new Uint8Array(4)))
    const { error } = await db.from('invite_codes').insert({ address: s.address, network: s.network, code })
    if (!error) return code
    if (error.code !== '23505') throw error
    const again = must(await db.from('invite_codes').select('code').eq('address', s.address).eq('network', s.network).maybeSingle()) as { code: string } | null
    if (again) return again.code
  }
  throw new Error('could not allocate an invite code')
}

/** Read the chain: stake now, new kickbacks since the last scan. Returns false if the RPC failed. */
async function scanChain(s: Session): Promise<boolean> {
  const rpc = rpcFor(s.network)
  const prev = must(await db.from('chain_scan').select('newest_hash, staked, scanned_at').eq('address', s.address).eq('network', s.network).maybeSingle()) as { newest_hash: string | null, staked: boolean, scanned_at: string } | null
  // At most one chain read per wallet per minute: repeated reads get the stored state.
  if (prev && Date.now() - Date.parse(prev.scanned_at) < 60_000) return true
  try {
    const staker = await getStaker(rpc, s.address)
    const pools = must(await db.from('pool_stats').select('reward_address').eq('network', s.network).eq('payout_kind', 'direct')) as Array<{ reward_address: string | null }>
    // Kickbacks only come from direct-payout pools the cron knows (not from any validator a wallet
    // delegates to: a self-made validator could pay its own reward address to itself).
    const rewards = new Set(pools.map(p => norm(p.reward_address ?? '')).filter(Boolean))
    const me = norm(s.address)
    let staked = !!prev?.staked || hasStake(staker)
    let newest: string | null = null, startAt: string | null = null
    const found: Array<Record<string, unknown>> = []
    for (let page = 0; page < 3; page++) {
      const list = await txPage(rpc, s.address, startAt)
      if (page === 0) newest = list[0]?.hash ?? prev?.newest_hash ?? null
      let stop = false
      for (const t of list) {
        if (t.hash === prev?.newest_hash) { stop = true; break }
        if (t.executionResult === false || !(t.value > 0)) continue
        if (norm(t.to) === me && rewards.has(norm(t.from))) found.push({ address: s.address, network: s.network, hash: t.hash, at: new Date(t.timestamp).toISOString(), luna: t.value, from_address: t.from })
        if (norm(t.from) === me && norm(t.to) === norm(STAKING_CONTRACT)) staked = true
      }
      if (stop || list.length < 100) break
      startAt = list[list.length - 1].hash
    }
    if (found.length) must(await db.from('kickbacks_seen').upsert(found, { onConflict: 'address,network,hash', ignoreDuplicates: true }))
    must(await db.from('chain_scan').upsert({ address: s.address, network: s.network, newest_hash: newest, staked, scanned_at: new Date().toISOString() }, { onConflict: 'address,network' }))
    return true
  }
  catch (e) {
    console.error('season scan', (e as Error).message)
    return false
  }
}

/** Invitees who claimed this wallet's code with no stake and have staked since. */
async function creditInvites(s: Session): Promise<boolean> {
  const open = must(await db.from('referrals').select('invitee').eq('network', s.network).eq('inviter', s.address).eq('had_stake_at_claim', false).is('credited_at', null).order('claimed_at', { ascending: false }).limit(10)) as Array<{ invitee: string }>
  try {
    for (const r of open) {
      if (hasStake(await getStaker(rpcFor(s.network), r.invitee))) must(await db.from('referrals').update({ credited_at: new Date().toISOString() }).eq('invitee', r.invitee).eq('network', s.network))
    }
    return true
  }
  catch { return false }
}

async function recheckShares(s: Session) {
  const cutoff = new Date(Date.now() - 2 * 60e3).toISOString()
  const rows = must(await db.from('shares').select('id, address, network, amount_luna, slice_type, tx_hash, status')
    .eq('address', s.address).eq('network', s.network).eq('verified', false).eq('status', 'confirmed').not('tx_hash', 'is', null)
    .or(`checked_at.is.null,checked_at.lt.${cutoff}`).lt('check_count', 10).order('checked_at', { ascending: true, nullsFirst: true }).gt('created_at', new Date(Date.now() - 48 * 3600e3).toISOString()).limit(10)) as ShareRow[]
  for (const r of rows) await verifyShare(rpcFor(s.network), r)
}

const cachedQuests = new Map<string, { quests: Awaited<ReturnType<typeof awardFromData>>['quests'] }>()
const key = (s: Session) => `${s.network}:${s.address}`

async function getSeason(s: Session) {
  const code = await codeFor(s)
  const scanned = must(await db.from('chain_scan').select('scanned_at').eq('address', s.address).eq('network', s.network).maybeSingle()) as { scanned_at: string } | null
  const fresh = !!scanned && Date.now() - Date.parse(scanned.scanned_at) < 60_000
  if (!fresh) await recheckShares(s)
  const chainOk = (await scanChain(s)) && (fresh || (await creditInvites(s)))
  const mine = (table: string, cols: string) => db.from(table).select(cols).eq('address', s.address).eq('network', s.network)
  const [scanR, kicksR, sharesR, userR] = await Promise.all([
    mine('chain_scan', 'staked').maybeSingle(),
    mine('kickbacks_seen', 'at, luna'),
    mine('shares', 'id, run_id, slice_type, amount_luna, block_at').eq('verified', true).eq('status', 'confirmed'),
    mine('users', 'skin').maybeSingle(),
  ])
  const scan = must(scanR) as { staked: boolean } | null
  const kicks = must(kicksR) as Array<{ at: string, luna: number }>
  const shares = must(sharesR) as Array<{ id: string, run_id: string | null, slice_type: string, amount_luna: number, block_at: string }>
  const user = must(userR) as { skin: Skin } | null
  const invites = must(await db.from('referrals').select('credited_at').eq('network', s.network).eq('inviter', s.address)) as Array<{ credited_at: string | null }>
  const plan = must(await db.from('plans').select('plan_started_at, first_seen_at').eq('address', s.address).eq('network', s.network).maybeSingle()) as { plan_started_at: string | null, first_seen_at: string } | null
  // Shares count only after the plan started, and a run only when a kickback landed since the last
  // counted run: random transfers to a contact, or many tiny runs, don't add up to anything.
  const since = plan?.plan_started_at ? Math.max(Date.parse(plan.plan_started_at), Date.parse(plan.first_seen_at)) : Infinity
  const kickTimes = kicks.map(k => Date.parse(k.at))
  const runAt = new Map<string, number>()
  for (const sh of shares) { const k = sh.run_id ?? sh.id, t = Date.parse(sh.block_at); if (t >= since) runAt.set(k, Math.min(runAt.get(k) ?? Infinity, t)) }
  const counted = new Set(countedRuns(kickTimes, [...runAt].map(([id, at]) => ({ id, at }))))
  const inRuns = shares.filter(x => counted.has(x.run_id ?? x.id))
  // Kickbacks from before the plan started don't count as missed.
  const st = streak(kickTimes.filter(t => t >= since), [...counted].map(id => runAt.get(id)!))
  const kickLuna = kicks.reduce((a, k) => a + Number(k.luna), 0)
  const facts = {
    staked: !!scan?.staked,
    kickbacks: kicks.length,
    sends: inRuns.filter(x => x.slice_type === 'send').length,
    runs: counted.size,
    // Never more than the kickbacks that actually landed.
    sharedLuna: Math.min(kickLuna, inRuns.filter(x => x.slice_type !== 'keep').reduce((a, x) => a + Number(x.amount_luna), 0)),
    bestStreak: st.best,
    invitedStakers: invites.filter(i => i.credited_at).length,
  }
  const reached = milestonesFrom(facts)
  if (reached.length) must(await db.from('milestones').upsert(reached.map(key => ({ address: s.address, network: s.network, key })), { onConflict: 'address,network,key', ignoreDuplicates: true }))
  const stored = must(await db.from('milestones').select('key, unlocked_at').eq('address', s.address).eq('network', s.network)) as Array<{ key: string, unlocked_at: string }>

  // Season XP (Stage B): today's stake if the cron hasn't reached this wallet, then runs, shares,
  // invites and quests from verified data. Skins now unlock by tier; Stage A milestone unlocks stay.
  const season = seasonOf()
  // Award work runs at most once a minute per wallet; in between, quests are read from the last run.
  if (!fresh) await snapshotStake(s.address, s.network).catch(() => null)
  const { quests } = fresh && cachedQuests.has(key(s)) ? cachedQuests.get(key(s))! : await awardFromData(s.address, s.network)
  cachedQuests.set(key(s), { quests })
  const xp = await seasonXp(s.address, s.network, season.id)
  const tier = tierInfo(xp)
  const tierSkins = TIERS.slice(0, tier.i + 1).map(t => t.skin)
  must(await db.from('unlocks').upsert(tierSkins.map(skin => ({ address: s.address, network: s.network, skin, source: skin === 'spark' ? 'default' : 'tier' })), { onConflict: 'address,network,skin', ignoreDuplicates: true }))
  const unlocks = must(await db.from('unlocks').select('skin, unlocked_at').eq('address', s.address).eq('network', s.network)) as Array<{ skin: Skin, unlocked_at: string }>
  return {
    season: { id: season.id, name: `Season ${season.id}`, endsAt: season.endsAt, ended: season.ended, nextStartsAt: season.nextStartsAt },
    xp,
    tier,
    tiers: TIERS.map(t => ({ name: t.name, at: t.at, skin: t.skin })),
    quests,
    xpWays: { stake: 'min(2000, 50 × √staked NIM) a day', run: XP.run, share: XP.share, invite: XP.invite, quest: XP.quest },
    code,
    milestones: stored,
    unlocked: SKINS.filter(k => unlocks.some(u => u.skin === k)),
    unlockedAt: Object.fromEntries(unlocks.map(u => [u.skin, u.unlocked_at])),
    skin: user?.skin ?? 'spark',
    streak: st,
    facts: { runs: facts.runs, sharedLuna: facts.sharedLuna, kickbacks: facts.kickbacks },
    invites: { claimed: invites.length, staked: facts.invitedStakers },
    chainOk,
  }
}

async function post(s: Session, body: any) {
  if (body?.skin !== undefined) {
    if (!SKINS.includes(body.skin)) return { status: 400, body: { error: 'unknown skin' } }
    if (body.skin !== 'spark') {
      const have = must(await db.from('unlocks').select('skin').eq('address', s.address).eq('network', s.network).eq('skin', body.skin).maybeSingle())
      if (!have) return { status: 400, body: { error: 'that skin is not unlocked yet' } }
    }
    must(await db.from('users').update({ skin: body.skin }).eq('address', s.address).eq('network', s.network))
    return { status: 200, body: { ok: true, skin: body.skin } }
  }
  if (body?.ref !== undefined) {
    const code = typeof body.ref === 'string' ? body.ref.trim().toUpperCase() : ''
    if (!isInviteCode(code)) return { status: 400, body: { error: 'invite code is not valid' } }
    // One inviter per wallet, checked first: a wallet that has one learns nothing about other codes.
    const already = must(await db.from('referrals').select('inviter').eq('network', s.network).eq('invitee', s.address).maybeSingle())
    if (already) return { status: 409, body: { error: 'this wallet already has an inviter' } }
    const owner = must(await db.from('invite_codes').select('address').eq('network', s.network).eq('code', code).maybeSingle()) as { address: string } | null
    if (!owner) return { status: 400, body: { error: 'no such invite code' } }
    if (norm(owner.address) === norm(s.address)) return { status: 400, body: { error: 'that is your own invite code' } }
    // "Had a stake" = the server ever saw one (a stake snapshot, the scan's staked flag, a verified
    // stake), staked now, or anywhere in its whole history (an unstaked old staker isn't new).
    const own = (table: string) => db.from(table).select('address', { count: 'exact', head: true }).eq('address', s.address).eq('network', s.network)
    const [snapR, scanR, evR] = await Promise.all([own('stake_snapshots').gt('active_luna', 0), own('chain_scan').eq('staked', true), own('events').eq('verified', true)])
    for (const r of [snapR, scanR, evR]) if (r.error) throw r.error
    let had = !!(snapR.count || scanR.count || evR.count)
    if (!had) {
      try {
        const rpc = rpcFor(s.network)
        had = hasStake(await getStaker(rpc, s.address)) || await everStaked(startAt => txPage(rpc, s.address, startAt), s.address)
      }
      catch { return { status: 503, body: { error: 'could not check the chain, try again' } } }
    }
    const { error } = await db.from('referrals').insert({ invitee: s.address, network: s.network, inviter: owner.address, code, had_stake_at_claim: had })
    if (error) {
      if (error.code === '23505') return { status: 409, body: { error: 'this wallet already has an inviter' } }
      throw error
    }
    return { status: 200, body: { ok: true, counts: !had } }
  }
  return { status: 400, body: { error: 'send a skin or a ref' } }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS') ?? '')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const session = await verifySession(secret!, bearer(req.headers.get('authorization')))
  if (!session) return json({ error: 'Sign in first.' }, 401, cors)
  try {
    if (req.method === 'GET') return json(await getSeason(session), 200, cors)
    if (req.method === 'POST') { const r = await post(session, await readJson(req)); return json(r.body, r.status, cors) }
    return json({ error: 'GET or POST' }, 405, cors)
  }
  catch (error) {
    console.error('season', error)
    return json({ error: 'Season unavailable' }, 500, cors)
  }
})
