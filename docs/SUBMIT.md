# Submitting Kickback (Cycle 3, Earn)

Deadline: **Wed Nov 11, 23:59 UTC** (the portal closes 2026-11-12 00:00 UTC). One submission per GitHub account per cycle.

Everything is prepared in `~/Projects/miniappscompetition-submissions`, local branch `submission-shrooms08`, folder
`cycle3/shrooms08/`: `submission.yaml`, `README.md`, `icon.png` (512×512), `thumbnail.png` (240×240) and
`screenshot-1..5.png`. Field lengths, image types, sizes and file names are already checked against the CI rules.
Two placeholders are left for you: the video link, and `submitted_at`.

The competition's own route is the **form at https://miniappscompetition.com/submit**: you sign in with GitHub, fill it
in, and its bot opens the pull request (branch `submission-shrooms08`, title `Submission: Kickback (@shrooms08)`).
Your Cycle 2 entry (PR #167, nimcade) went that way. Option C2 below opens the same PR by hand with `gh`, if you prefer.

## A. Make the repo public

CI checks the repo anonymously and needs GitHub to detect the MIT license (the `LICENSE` file is on main).

1. Check that nothing secret is in the history (the anon key is public by design; the service role key and session
   secret are not in the repo):
   ```bash
   cd ~/Projects/kickback
   git log -p --all | grep -nE "service_role|SESSION_SECRET=|sb_secret_|PRIVATE KEY" | head
   ```
   Expect no output.
2. Make it public:
   ```bash
   gh repo edit shrooms08/kickback --visibility public --accept-visibility-change-consequences
   ```
3. Check what CI will check:
   ```bash
   git ls-remote https://github.com/shrooms08/kickback HEAD          # works without login
   gh api repos/shrooms08/kickback/license --jq .license.spdx_id      # prints MIT
   curl -s -o /dev/null -w "%{http_code}\n" https://kickback-ecru.vercel.app   # 200
   ```

## B. Add the demo video link

1. Record the walkthrough on your phone inside Nimiq Pay (stake or open Home, the plan, Run my plan, Season, the share
   card). Upload it to YouTube (public or unlisted), Loom, Vimeo, or post it on X.
2. Put the link in both files (replace `https://youtu.be/REPLACE_WITH_DEMO_VIDEO`):
   ```bash
   cd ~/Projects/miniappscompetition-submissions
   VIDEO='https://youtu.be/XXXXXXXXXXX'
   sed -i '' "s#https://youtu.be/REPLACE_WITH_DEMO_VIDEO#$VIDEO#g" cycle3/shrooms08/submission.yaml cycle3/shrooms08/README.md
   grep -n "$VIDEO" cycle3/shrooms08/*
   ```
3. Optional, worth 5 points: a post in the Mini Apps Skool community (2) and a social post (3). Put their URLs in
   `skool_post_url` / `social_post_url` in `submission.yaml` (and the Links table in `README.md`).

## C. Open the submission PR

### C1. The form (recommended)

Open https://miniappscompetition.com/submit, sign in with GitHub, choose **Earn**, and copy the fields from
`cycle3/shrooms08/submission.yaml` (app name, tagline, description, pricing Free, repo, demo, video, email, X account,
builder story). Upload `icon.png`, `thumbnail.png` and the five screenshots from the same folder (the first screenshot is
the social preview). Submit: the bot opens the PR and comments with the check results.

### C2. By hand with gh

```bash
cd ~/Projects/miniappscompetition-submissions
git checkout submission-shrooms08
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
sed -i '' "s/^submitted_at: .*/submitted_at: $NOW/" cycle3/shrooms08/submission.yaml
sed -i '' "s/| Submitted at | .* |/| Submitted at | $NOW |/" cycle3/shrooms08/README.md
git add cycle3/shrooms08 && git commit -m "Submission: Kickback (@shrooms08)"
git fetch origin main && git rebase origin/main
gh repo fork nimiq/miniappscompetition-submissions --remote --remote-name fork
git push fork submission-shrooms08
gh pr create --repo nimiq/miniappscompetition-submissions --base main --head shrooms08:submission-shrooms08 \
  --title "Submission: Kickback (@shrooms08)" \
  --body "Competition submission by @shrooms08 (Cycle 3, Earn). App: Kickback. Repo: https://github.com/shrooms08/kickback. Demo: https://kickback-ecru.vercel.app"
```

## D. Check the automated checks

```bash
gh pr list --repo nimiq/miniappscompetition-submissions --author shrooms08          # find the PR number
gh pr checks <PR> --repo nimiq/miniappscompetition-submissions --watch
gh pr view <PR> --repo nimiq/miniappscompetition-submissions --comments            # the bot's ✅/❌ list
```

The 10 checks: files only under `cycle3/shrooms08/`, `submission.yaml` parses, fields valid, `github_login` matches the
folder, images (real PNG/JPG/WebP, ≤2 MB each, ≤14 MB total, 3 to 5 screenshots, no extra files), `README.md` present,
repo public, license MIT, demo returns 200, video link public (oEmbed).

## E. Update the PR later

Edit files in `cycle3/shrooms08/` (new screenshots, video, posts), then:

```bash
cd ~/Projects/miniappscompetition-submissions
git checkout submission-shrooms08
git add cycle3/shrooms08 && git commit -m "Update Kickback submission"
git push fork submission-shrooms08            # C2; the PR updates and the checks run again
gh pr checks <PR> --repo nimiq/miniappscompetition-submissions --watch
```

If the PR came from the form (C1), the branch lives in the nimiq repo: push to it only if the bot gave you access,
otherwise resubmit through the form or ask in the PR. The app itself updates whenever main is pushed (Vercel), no PR change
needed.
