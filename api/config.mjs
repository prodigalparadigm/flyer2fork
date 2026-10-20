// Everything you are likely to want to change lives here.
export const CONFIG = {
  // --- model ---
  // Opus 5 is the default. Haiku 4.5 is roughly a fifth the price per token
  // and usually fine for reading prices off a tag; switch only if you want to.
  model: "claude-opus-5",
  maxTokens: 8000,

  // --- what a single request may contain (checked before any spend) ---
  maxImages: 6,
  maxBytesPerImage: 6 * 1024 * 1024,
  maxBytesTotal: 20 * 1024 * 1024,
  allowedMedia: ["image/jpeg", "image/png", "image/webp", "image/gif"],

  // --- per-caller token bucket ---
  perIpPerHour: 12,
  perIpBurst: 4,

  // --- flyer lookups cost no model tokens, so they get a roomier bucket ---
  flyerPerIpPerHour: 60,
  flyerPerIpBurst: 15,

  // --- the cap that actually bounds the bill ---
  // Do the arithmetic before raising this. A read of ~3 images costs roughly
  // $0.12 on Opus 5 and ~$0.025 on Haiku 4.5 (rough estimate at list prices).
  // At 300/day that is roughly $15-20 on a normal day and up to $35 if every
  // read is six images. Measured: 3.5c for a simple flyer, 6.6c for a dense
  // circular. Raised to 300 on 2026-10-20 ahead of a public post.
  globalReadsPerDay: 300,

  // --- where things live ---
  ssmKeyParam: process.env.SSM_KEY_PARAM || "/flyer-to-fork/anthropic-api-key",
  tableName: process.env.LIMITS_TABLE || "FlyerToForkLimits",
  // The page is served from GitHub Pages, so the API is cross-origin and needs
  // real CORS. Several origins are in play, and a wildcard is sloppy, so the
  // request's Origin is echoed back only when it is on this list.
  allowOrigins: (process.env.ALLOW_ORIGINS ||
    "https://prodigalparadigm.github.io,https://flyer2fork.com,https://www.flyer2fork.com,https://flyer2fork.org,https://www.flyer2fork.org"
  ).split(",").map((s) => s.trim()).filter(Boolean),
};
