import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { CONFIG } from "./config.mjs";
import { takeToken, takeDailyBudget } from "./ratelimit.mjs";
import { stores, flyer, currencyFor, looksCovered } from "./flipp.mjs";

/* ---------- the key ----------
   Read once per cold start from SSM, held in module scope, never logged,
   never returned. Rotating the parameter takes effect on the next cold start. */
let keyPromise = null;
function apiKey() {
  if (!keyPromise) {
    const ssm = new SSMClient({});
    keyPromise = ssm
      .send(new GetParameterCommand({ Name: CONFIG.ssmKeyParam, WithDecryption: true }))
      .then((r) => r.Parameter.Value)
      .catch((e) => { keyPromise = null; throw e; });   // don't cache a failure
  }
  return keyPromise;
}

/* ---------- what we want back ----------
   A schema beats asking nicely for JSON: the reply cannot come back malformed. */
const Item = z.object({
  name: z.string(),
  price: z.number(),
  size: z.string(),
  unit_price: z.number().nullable(),
  unit_size: z.string().nullable(),
});
const Reading = z.object({
  currency: z.string(),
  place: z.string(),
  language: z.string(),
  items: z.array(Item),
});

const PROMPT = [
  "These images show where grocery prices live. They may be any of:",
  "  (a) a printed weekly circular or a store's weekly-ad page;",
  "  (b) a grocery or delivery app's offers or listing screen;",
  "  (c) SHELF PRICE TAGS photographed in the aisle;",
  "  (d) a till RECEIPT from a recent shop.",
  "",
  "Extract the items a COOK would buy, with their prices.",
  "",
  "A full supermarket circular carries hundreds of offers and most are useless",
  "for planning meals. Include ingredients someone cooks with: fresh produce,",
  "meat and fish, dairy and eggs, grains, pulses, pasta, rice, flour, tinned",
  "and frozen vegetables, oils and staples.",
  "Skip household goods, cleaning, pet food, health and beauty, alcohol, soft",
  "drinks, confectionery, crisps and snacks, ready meals, gift cards and any",
  "offer that is not an ingredient.",
  "Return at most 40 items. If the page holds more, keep the ones most useful",
  "for cooking a week of meals and leave the rest out.",
  "",
  "currency: the symbol or code actually VISIBLE in the images. Empty string if none is shown.",
  "  Do not infer it from the language or the products.",
  "place: the country, city or shop name if the images show one. Empty string if nothing identifies a place.",
  "language: the main language of the text, named in English. Empty string if unclear.",
  "name: the product as printed, brand included, with no price text in it.",
  "price: what ONE of the item costs, as a plain number. Where a struck-through",
  "  price and a lower offer price are both shown, take the LOWER one.",
  "  MULTI-BUY offers are common and must not be lost. When an offer reads",
  "  \"3 for $5\", \"2/$4\", \"6 for $5\" or similar, you MUST copy that whole phrase",
  "  into the size field, exactly as printed, and put the number shown as price.",
  "  Example: an offer reading \"2 for $4\" becomes price 4 and size \"2 for $4\".",
  "  Never leave size empty on a multi-buy offer. The division is done after you.",
  "  PERCENTAGE OFFERS: an offer showing only \"30% OFF\" with no money amount has",
  "  no price. Leave the item out rather than giving it a price of 0.",
  "size: the pack size exactly as printed, such as \"1 kg\". Empty string if none is shown.",
  "unit_price / unit_size: ONLY when the image prints a price per unit, as shelf",
  "  tags often do (\"$0.12/oz\"). Then unit_price is 0.12 and unit_size is \"1 oz\".",
  "  Both null when no unit price is printed. Never calculate one yourself.",
  "",
  "On a RECEIPT the prices are what was paid. Skip tax lines, subtotals, totals,",
  "change, loyalty and discount rows, and anything that is not food.",
  "On SHELF TAGS: one object per tag.",
  "",
  "Skip non-food items, delivery and membership banners, and anything whose price",
  "you cannot read with confidence. Never invent a price, a pack size or a unit",
  "price. Leave the item out instead.",
].join("\n");

/* Echo the caller's Origin when it is one of ours. Reminder, because it is the
   single most misunderstood thing here: this stops other WEBSITES using the
   endpoint from a browser. It does nothing against curl. The limits do that. */
function corsFor(event) {
  const h = event?.headers || {};
  const origin = h.origin || h.Origin || "";
  const ok = CONFIG.allowOrigins.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin : CONFIG.allowOrigins[0],
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "3600",
    vary: "Origin",
  };
}
const json = (status, body, extra = {}, event = null) => ({
  statusCode: status,
  headers: { "content-type": "application/json", ...corsFor(event), ...extra },
  body: JSON.stringify(body),
});

export async function handler(event) {
  const started = Date.now();
  /* One line per request so tomorrow is evidence rather than guesswork.
     Counts, sizes and timings only: no prices, no product names, no image
     data, no addresses. Nothing here identifies a person or their shopping. */
  const note = (what, extra = {}) =>
    console.log("STAT " + JSON.stringify({ what, ms: Date.now() - started, ...extra }));
  const J = (st, b, ex = {}) => json(st, b, ex, event);
  const method = event?.requestContext?.http?.method ?? "POST";
  const path = event?.rawPath || event?.requestContext?.http?.path || "";
  if (method === "OPTIONS") return J(204, {});

  /* ---- free endpoints: weekly circulars, already structured ----
     No model call, so these never touch the daily spend cap. They still get a
     bucket, because an open proxy is rude even when it is cheap. */
  if (path.endsWith("/stores") || path.endsWith("/flyer")) {
    if (method !== "GET") return J(405, { error: "method_not_allowed" });
    const ip = event?.requestContext?.http?.sourceIp || "unknown";
    try {
      const b = await takeToken(ip, {
        prefix: "flyer",
        perHour: CONFIG.flyerPerIpPerHour,
        burst: CONFIG.flyerPerIpBurst,
      });
      if (!b.ok) {
        note("flyer_rate_limited");
        return J(429, { error: "rate_limited", message: "Slow down a moment." },
          { "retry-after": String(b.retryAfter) });
      }
    } catch (e) {
      console.error("limiter_unavailable", e?.name);
      return J(503, { error: "unavailable", message: "Temporarily unavailable." });
    }

    const q = event?.queryStringParameters || {};
    try {
      if (path.endsWith("/stores")) {
        const postal = String(q.postal || "").trim();
        if (!postal) return J(400, { error: "no_postal", message: "Give a postal code." });
        if (!looksCovered(postal))
          return J(422, {
            error: "not_covered",
            message: "Weekly flyers are indexed for the US and Canada only. Upload or type your prices instead.",
          });
        const list = await stores(postal);
        return J(200, { postal, currency: currencyFor(postal), stores: list });
      }
      const id = String(q.id || "").trim();
      if (!/^\d{1,12}$/.test(id)) return J(400, { error: "bad_id", message: "Bad flyer id." });
      const items = await flyer(id);
      if (!items.length)
        return J(422, {
          error: "unreadable_flyer",
          message: "That flyer has no machine-readable prices this week. Try another store.",
        });
      return J(200, {
        currency: String(q.currency || "$"),
        place: String(q.place || ""),
        language: "English",
        src: "live",
        items,
      });
    } catch (e) {
      console.error("flyer_failed", e?.name, String(e?.message || "").slice(0, 60));
      return J(502, { error: "upstream", message: "The flyer service did not answer. Try again shortly." });
    }
  }

  if (method !== "POST") return J(405, { error: "method_not_allowed" });

  // ---- 1. validate before spending anything ----
  let payload;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    payload = JSON.parse(raw || "{}");
  } catch {
    return J(400, { error: "bad_json", message: "Body must be JSON." });
  }

  const images = Array.isArray(payload.images) ? payload.images : [];
  if (!images.length) return J(400, { error: "no_images", message: "Send at least one image." });
  if (images.length > CONFIG.maxImages)
    return J(400, { error: "too_many_images", message: `At most ${CONFIG.maxImages} images per read.` });

  let total = 0;
  const blocks = [];
  for (const img of images) {
    const media = String(img?.media_type || "");
    const data = String(img?.data || "");
    if (!CONFIG.allowedMedia.includes(media))
      return J(400, { error: "bad_media_type", message: `Unsupported image type ${media}.` });
    const bytes = Math.floor((data.length * 3) / 4);
    if (bytes > CONFIG.maxBytesPerImage)
      return J(413, { error: "image_too_large", message: "One of those images is too large." });
    total += bytes;
    if (total > CONFIG.maxBytesTotal)
      return J(413, { error: "payload_too_large", message: "Those images are too large together." });
    blocks.push({ type: "image", source: { type: "base64", media_type: media, data } });
  }

  // ---- 2. per-caller limit, then the daily ceiling ----
  const ip = event?.requestContext?.http?.sourceIp || "unknown";
  try {
    const bucket = await takeToken(ip);
    if (!bucket.ok)
      {
        note("read_rate_limited");
        return J(429, {
          error: "rate_limited",
          message: "That is a lot of reads in a short time. Try again shortly.",
        }, { "retry-after": String(bucket.retryAfter) });
      }

    const budget = await takeDailyBudget();
    if (!budget.ok) {
      note("daily_cap_hit", { used: budget.used, cap: budget.cap });
      return J(503, {
        error: "daily_cap",
        message: "This has hit its reading limit for today. Type your prices instead, or try tomorrow.",
      });
    }
  } catch (e) {
    // A limiter that is down must not become an open door.
    console.error("limiter_unavailable", e.name);
    return J(503, { error: "unavailable", message: "Temporarily unavailable. Try again shortly." });
  }

  // ---- 3. read ----
  let key;
  try {
    key = await apiKey();
  } catch (e) {
    // A missing or unreadable key is a deployment problem, not an upstream one.
    console.error("key_unavailable", e?.name);
    return J(500, {
      error: "no_key",
      message: "The reader has no API key configured yet.",
    });
  }

  try {
    /* A key scoped to one workspace needs no header. A key that is not scoped
       to one requires anthropic-workspace-id on every request, so support both
       rather than forcing a particular choice at key-creation time. */
    const ws = process.env.ANTHROPIC_WORKSPACE_ID;
    const client = new Anthropic({
      apiKey: key,
      ...(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {}),
    });
    const res = await client.messages.parse({
      model: CONFIG.model,
      max_tokens: CONFIG.maxTokens,
      messages: [{ role: "user", content: [...blocks, { type: "text", text: PROMPT }] }],
      /* Reading prices off an image is perception, not reasoning, and the
         gateway gives us 30 seconds: a dense circular at the default effort
         took 48s and the timeout threw the answer away. Haiku 4.5 rejects
         `effort` outright, so only send it to models that take it. */
      output_config: {
        format: zodOutputFormat(Reading),
        ...(/haiku/i.test(CONFIG.model) ? {} : { effort: "low" }),
      },
    });

    /* Division is arithmetic, and arithmetic belongs in code. Both models read
       "2 for $4" correctly and then disagreed about what to do with it, so the
       model now reports the offer verbatim and this converts it. */
    const MULTI = /(\d+)\s*(?:for|\/)\s*\$?\s*([\d.]+)/i;
    if (res.parsed_output?.items) {
      for (const it of res.parsed_output.items) {
        const m = MULTI.exec(String(it.size || "")) || MULTI.exec(String(it.name || ""));
        if (!m) continue;
        const n = parseInt(m[1], 10), total = parseFloat(m[2]);
        if (!(n > 1) || !(total > 0)) continue;
        const per = total / n;
        // only rewrite when the model handed back the undivided total
        if (Math.abs(it.price - total) < 0.01) it.price = Math.round(per * 100) / 100;
      }
    }

    if (res.stop_reason === "refusal")
      return J(422, { error: "refused", message: "That image could not be read. Try a different one." });
    if (!res.parsed_output)
      return J(502, { error: "unparsed", message: "The reply came back unreadable. Try a tighter crop." });

    const out = res.parsed_output;
    note("read_ok", {
      images: blocks.length,
      kb: Math.round(total / 1024),
      items: out.items?.length ?? 0,
      sized: out.items?.filter((i) => i.size).length ?? 0,
      multibuy: out.items?.filter((i) => MULTI.test(String(i.size || ""))).length ?? 0,
      unit_priced: out.items?.filter((i) => i.unit_price).length ?? 0,
      got_place: Boolean(out.place),
      got_currency: Boolean(out.currency),
      in_tok: res.usage?.input_tokens,
      out_tok: res.usage?.output_tokens,
    });
    return J(200, {
      ...res.parsed_output,
      usage: { input: res.usage?.input_tokens, output: res.usage?.output_tokens },
    });
  } catch (e) {
    // Log the shape of the failure, never the key and never the whole error.
    console.error("read_failed", e?.name, e?.status ?? "");
    note("read_failed", { kind: e?.name, status: e?.status ?? null });
    if (e instanceof Anthropic.RateLimitError)
      return J(429, { error: "upstream_rate_limited", message: "Busy right now. Try again shortly." });
    if (e instanceof Anthropic.AuthenticationError)
      return J(500, { error: "misconfigured", message: "The reader is misconfigured." });
    if (e instanceof Anthropic.BadRequestError)
      return J(400, { error: "bad_request", message: "Those images could not be sent." });
    return J(502, { error: "upstream", message: "The reader failed. Try again shortly." });
  }
}
