/* Weekly circulars, already structured. No model call, so a lookup is free and
   fast, and there is no SSRF surface: this talks to one fixed host, never to a
   URL a caller supplied. */
const BASE = "https://backflipp.wishabi.com/flipp";
const UA = "Mozilla/5.0 (compatible; flyer2fork/1.0; +https://flyer2fork.com)";

async function jget(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: ctl.signal });
    if (!r.ok) throw new Error("upstream " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/* A chain often runs several flyers at once under the same "Groceries" tag:
   the weekly ad, a beauty insert, a coupon book. The name is the only thing
   that tells them apart, so rank on it and return them all rather than
   guessing one and silently handing back a flyer full of shampoo. */
const MAIN = /weekly|circular|current|^flyer$|grocery|food|fresh|savings? (event|guide)/i;
/* Careful here: a bare "home" or "health" would demote "A Taste of Home",
   which is a food flyer. Match the things that are actually not groceries. */
const NOT_FOOD = /beauty|pharmacy|wellness|cosmetic|drug ?store|baby care|diaper|\bpet\b|liquor|\bwine\b|\bbeer\b|spirits|apparel|clothing|garden|hardware|\bauto\b|tire|\btoys?\b|electronics|furniture/i;
function rank(name) {
  const n = String(name || "");
  if (NOT_FOOD.test(n)) return 2;
  if (MAIN.test(n)) return 0;
  return 1;
}

export async function stores(postal) {
  const d = await jget(`${BASE}/data?postal_code=${encodeURIComponent(postal)}&locale=en-us`);
  const now = Date.now();
  const out = [];
  const perMerchant = {};
  for (const f of d.flyers || []) {
    if (!/grocer/i.test(f.categories_csv || "")) continue;
    const to = Date.parse(f.valid_to || f.available_to || "");
    if (Number.isFinite(to) && to < now) continue;
    const m = clean(f.merchant) || "Store";
    perMerchant[m] = (perMerchant[m] || 0) + 1;
    out.push({
      id: String(f.id),
      merchant: m,
      name: clean(f.name) || "Flyer",
      rank: rank(f.name),
      likely_food: rank(f.name) < 2,
      valid_from: String(f.valid_from || "").slice(0, 10),
      valid_to: String(f.valid_to || f.available_to || "").slice(0, 10),
    });
  }
  /* at most three per chain, best first, so the list stays readable */
  const kept = {};
  return out
    .sort((a, b) => a.merchant.localeCompare(b.merchant) || a.rank - b.rank ||
                    b.valid_from.localeCompare(a.valid_from))
    .filter((f) => (kept[f.merchant] = (kept[f.merchant] || 0) + 1) <= 3);
}

/* Ad copy sits in the same item list as the groceries. */
const JUNK =
  /instagram|follow us|join our team|www\.|\.com\b|prices? effective|we reserve|visit us|see store|hiring|gift card|open \d|store hours|^\W*$/i;

/* The flyer endpoint drops the unit; the search index keeps it in
   post_price_text ("lb."). They join exactly on flyer_item_id, so for the
   categories American circulars price by weight we can recover the real rate
   instead of guessing that one pack feeds a week. */
const WEIGHED = ["chicken", "beef", "pork", "turkey", "sausage", "bacon", "fish",
  "salmon", "shrimp", "steak", "potato", "onion", "tomato", "apple", "pepper",
  "broccoli", "carrot", "grapes"];
const PER_LB = /\b(?:per\s*)?lbs?\b\.?/i;

async function unitsFor(flyerId, postal) {
  const map = new Map();
  const results = await Promise.allSettled(WEIGHED.map((q) =>
    jget(`${BASE}/items/search?q=${encodeURIComponent(q)}&postal_code=${encodeURIComponent(postal)}&locale=en-us`, 9000)));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const i of r.value.items || []) {
      if (i.flyer_id !== Number(flyerId)) continue;
      const unit = String(i.post_price_text || "");
      if (PER_LB.test(unit)) map.set(i.flyer_item_id, "1 lb");
    }
  }
  return map;
}

export async function flyer(id, postal) {
  const [d, units] = await Promise.all([
    jget(`${BASE}/flyers/${encodeURIComponent(id)}?locale=en-us`),
    postal ? unitsFor(id, postal).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);
  const out = [];
  const seen = new Set();
  for (const i of d.items || []) {
    const n = clean(i.name);
    const p = parseFloat(i.price);
    if (!n || n.length < 3 || JUNK.test(n) || !Number.isFinite(p) || p <= 0) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    /* a per-pound rate feeds the existing unit-price path, so the rest of the
       pipeline costs it correctly with no special casing */
    const per = units.get(i.id);
    out.push({
      name: n, price: p,
      size: per || "",        // "1 lb" parses; "per lb" does not, so packs can be counted
      unit_price: per ? p : null,
      unit_size: per || null,
    });
  }
  return out;
}

/* 5 digits is the US, A1A is Canada, and nothing else is covered. */
export function currencyFor(postal) {
  const p = clean(postal).toUpperCase();
  if (/^[A-Z]\d[A-Z]/.test(p)) return "C$";
  if (/^\d{5}$/.test(p)) return "$";
  return null;
}
export const looksCovered = (postal) => currencyFor(postal) !== null;
