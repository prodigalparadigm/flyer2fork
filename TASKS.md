# Flyer to Fork, open tasks
Verified against live infrastructure, 19 Oct 2026.

## Working right now
- flyer2fork.com serves (GitHub Pages, custom domain, HTTPS)
- Find my store: live, free, no key
- Type prices: live, no key, no network
- 75 recipes / 73 ingredients, all 192 diet x kit x cuisine combinations fill a week
- Rate limits and validation verified live

## State, 22 Oct

Live and in use. Two addresses:

- https://flyer2fork.com
- https://prodigalparadigm.github.io/flyer2fork-mirror (for networks that block
  newly registered domains; the main domain was registered 19 Oct and ages out
  of those lists in a few weeks, after which the mirror can go)

**Both repos must be pushed on every change** or the mirror silently goes stale.

Reader runs on Haiku 4.5, about $0.007 a read, 10 to 16 seconds. Cap 300/day.
`./infra/morning.sh 12h` reports traffic, latency, failures and spend.

## Known weak spots, in the order the public will probably find them

- [ ] **Most flyer items still have no pack size**, so their cost assumes one
      pack covers the week. Per-pound rates are now recovered where the search
      index has them, which fixed meat and some produce, but that was only 8 of
      227 items on Dierbergs. The page says so per recipe and under the total.
- [ ] **Multi-buy depends on the model reporting the offer wording.** The
      division is reliable; Haiku mentioning there is one is not.
- [ ] **A whole circular in one shot reads badly.** One page close up went 68%
      to 93% against prices checked by hand.
- [ ] **Untested in the wild:** shelf tags in a shop, Canadian postcodes, six
      images at once, the currency picker in a non-rupee run.

## Yours, blocking## Yours, blocking## Yours, blocking

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
