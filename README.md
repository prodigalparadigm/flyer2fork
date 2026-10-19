# Flyer to Fork

Photograph wherever grocery prices live — a flyer, a delivery app's offers tab,
the shelf tags in the aisle, last week's receipt — and get a week of dinners
costed in that shop's own currency, with a pack-accurate shopping list and a
starter pantry.

Built for people cooking on a tight budget in a new city, in any country.

## How it works

The page is static. The only moving part is the reader: your image goes to a
small Lambda, which asks Claude to pull the priced items out of it and returns
them as structured data. Nothing is stored, and the images are not retained.

    page (GitHub Pages)  ->  API Gateway  ->  Lambda  ->  Claude
                                                 |
                                        SSM (the key, never in the page)
                                        DynamoDB (rate limits)

`api/` holds the reader exactly as deployed. `SECURITY.md` explains why the key
cannot live in the page, and why rate limits rather than CORS are what protect
a public endpoint.

## Three ways to get prices in

1. **Find my store** (US and Canada) - weekly circulars arrive already
   structured, so this costs nothing, needs no model call, and the prices are
   exactly as advertised.
2. **Photo or PDF** (anywhere) - photograph a flyer, an app's offers tab, the
   shelf tags, or a receipt. Claude reads the prices out of it.
3. **Type prices** (anywhere, no account, no network) - for when the camera is
   not worth it.

## Prices carry their provenance

Nothing silently blends an advertised price with a guess:

- **LIVE** — read off a shelf or a flyer
- **PHOTO** — Claude read it from your capture, so check it; edit one and it
  becomes yours
- **EST** — an estimate, either marked as such by the source or typed by you

## Two worked examples

The page opens on real data: a JioMart shelf run in Pune (20 live prices plus 7
market estimates) and a C Town circular from New York. Switch the Cooking
control or upload your own and the whole week changes, currency included.
