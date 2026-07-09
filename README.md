# Couch Finder

A local furniture search app for couches, tables, and chairs — aggregating Facebook Marketplace, Craigslist, OfferUp, and Nextdoor listings within a radius of an address, with free/for-sale filtering and couch dimension matching.

Default search origin: **3051 Adeline Ave, Berkeley, CA**, 50-mile radius (both configurable in the UI or `.env`).

## Why this isn't a simple "plug in an API" app

None of these four sites offer a public, read-access API for listings:

- **Facebook Marketplace** — Meta's Content Library API does technically have a `facebook/marketplace-listings/preview` endpoint, but it's restricted to vetted academic researchers or registered non-profit/public-interest organizations (for-profit and personal-project use is explicitly excluded), requires a signed Restricted Data Use Agreement, and queries run inside a Meta-hosted sandboxed research environment rather than a normal callable API. It isn't available for a personal shopping app.
- **Craigslist** — no public read API; its terms of service explicitly prohibit scraping, and Craigslist has sued scrapers before (the 3Taps case ended in a $1M settlement).
- **OfferUp** — no public API.
- **Nextdoor** — no public API; "For Sale & Free" listings sit behind an authenticated, geo-verified neighborhood session, which most scraping services won't touch.

Given that, this app is built around **Apify** (a scraping-as-a-service platform with an actual API), which lets you run community-maintained "actors" that scrape a given site and hands you results as structured data. This still runs up against the ToS of the underlying sites — treat it as something to use carefully and personally, not to productize or run at scale. Nextdoor has no workable actor, so it's handled differently (see below).

## What's included

- **Backend** (`server.js` + `src/`): Express API that geocodes your address (via free OpenStreetMap Nominatim), calls out to Apify actors per source, filters by radius (haversine distance) and free/for-sale, and for couches, parses dimensions out of listing text and matches them against a target range.
- **Frontend** (`public/`): single-page UI — category picker, All/For Sale/Free tabs, radius + address controls, couch dimension inputs, a results grid with source badges and distance, and a way to manually add Nextdoor listings.
- **Demo mode**: with no Apify token configured, every source (except Nextdoor) returns realistic mock listings so the whole app is usable immediately.

## Setup

```bash
cd couch-finder-app
npm install
cp .env.example .env
npm start
```

Then open `http://localhost:3000`.

Out of the box (no `.env` values filled in) it runs entirely on demo data — good for trying the UI and dimension-matching logic before wiring up anything live.

## Going live with real listings

1. Sign up at [apify.com](https://apify.com) and grab an API token (Settings → Integrations). Put it in `.env` as `APIFY_TOKEN`.
2. `.env` already ships with an actor picked for each source (checked on the Apify Store in July 2026):

   | Source | Actor | Pricing | Notes |
   |---|---|---|---|
   | Facebook Marketplace | `apify/facebook-marketplace-scraper` | $2.60 / 1,000 listings | Official Apify actor, actively maintained, 8.3K users, 3.4★ (28 reviews) |
   | Craigslist | `ivanvs/craigslist-scraper-pay-per-result` | $8.00 / 1,000 results | Verified developer, no monthly base fee, 5.0★ (1 review, so limited signal) |
   | OfferUp | `igolaizola/offerup-scraper` | $1.40 / 1,000 results | Small actor (60 users) but does exactly query + zip code, 5.0★ (1 review) |

   Actor availability changes over time — if any of these disappear or get worse reviews, search the [Apify Store](https://apify.com/store) for a replacement and update the corresponding `APIFY_ACTOR_*` value.
3. Two of these actors don't take a free-text address/radius the way the rest of the app does, so a few extra `.env` values matter:
   - `CRAIGSLIST_REGION` (default `sfbay`) — Craigslist scopes search to a regional subdomain, not lat/lon.
   - `FACEBOOK_MARKETPLACE_CITY_SLUG` (blank by default) — Facebook Marketplace scopes search to a city slug baked into the URL. Browse facebook.com/marketplace yourself, pick your location, and copy the slug from the URL (e.g. `facebook.com/marketplace/oakland/...` → `oakland`). Left blank on purpose: guessing wrong would silently return the wrong city's listings, so Facebook stays on demo data until you set this.
   - `OFFERUP_ZIP_CODE` (blank by default) — OfferUp's actor wants a zip code; leave blank and the app derives one automatically from `DEFAULT_ADDRESS` via reverse geocoding, or set one explicitly to skip that lookup.
4. The adapters in `src/adapters/` map each actor's real output fields (confirmed from the Apify Store's documented examples for Craigslist and OfferUp; Facebook Marketplace's exact field names are only loosely documented, so that mapping is a best-effort guess — run one search in the Apify Console and adjust `facebookMarketplace.js`'s `mapItem` if needed).
5. Restart the server. The banner at the top of the results panel tells you which sources are live vs. still on demo data.

## Nextdoor

There's no scraper worth trusting for Nextdoor market listings, so instead of an adapter, there's an "**+ Add Nextdoor listing**" button in the UI: paste in the title, price, URL, and description/dimensions from a listing you found manually, and it gets stored (`data/manualListings.json`) and shown alongside the scraped results, with dimension parsing applied the same way.

## Couch dimension matching

Since none of these sites expose structured dimension fields, the app extracts width/depth/height from listing titles and descriptions using pattern matching (things like `84x36x32`, `84"W x 36"D x 32"H`, or `W: 84 D: 36 H: 32`). If a listing doesn't mention dimensions in a recognizable format, it's shown with a "dims not listed" badge rather than being excluded — you'll still want to eyeball those.

## Limitations to keep in mind

- Scraping Facebook Marketplace, Craigslist, and OfferUp through Apify (or any third party) runs against those sites' terms of service. This is intended for light, personal use — not a commercial product.
- Dimension parsing is regex-based and best-effort; it won't catch every phrasing.
- Distance filtering needs a `lat`/`lon` per listing. Craigslist's actor provides this; OfferUp's doesn't (only a location string), and manually-added Nextdoor entries don't either — those are always included regardless of radius (tagged "distance unknown").
- Apify actors cost money per run/result once you're past their free tier — check pricing on the actor's Store page before running large searches.
