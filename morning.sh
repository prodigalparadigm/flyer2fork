#!/usr/bin/env bash
# What the public did to it overnight. Run it with coffee.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
SINCE="${1:-12h}"
echo "=== last $SINCE ==="
aws logs tail /aws/lambda/flyer-to-fork-reader --region "$REGION" --since "$SINCE" --format short 2>/dev/null \
  | grep -o 'STAT {.*}' | sed 's/^STAT //' > /tmp/stats.json || true
python3 - <<'PY'
import json,collections,statistics
rows=[]
for line in open('/tmp/stats.json'):
    try: rows.append(json.loads(line))
    except Exception: pass
if not rows:
    print("  no reads yet"); raise SystemExit
by=collections.Counter(r["what"] for r in rows)
print("  requests:", dict(by))
ok=[r for r in rows if r["what"]=="read_ok"]
if ok:
    ms=[r["ms"] for r in ok]; items=[r.get("items",0) for r in ok]
    cost=sum(r.get("in_tok",0)/1e6 + r.get("out_tok",0)*5/1e6 for r in ok)
    print(f"  successful reads: {len(ok)}")
    print(f"    time    median {statistics.median(ms)/1000:.1f}s   slowest {max(ms)/1000:.1f}s   over 25s: {sum(m>25000 for m in ms)}")
    print(f"    items   median {statistics.median(items):.0f}   empty reads: {sum(i==0 for i in items)}")
    print(f"    quality got_place {sum(r.get('got_place') for r in ok)}/{len(ok)}   "
          f"got_currency {sum(r.get('got_currency') for r in ok)}/{len(ok)}")
    print(f"    multi-buy rows reported: {sum(r.get('multibuy',0) for r in ok)}  "
          f"(the known-flaky bit)")
    print(f"    spend on reads: ${cost:.2f}")
fails=[r for r in rows if r["what"]=="read_failed"]
if fails:
    print("  failures:", collections.Counter((r.get("kind"),r.get("status")) for r in fails))
caps=[r for r in rows if r["what"]=="daily_cap_hit"]
if caps: print(f"  HIT THE DAILY CAP {len(caps)} times (cap {caps[0].get('cap')})")
PY
echo
echo "=== total traffic, including paths that log nothing ==="
aws cloudwatch get-metric-statistics --namespace AWS/ApiGateway --metric-name Count \
  --dimensions Name=ApiId,Value=9gjyrqxeve \
  --start-time "$(date -u -v-${SINCE%h}H +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d "-${SINCE}" +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" --period 86400 --statistics Sum \
  --region "$REGION" --query 'Datapoints[0].Sum' --output text 2>/dev/null | sed 's/^/  API requests: /'

echo
echo "=== cap usage today ==="
aws dynamodb get-item --table-name FlyerToForkLimits --region "$REGION" \
  --key "{\"pk\":{\"S\":\"global#$(date -u +%F)\"}}" --query 'Item.reads.N' --output text 2>/dev/null \
  | sed 's/^/  reads: /'
echo "=== distinct callers (hashed, never addresses) ==="
aws dynamodb scan --table-name FlyerToForkLimits --region "$REGION" \
  --query 'Items[].pk.S' --output text 2>/dev/null | tr '\t' '\n' | sed 's/#.*//' | sort | uniq -c | sed 's/^/  /'
