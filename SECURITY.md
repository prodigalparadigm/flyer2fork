# Keeping the key safe and the bill small

Two different problems. They get confused constantly, so they are separated here.

## 1. Key theft: "can someone take my API key?"

**The only rule that matters: the key must never reach the browser.**

Anything the browser can read, a visitor can read. Not just via "view source" —
the Network tab shows every request, every header, every variable. There is no
such thing as an obfuscated, minified or base64-ed key that is safe in client
code. If the key is in the page, it is public, and someone will find it: people
run scanners against published sites looking for exactly this.

So the architecture is not a preference, it is the whole point:

    browser  ->  your Lambda  ->  Anthropic
             ^                ^
             |                └─ key lives here, server side, never leaves
             └─ sees only your own endpoint, never a key

### Where the key actually lives

Three options, worst to best:

| Where | Safe from the browser | Safe from someone with AWS read access | Rotatable without redeploy |
|---|---|---|---|
| Hardcoded in the Lambda source | yes | **no** (anyone who can read the function) | no |
| Lambda environment variable | yes | no (visible in the console) | no |
| **Secrets Manager / SSM SecureString** | yes | yes (IAM-gated, audited) | **yes** |

This project uses SSM Parameter Store as a `SecureString`. It is free at this
scale, encrypted at rest with KMS, gated by IAM, and the Lambda reads it once
per cold start and caches it in memory. Rotating the key is a one-line CLI
command with no code change.

### The rest of the key hygiene

- **Use a dedicated key for this app.** If it leaks you revoke one key, not
  everything you own.
- **Never log it.** Not the key, not the request headers, not the whole error
  object — SDK errors can carry request context. Log `error.status` and
  `error.message`, nothing more.
- **Scope the IAM role tightly.** The Lambda needs read on exactly one SSM
  parameter and write on exactly one DynamoDB table. Nothing else.
- **Set a spend limit on the Anthropic side too.** Everything below is your
  own code protecting you; an org-level cap is the backstop that works even
  if your code has a bug.

## 2. Abuse: "someone found my endpoint and is spending my money"

This is the real risk, and it is *not* solved by the key being hidden. Your
endpoint is public by necessity — it has to be, or the page could not call it.
Anyone can `curl` it all day.

### What does NOT protect you

- **CORS.** A browser refuses to let *another website's JavaScript* read your
  response. It does nothing against curl, Postman or a script. CORS is a
  browser courtesy, not a security control. Set it anyway, but never count it.
- **A secret header the page sends.** The page is public, so the header is public.
- **Obscurity.** Endpoints get found by scanners within days of going live.

### What does protect you

Four layers, cheapest first. Use all of them; each catches what the others miss.

1. **Validate before you spend.** Reject oversized or wrong-typed uploads
   *before* calling Claude. A request that never reaches the model costs
   nothing. Cap the image count, the bytes per image, and the total payload.

2. **Per-caller rate limit.** A token bucket keyed on a hash of the IP: a few
   reads per hour, small burst. Stops one person hammering it. Keyed on a
   *hash* so you are not storing visitor IP addresses.

3. **A global daily cap.** The one that actually bounds the bill. A counter
   that resets each day; past the ceiling the endpoint politely declines for
   everyone. A distributed attack defeats per-IP limits — this is what stops
   the invoice regardless.

4. **Reserved concurrency + a budget alarm.** Reserved concurrency caps how
   many Lambdas can run at once, so a burst cannot fan out. An AWS Budgets
   alert and an Anthropic spend cap tell you, and then stop you, if the other
   three fail.

### Picking the numbers

Both limits are in `lambda/config.mjs`. Set the daily cap to a number you
would be annoyed but not hurt to pay, then raise it once you see real use.
Start low. It is far easier to raise a cap after a friendly complaint than to
argue with a bill.
