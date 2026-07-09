const { geocodeAddress } = require('./geocode');
const { haversineMiles } = require('./distance');
const { parseDimensionsFromText, matchesDimensions } = require('./dimensions');

const facebookMarketplace = require('./adapters/facebookMarketplace');
const craigslist = require('./adapters/craigslist');
const offerup = require('./adapters/offerup');
const nextdoor = require('./adapters/nextdoor');

const ADAPTERS = [facebookMarketplace, craigslist, offerup, nextdoor];

// Runs every source adapter in parallel; one source failing (e.g. bad actor
// ID, Apify quota, network hiccup) doesn't take down the whole search.
async function collectListings({ category, address, radiusMiles }) {
  const settled = await Promise.allSettled(
    ADAPTERS.map((adapter) => adapter.search({ category, address, radiusMiles }))
  );

  const listings = [];
  const errors = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      listings.push(...result.value);
    } else {
      errors.push({ source: ADAPTERS[i].name || `adapter_${i}`, error: result.reason?.message });
    }
  });
  return { listings, errors };
}

function buildDimensionTarget({ minWidth, maxWidth, minDepth, maxDepth, minHeight, maxHeight }) {
  const target = {};
  if (minWidth || maxWidth) target.width = { min: minWidth, max: maxWidth };
  if (minDepth || maxDepth) target.depth = { min: minDepth, max: maxDepth };
  if (minHeight || maxHeight) target.height = { min: minHeight, max: maxHeight };
  return target;
}

async function search(params) {
  const {
    category, // 'couches' | 'tables' | 'chairs'
    priceType = 'all', // 'all' | 'for_sale' | 'free'
    address,
    radiusMiles,
    dims = {}, // only meaningful for category === 'couches'
  } = params;

  const origin = await geocodeAddress(address);
  const { listings, errors } = await collectListings({ category, address, radiusMiles });

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

  return { origin, listings: enriched, errors };
}

module.exports = { search };
