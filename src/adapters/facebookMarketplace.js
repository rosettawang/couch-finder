const { runApifyActor } = require('../apifyRunner');
const { mockSearch } = require('../mockData');

const SOURCE = 'facebook_marketplace';

// Verified against apify/facebook-marketplace-scraper on the Apify Store
// (official Apify actor, README + input schema), July 2026. This actor does
// NOT take a free-text location/radius -- it takes ready-made Facebook
// Marketplace URLs (input field: startUrls). You build that URL by:
//   1. Browsing facebook.com/marketplace yourself, picking your location and
//      a category or search query
//   2. Copying the resulting URL
// Facebook Marketplace city slugs (e.g. "oakland", "sfbay") don't map
// cleanly onto arbitrary addresses/radii, so rather than guess one, this
// adapter uses whatever you set in FACEBOOK_MARKETPLACE_CITY_SLUG.
//
// Output fields are documented only loosely on the Store page (icons: title,
// url, min/max price, sale price, location, photo, status, delivery type) --
// the exact JSON keys below are a best-effort guess. Run one search in the
// Apify Console first and adjust mapItem if the real keys differ.

const CATEGORY_QUERY = { couches: 'couch', tables: 'table', chairs: 'chair' };

function buildSearchUrl({ citySlug, query }) {
  return `https://www.facebook.com/marketplace/${citySlug}/search/?query=${encodeURIComponent(query)}`;
}

function parsePrice(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  const num = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isNaN(num) ? 0 : num;
}

async function search({ category }) {
  const actorId = process.env.APIFY_ACTOR_FACEBOOK;
  // No default here on purpose -- Marketplace city slugs are specific
  // (e.g. "oakland", "sfbay", "berkeley" may or may not exist as a slug) and
  // guessing wrong silently returns empty/wrong-city results. Set this in
  // .env after checking facebook.com/marketplace yourself.
  const citySlug = process.env.FACEBOOK_MARKETPLACE_CITY_SLUG;
  const query = CATEGORY_QUERY[category] || category;

  const result = citySlug
    ? await runApifyActor({
        actorId,
        input: {
          startUrls: [{ url: buildSearchUrl({ citySlug, query }) }],
        },
        mapItem: (item) => {
          const price = item.price ?? item.salePrice ?? item.minPrice;
          return {
            id: item.id || item.listingUrl || item.url,
            source: SOURCE,
            title: item.title || item.listingTitle,
            price: parsePrice(price),
            priceType: parsePrice(price) === 0 || /free/i.test(item.title || '') ? 'free' : 'for_sale',
            description: item.description || '',
            city: item.location || item.locationText || null,
            lat: item.latitude ?? null,
            lon: item.longitude ?? null,
            url: item.url || item.listingUrl,
            imageUrl: item.photo || item.imageUrl || (item.images && item.images[0]) || null,
            postedAt: item.postedAt || null,
          };
        },
      })
    : null;

  if (result) return result;
  return mockSearch(SOURCE, category); // no actor/city slug configured -> demo data
}

module.exports = { search };
