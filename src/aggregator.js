const { geocodeAddress } = require('./geocode');
const { haversineMiles } = require('./distance');
const { parseDimensionsFromText, matchesDimensions } = require('./dimensions');

const facebookMarketplace = require('./adapters/facebookMarketplace');
const craigslist = require('./adapters/craigslist');
const offerup = require('./adapters/offerup');
const nextdoor = require('./adapters/nextdoor');

// Keyed by the `source` string each adapter stamps onto its listings, so the
// queue worker can fetch one source at a time by name.
const ADAPTERS = {
  facebook_marketplace: facebookMarketplace,
  craigslist,
  offerup,
  nextdoor: nextdoor,
};

// Source names the background queue refreshes by scraping. Nextdoor is manual
// (user-entered), so it's read straight from the cache and never enqueued.
const SCRAPED_SOURCES = ['facebook_marketplace', 'craigslist', 'offerup'];

// Fetch listings from a single source. Used by the queue worker; failures
// propagate so the worker can record them on the job.
async function fetchSource(source, { category, address, radiusMiles }) {
  const adapter = ADAPTERS[source];
  if (!adapter) throw new Error(`Unknown source: ${source}`);
  return adapter.search({ category, address, radiusMiles });
}

function buildDimensionTarget({ minWidth, maxWidth, minDepth, maxDepth, minHeight, maxHeight }) {
  const target = {};
  if (minWidth || maxWidth) target.width = { min: minWidth, max: maxWidth };
  if (minDepth || maxDepth) target.depth = { min: minDepth, max: maxDepth };
  if (minHeight || maxHeight) target.height = { min: minHeight, max: maxHeight };
  return target;
}

// Turn raw/cached listings into the shape the frontend renders: distance from
// the search origin, parsed dimensions, dimension-match verdict, and the
// radius/price/dimension filters applied. Origin comes from geocoding the
// search address. This is applied at read time to whatever the cache holds.
function enrichListings({ listings, origin, category, dims = {}, radiusMiles, priceType = 'all' }) {
  const dimTarget = category === 'couches' ? buildDimensionTarget(dims) : {};

  const enriched = listings
    .map((listing) => {
      const distanceMiles = haversineMiles(origin.lat, origin.lon, listing.lat, listing.lon);
      const parsedDims =
        listing._dims || parseDimensionsFromText(`${listing.title} ${listing.description}`);
      const dimMatch = category === 'couches' ? matchesDimensions(parsedDims, dimTarget) : 'match';
      return { ...listing, distanceMiles, dimensions: parsedDims, dimensionMatch: dimMatch };
    })
    // Keep listings with unknown distance (e.g. manual Nextdoor entries)
    // rather than silently dropping them; only exclude ones we know are
    // outside the radius.
    .filter((l) => l.distanceMiles === null || l.distanceMiles <= radiusMiles)
    .filter((l) => priceType === 'all' || l.priceType === priceType)
    .filter((l) => Object.keys(dimTarget).length === 0 || l.dimensionMatch !== 'no_match');

  enriched.sort((a, b) => {
    const da = a.distanceMiles ?? Infinity;
    const db = b.distanceMiles ?? Infinity;
    return da - db;
  });

  return enriched;
}

module.exports = {
  ADAPTERS,
  SCRAPED_SOURCES,
  fetchSource,
  enrichListings,
  buildDimensionTarget,
  geocodeAddress,
};
