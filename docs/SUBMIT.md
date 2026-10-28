# Submitting Kickback (Cycle 3, Earn)

Deadline: **Wed Nov 11, 23:59 UTC** (the portal closes 2026-11-12 00:00 UTC). **One submission per GitHub account per
cycle**, and the form can't be sent twice, so check every field before you press Submit.

Everything you paste or upload is in `~/Projects/miniappscompetition-submissions`, local branch `submission-shrooms08`,
folder `cycle3/shrooms08/`. The only thing missing is the **demo video link**.

## Status (2026-10-28)

| Step | State |
|---|---|
| Backend deployed (rpc-proxy, pool-stats-cron, migrations, sync, season, stats, xp-cron) | Done, checked on production |
| Secret scan of the full git history (gitleaks, trufflehog, manual) | Clean |
| Repo public, MIT license detected | License detected. The repo goes public with step 1 |
| Demo video | **You** (step 2) |
| Submit | **You** (step 3, or step 5 as a backup) |

## 1. Make the repo public

CI checks the repo without logging in, and GitHub must detect the MIT license. It already detects MIT.

```bash
gh repo edit shrooms08/kickback --visibility public --accept-visibility-change-consequences
git ls-remote https://github.com/shrooms08/kickback HEAD                 # works without login
curl -s https://api.github.com/repos/shrooms08/kickback/license | grep spdx_id   # "spdx_id": "MIT"
curl -s -o /dev/null -w "%{http_code}\n" https://kickback-ecru.vercel.app        # 200
```

## 2. Record and upload the demo video

1. Record the walkthrough on your phone inside Nimiq Pay: Home with your stake, the plan, Run my plan, Season (tier,
   quests, streak), and the share card. One to three minutes is plenty.
2. Upload it as **public or unlisted** on YouTube, Loom or Vimeo, or post it on X. CI checks the link through the
   platform's oEmbed API, so private or unlisted-with-password videos fail. Test it while logged out:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "https://www.youtube.com/oembed?url=YOUR_VIDEO_LINK&format=json"   # 200
   ```
3. Optional, worth 5 points: post about Kickback in the Mini Apps Skool community (2 pts) and on any social platform
   (3 pts). Keep both links for the form.

## 3. Submit through the official form (recommended)

1. Open https://miniappscompetition.com/submit and click **Continue with GitHub**, then sign in as `shrooms08`.
2. Fill in the fields below. The form keeps a draft of the text fields in your browser, so you can stop and come back.
   Images are not kept in the draft: add them last.
3. Press **Submit entry**. The site's bot opens the pull request in `nimiq/miniappscompetition-submissions` and
   comments with the check results (step 4).

### Every field and what to paste

**About your app**

| Field | Required | Limit | Paste or choose |
|---|---|---|---|
| App name | yes | 80 | `Kickback` |
| Category | yes | Pay, Save, Earn, On/Off-Ramp, Off-theme | **Earn** |
| Tagline | yes | 120 | `Stake once. Get your kickback twice a day, and share it with your plan.` |
| Short description | yes | 280 | the text below |
| Pricing | yes | Free, Freemium, Paid | **Free** |

Short description:

```
Stake NIM once with a direct-payout pool and get a kickback about every 12 hours. Kickback splits each one with your plan, send part to family, restake part, keep the rest, all approved in Nimiq Pay. Your stake is never touched.
```

**Links & demo**

| Field | Required | Paste |
|---|---|---|
| Repo URL | yes | `https://github.com/shrooms08/kickback` |
| Demo URL | yes | `https://kickback-ecru.vercel.app` |
| Video walkthrough | yes | **your video link from step 2** |

**Media** (files in `~/Projects/miniappscompetition-submissions/cycle3/shrooms08/`)

| Field | Required | Rule | Upload |
|---|---|---|---|
| App icon / favicon | yes | PNG, JPG or WebP, 512×512 | `icon.png` (512×512) |
| Thumbnail | yes | PNG, JPG, WebP or GIF, 240×240 | `thumbnail.png` (240×240) |
| Screenshots | yes | 3 to 5, PNG, JPG or WebP; the first is the social preview | `screenshot-1.png` to `screenshot-5.png`, **in that order** (780×1688 each, under 2 MB) |

In Finder, press Cmd+Shift+G in the file picker and paste `~/Projects/miniappscompetition-submissions/cycle3/shrooms08`.

**About you**

| Field | Required | Limit | Paste |
|---|---|---|---|
| GitHub username | filled in from your login | | shows `shrooms08`; nothing to do |
| E-mail address | yes | | `rukevwe.eminokanju08@gmail.com` |
| Team name | optional | 80 | leave empty (solo) |
| Team members | optional | 5 | leave empty |
| X account | optional | 80 | `@shroomsgotsol` |
| Builder story | optional | 4,000 | the text below (855 characters) |

Builder story:

```
I'm a solo developer from Benin City, Nigeria. Staking pays you, but most of us never see it: rewards pile up quietly inside the stake. Kickback uses direct-payout pools so every reward lands in your wallet about twice a day, then turns it into a habit you can feel: a plan that sends part to family, restakes part and keeps the rest, one approval per step in Nimiq Pay. It reads the chain for real payout timing, shows the Nimiq staking calculator rate after the pool fee, and never touches your stake. Season 1 adds a kickback streak, milestones, Stack skins, XP tiers and weekly quests, all counted on the server from on-chain data and cosmetic only. It never depends on one RPC node: reads fail over to backup endpoints and fall back to cached data when the network is slow. Built with Vue, Supabase and the Nimiq Mini App SDK, on mainnet and testnet.
```

**Promotion & discovery** (all optional)

| Field | Paste |
|---|---|
| 2 pts – Post about your mini app in the Mini Apps Skool community | your Skool post link, or leave empty |
| 3 pts – Post about your mini app on any social media platform | your X (or other) post link, or leave empty |
| How did you hear about the competition? (200) | `X` |

If you use the form, **do not also open a PR by hand** (step 5): that would be a second submission.

## 4. Check the automated checks

```bash
gh pr list --repo nimiq/miniappscompetition-submissions --author shrooms08 --state all    # find the PR number
gh pr checks <PR> --repo nimiq/miniappscompetition-submissions --watch
gh pr view <PR> --repo nimiq/miniappscompetition-submissions --comments                   # the bot's ✅/❌ list
```

The 10 checks: files only under `cycle3/shrooms08/`, `submission.yaml` parses, fields valid, `github_login` matches the
folder, images (real PNG/JPG/WebP, ≤2 MB each, ≤14 MB total, 3 to 5 screenshots, no extra files), `README.md` present,
repo public, license MIT, demo returns 200, video link public (oEmbed).

## 5. Backup: open the PR by hand with gh

Use this only if the form is down or fails. Same files, same checks.

```bash
cd ~/Projects/miniappscompetition-submissions
git checkout submission-shrooms08

# 1. The video link (the only placeholder left)
VIDEO='https://youtu.be/XXXXXXXXXXX'
sed -i '' "s#https://youtu.be/REPLACE_WITH_DEMO_VIDEO#$VIDEO#g" cycle3/shrooms08/submission.yaml cycle3/shrooms08/README.md
grep -n "$VIDEO" cycle3/shrooms08/submission.yaml cycle3/shrooms08/README.md

# 2. Optional promotion links: set skool_post_url / social_post_url in submission.yaml
#    (and the Links table in README.md), e.g. skool_post_url: https://www.skool.com/...

# 3. Submission time
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
sed -i '' "s/^submitted_at: .*/submitted_at: $NOW/" cycle3/shrooms08/submission.yaml
sed -i '' "s/| Submitted at | .* |/| Submitted at | $NOW |/" cycle3/shrooms08/README.md

# 4. Commit, rebase on the latest main, push to your fork, open the PR
git add cycle3/shrooms08 && git commit -m "Submission: Kickback (@shrooms08)"
git fetch origin main && git rebase origin/main
gh repo fork nimiq/miniappscompetition-submissions --remote --remote-name fork
git push fork submission-shrooms08
gh pr create --repo nimiq/miniappscompetition-submissions --base main --head shrooms08:submission-shrooms08 \
  --title "Submission: Kickback (@shrooms08)" \
  --body "Competition submission by @shrooms08 (Cycle 3, Earn). App: Kickback. Repo: https://github.com/shrooms08/kickback. Demo: https://kickback-ecru.vercel.app"
```

Then step 4.

## 6. Change the submission later

The app itself updates on every push to main (Vercel); the PR doesn't need to change for that.

- **Form route:** the PR branch lives in the nimiq repo. Push to it only if the bot gave you access; otherwise ask in
  the PR.
- **gh route:** edit `cycle3/shrooms08/`, then
  ```bash
  cd ~/Projects/miniappscompetition-submissions && git checkout submission-shrooms08
  git add cycle3/shrooms08 && git commit -m "Update Kickback submission"
  git push fork submission-shrooms08
  gh pr checks <PR> --repo nimiq/miniappscompetition-submissions --watch
  ```
