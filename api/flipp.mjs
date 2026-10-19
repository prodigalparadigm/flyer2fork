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

/* Grocery flyers running right now near a postal code, one per merchant. */
export async function stores(postal) {
  const d = await jget(`${BASE}/data?postal_code=${encodeURIComponent(postal)}&locale=en-us`);
  const now = Date.now();
  const best = {};
  for (const f of d.flyers || []) {
    if (!/grocer/i.test(f.categories_csv || "")) continue;
    const to = Date.parse(f.valid_to || f.available_to || "");
    if (Number.isFinite(to) && to < now) continue;
    const m = clean(f.merchant) || "Store";
    const cur = best[m];
    if (!cur || Date.parse(f.valid_from || "") > Date.parse(cur.valid_from || "")) best[m] = f;
  }
  return Object.values(best)
    .map((f) => ({
      id: String(f.id),
      merchant: clean(f.merchant),
      valid_from: String(f.valid_from || "").slice(0, 10),
      valid_to: String(f.valid_to || f.available_to || "").slice(0, 10),
    }))
    .sort((a, b) => a.merchant.localeCompare(b.merchant));
}

/* Ad copy sits in the same item list as the groceries. */
const JUNK =
  /instagram|follow us|join our team|www\.|\.com\b|prices? effective|we reserve|visit us|see store|hiring|gift card|open \d|store hours|^\W*$/i;

export async function flyer(id) {
  const d = await jget(`${BASE}/flyers/${encodeURIComponent(id)}?locale=en-us`);
  const out = [];
  const seen = new Set();
  for (const i of d.items || []) {
    const n = clean(i.name);
    const p = parseFloat(i.price);
    if (!n || n.length < 3 || JUNK.test(n) || !Number.isFinite(p) || p <= 0) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: n, price: p, size: "", unit_price: null, unit_size: null });
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
