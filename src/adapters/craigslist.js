const { runApifyActor } = require('../apifyRunner');
const { mockSearch } = require('../mockData');

const SOURCE = 'craigslist';

// Verified against ivanvs/craigslist-scraper-pay-per-result on the Apify
// Store (README "Data Output Example" + input schema), July 2026. If you
// swap in a different Craigslist actor, its input/output shape will likely
// differ -- re-check both before trusting this mapping.
//
// Input: { urls: [{ url }], maxAge, maxConcurrency, proxyConfiguration }
// where each url is a real craigslist.org search page, e.g.
// https://sfbay.craigslist.org/search/sss?query=couch
//
// Output per item: { id, url, title, datetime, location, category, label,
// price ("$350"-style string), longitude, latitude, mapAccuracy, post,
// notices, phoneNumbers }

const CATEGORY_QUERY = { couches: 'couch', tables: 'table', chairs: 'chair' };

// "sss" = all "for sale" listings. Craigslist also has narrower codes (e.g.
// "fua" for furniture) but they're less consistently applied by posters, so
// "sss" + a keyword query is the more reliable combination.
const FOR_SALE_CATEGORY_CODE = 'sss';

function buildSearchUrl({ region, query }) {
  return `https://${region}.craigslist.org/search/${FOR_SALE_CATEGORY_CODE}?query=${encodeURIComponent(
    query
  )}`;
}

function parsePrice(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  const num = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isNaN(num) ? 0 : num;
}

async function search({ category }) {
  const actorId = process.env.APIFY_ACTOR_CRAIGSLIST;
  // Craigslist scopes search to a regional subdomain rather than a lat/lon
  // radius. "sfbay" covers the Berkeley/Oakland/SF area; change this if
  // you're searching from elsewhere (find your region's subdomain by
  // browsing craigslist.org and picking your city).
  const region = process.env.CRAIGSLIST_REGION || 'sfbay';
  const query = CATEGORY_QUERY[category] || category;

  const result = await runApifyActor({
    actorId,
    input: {
      maxConcurrency: 1,
      proxyConfiguration: { useApifyProxy: true },
      urls: [{ url: buildSearchUrl({ region, query }) }],
    },
    mapItem: (item) => ({
      id: item.id || item.url,
      source: SOURCE,
      title: item.title,
      price: parsePrice(item.price),
      priceType: parsePrice(item.price) === 0 || /free/i.test(item.title || '') ? 'free' : 'for_sale',
      description: item.post || '',
      city: item.location || null,
      lat: item.latitude ? parseFloat(item.latitude) : null,
      lon: item.longitude ? parseFloat(item.longitude) : null,
      url: item.url,
      imageUrl: null, // this actor doesn't return image URLs
      postedAt: item.datetime || null,
    }),
  });

  if (result) return result;
  return mockSearch(SOURCE, category); // no APIFY_ACTOR_CRAIGSLIST configured -> demo data
}

module.exports = { search };
