# Flyer to Fork, open tasks
Verified against live infrastructure, 19 Oct 2026.

## Working right now
- flyer2fork.com serves (GitHub Pages, custom domain, HTTPS)
- Find my store: live, free, no key
- Type prices: live, no key, no network
- 75 recipes / 73 ingredients, all 192 diet x kit x cuisine combinations fill a week
- Rate limits and validation verified live

## Tonight: the public is the test

The link is out. `infra/morning.sh` prints what happened: how many reads, how
slow, how many items, how often the known-flaky multi-buy reporting fired, what
failed and what it cost. Counts and timings only, never prices, product names,
images or addresses.

    ./infra/morning.sh 12h

## Known weak spots, in the order the public will probably find them

- [ ] **Multi-buy is inconsistent.** The division is reliable; Haiku reporting
      that there IS a division is not. It wrote "2/\$4" into size on one run and
      nothing on the next. When it reports, code divides and the page scored
      15/16 against prices read by hand off a photograph. When it does not, a
      "2 for \$4" item prices as \$4 and that line reads high. Visible rather
      than silent: PHOTO badge, editable price.
- [ ] **A whole circular in one shot reads badly.** Each tile lands about ten
      pixels tall and prices attach to the wrong products. One page close up
      went 68% to 93%. The page says so now; watch whether people read it.
- [ ] **Untested in the wild:** shelf tags photographed in a shop, Canadian
      postcodes, six images at once, the currency picker in a non-rupee run.

## Yours, blocking## Yours, blocking

- [ ] **API key into SSM.** Confirmed absent (`ParameterNotFound`), so Upload
      prices returns `no_key`. This is the only thing standing between Siddhant
      and a test.
      `aws ssm put-parameter --name /flyer-to-fork/anthropic-api-key \`
      `  --type SecureString --value 'sk-ant-...' --region us-east-1`
- [ ] **flyer2fork.org.** Still resolving to Squarespace (198.185.159.x).
      Decide: 301 forward to the .com, or leave parked for the nonprofit day.

## Yours, protective

- [ ] **AWS budget alarm.** `infra/budget-alarm.sh` was written but never run.
      Nothing currently warns you if spend climbs.
- [ ] **Anthropic-side spend cap.** The backstop that works even if my code has
      a bug. Account setting, not something I can do.

## Cleanup, costing money today

- [ ] **CloudFront `E2FQ603Y0I7XOI`** - Deployed and Enabled, now redundant
      since the page moved to GitHub Pages. Disable, wait, delete.
- [ ] **S3 `flyer2fork-site-882597580767`** - redundant, holds an old copy.
- [ ] **ACM certificate** - `PENDING_VALIDATION` and pointless now that GitHub
      issues its own. Delete rather than validate.
- [ ] **The claude.ai artifact** - still public, superseded by the site, and it
      is the one version that does not work signed out. Retire or delete.

## Mine, build

- [ ] **Generated extras.** The half of "fixed core plus generated extras" that
      is not built: a "suggest something else for Thursday" call against the
      current basket. Needs the key, needs rationing from the shared cap, and
      needs the generated provenance visible the way PHOTO is. ~$0.02 a call.
- [ ] **Flyer URL / PDF URL ingestion.** Scoped and deferred. The real work is
      the SSRF guard: https only, reject private and link-local ranges,
      re-check after every redirect, cap size and redirects, enforce
      content-type. Wants adversarial testing, not assumption.
- [ ] **Costco-class matching.** 66 prices matched only 8 ingredients, because
      warehouse names are branded bulk ("Kirkland Signature..."). Big Y matches
      31 of 240 and leaves nothing unpriced, so the gap is specific.

## Watch, not yet actionable

- [ ] **The 30-second ceiling.** API Gateway's maximum, and Opus with adaptive
      thinking over several images can exceed it. Unmeasurable until the key is
      in. If it bites: drop effort to low, switch to Haiku 4.5, or make the read
      asynchronous with polling.
- [ ] **Siddhant's pilot.** His half is the photo path, so it is gated on the
      key. His three answers still set the plan: cooker, app, pincode.
