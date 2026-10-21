# Nimiq PoS (Albatross) staking lifecycle

Sources:
- Protocol docs: [Stakers](https://nimiq.dev/protocol/validators/stakers), [Staking FAQ](https://nimiq.dev/nodes/validators/staking-faq), [Rewards](https://nimiq.dev/protocol/economics/rewards).
- Web-client guide: [Stake NIM](https://nimiq.dev/web-client/guides/stake-nim).
- The rules themselves, read in core-rs-albatross `primitives/account/src/account/staking_contract/staker.rs` (branch `albatross`) and `primitives/src/policy.rs`.
- SDK: `@nimiq/mini-app-sdk` 0.2.4 types.

Where the docs and the code disagree, **the code wins**.

## Balances

A staker has three balances, all in Luna:

- **active**: delegated to a validator. This is what earns.
- **inactive**: deactivated. It's locked until released, and can be made active again at any time.
- **retired**: marked for withdrawal. It doesn't earn and can't be reactivated. It can only be removed.

Two invariants apply:
- active + inactive must be 0 or at least 100 NIM (`MINIMUM_STAKE`).
- If both are 0, retired must be 0 or at least 100 NIM.

The public RPC returns all three: `getStakerByAddress` gives `balance` (active), `inactiveBalance`, `inactiveFrom` and `retiredBalance`.

## Epochs

- An epoch is 43,200 blocks. Blocks are *nominally* 1 s apart (`blockSeparationTime: 1000` in `getPolicyConstants`), but mainnet runs a little faster: about 0.996 s per block. Measured from two election blocks on 2026-10-21 (64,756,800 → 64,800,000), an epoch took **42,992,969 ms = 11.94 h**. Over a day that is about 5 minutes of drift, which matters (see below), so Kickback measures it (`epochClock` in `src/services/chain.ts`) instead of assuming 1 s blocks.
- The first block of each epoch is an **election block**. Mainnet genesis is block 3,456,000, so the next election after block `h` is `3456000 + (floor((h − 3456000) / 43200) + 1) × 43200`.
- Validator balances can't change during an epoch. **Every stake change counts from the next election block.**

## 1. Stake: create staker, add stake

| Step | SDK call | Rule |
|---|---|---|
| First stake | `sendNewStakerTransaction({ delegation, value })` | At least 100 NIM. It goes straight to the active balance. |
| More stake | `sendStakeTransaction({ value })` | Added to active. The staker must already exist. |

**When it starts earning:** the stake counts from the next election block, then earns for one epoch. The validator gets that epoch's rewards on chain (each batch is paid at the end of the following batch), and the pool pays stakers off chain on its own schedule.

So the first kickback arrives at: next election (0 to 12 h away) + one epoch (12 h) + the pool's payout for that epoch. Direct pools pay right after each election block (Nimiq.Fun: 1 to 2 minutes after it, every epoch), so that's **about 12 to 26 h**.

### How Kickback computes it (`firstKickbackAt`)

Inputs, all from the real chain (also in dry run, where only the stake time is fake):

- `clock`: the latest election block `L` and its timestamp `T_L`, plus the measured epoch length `ε = T_L − T_(L−43200)` (two `getBlockByNumber` calls, cached for a month since they never change, plus `getBlockNumber`).
- `stakeAt`: when the stake was made. Real: the oldest stake transaction (to the staking contract) in the 30-day history, else the confirmed stake op. Dry run: the fake confirm time.
- The pool's last payout `P` and payout interval `I` (from a probe staker's history).

```
idx(t)    = (t − T_L) / ε                 epoch position relative to the latest election
e_earn    = ceil(idx(stakeAt)) + 1        election that closes the first epoch the stake earns in
p         = floor(idx(P))                 election just before the pool's last payout
offset    = P − (T_L + p·ε)               how long after an election the pool pays (Nimiq.Fun ≈ 2 min)
n         = max(1, round(I / ε))          pool pays every n epochs
e_pay     = p + ceil((e_earn − p) / n)·n  first pool payout election at or after e_earn
first     = T_L + e_pay·ε + offset
```

Without pool timing: `T_L + e_earn·ε + 1 h`.

### Worked example: stake now with Nimiq.Fun

Readings from rpc.nimiqwatch.com on 2026-10-21:

| | |
|---|---|
| Head block | 64,808,629 |
| Latest election `L` | 64,800,000 at 14:21:07.862 UTC (`T_L` = 1792592467862) |
| Election before it | 64,756,800 at 02:24:34.893 UTC |
| Epoch length `ε` | 42,992,969 ms (11.94 h) |
| Nimiq.Fun last payout `P` | 14:23:02.864 UTC, 1 min 55 s after the election; interval 11.95 h, so `n` = 1 |
| Stake time | 16:44:22 UTC |

1. Next election after the stake: `idx` = 0.20, so E1 = `T_L + 1·ε` = **02:17:41 UTC Oct 22** (block 64,843,200).
2. The stake earns through that epoch, which closes at E2 = `T_L + 2·ε` = **14:14:14 UTC Oct 22**.
3. Nimiq.Fun pays 1 min 55 s after E2: first kickback ≈ **14:16:09 UTC Oct 22, 21.5 h after staking**.

**The 34 h bug (fixed):** the old code projected the elections from the head block with exactly 1 s per block. That put E2 at 14:20:33, about 6 minutes after the real one, and so *after* Nimiq.Fun's 14:16 payout for that epoch. It skipped that payout and picked the next one (02:14 Oct 23), **33.5 h** after staking. The drift (3 to 6 min) is always bigger than Nimiq.Fun's 2 min offset, so the estimate was always one payout (12 h) too late. The countdown also started from "now" instead of the stake time. Both are covered by `tests/epoch.test.ts`.

## 2. Stop earning (deactivate)

`sendSetActiveStakeTransaction({ newActiveBalance: 0 })`

- Everything that was active becomes inactive.
- `inactiveFrom` is set to the **next election block** (`set_active_stake` sets `Some(Policy::election_block_after(block_number))`).
- The stake stops counting from that election.

## 3. When inactive stake is released

The code (`is_inactive_stake_released`) releases inactive stake once **both** of these hold:

1. `block ≥ Policy::block_after_collateral_lockup(inactiveFrom)`.
   The public RPC answers this as `getBlockAfterReportingWindow(inactiveFrom)`: `block_after_reporting_window` is a deprecated alias of the collateral-lockup function. `getBlockAfterCollateralLockup` itself is blocked on rpc.nimiqwatch.com.
   Measured: for `inactiveFrom = 54,043,200` it returns `54,086,401`, exactly one epoch + 1 block.
2. The validator is **not jailed**. A jail lasts 8 epochs (`JAIL_EPOCHS`, about 4 days, see `getBlockAfterJail`).

So after Stop earning, the stake is released at **next election + one epoch**, which is 12 to 24 h. The FAQ says 12 h to 4 days if the validator is jailed. Kickback shows the real countdown from these two RPC reads.

## 4. Undo (keep earning)

`sendSetActiveStakeTransaction({ newActiveBalance: active + inactive })`

- Inactive → active is allowed at any time, before or after release, **as long as it isn't retired yet**.
- It takes effect at the next election.
- Kickback shows "Undo: keep earning" while there's inactive stake (`canUndo`), and hides it once only retired stake is left.

## 5. Withdraw: retire, then remove (two transactions)

| Step | SDK call | Rule (staker.rs) |
|---|---|---|
| 1. Retire | `sendRetireStakeTransaction({ retireStake })` | Only **released** inactive stake. What stays active + inactive must be 0 or at least 100 NIM. |
| 2. Remove | `sendRemoveStakeTransaction({ value })` | Only retired stake; it's paid back to the wallet. The rest must stay 0 or at least 100 NIM. Kickback removes the whole retired balance. |

**Retire is required before remove.** Remove can only take from the retired balance, and only released stake can be retired.

If a staker already has retired stake, Withdraw is just step 2. Kickback waits for step 1 to be in a block before asking for step 2.

## 6. Switch pool (change delegation)

`sendUpdateStakerTransaction({ newDelegation, reactivateAllStake })`

From `update_staker`, if the staker currently has a delegation:
- It fails if **active > 0**: "All stake must be inactivated or retired before re-delegating".
- It fails if the inactive stake **isn't released** (still locked, or the validator is jailed).

With `reactivateAllStake: true`, the same transaction moves inactive stake back to active **with the new validator**, so no withdraw and re-stake is needed.

So a switch is: **Stop earning → wait for release (12 to 24 h) → one update transaction**. The new delegation counts from the next election.

**What Kickback does:**
- **Stake is active:** Switch pool opens a sheet: "To switch, stop earning with your current pool, then stake with the new one. It takes about Xh." It has a **Stop earning** button. There's no multi-day automation.
- **Stake is released and nothing is active:** picking another pool sends the real `sendUpdateStakerTransaction` with `reactivateAllStake: true`. The Pool tab then shows "Moving to … starts earning there at the next epoch".
- **Inactive but not released yet:** "Your NIM is released in about Xh. Then you can pick the new pool."

## Fees

- The SDK docs say "Nimiq Pay chooses a fee automatically, using 0 if possible", and the protocol allows zero-fee transactions.
- Staking transactions go to the priority "control" mempool.
- Kickback never sets a fee. It keeps a **fee reserve of 0.01 NIM (1,000 Luna)** out of "Max" and out of each plan run, in case a busy network needs one.
