require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const {
  SCRAPED_SOURCES,
  enrichListings,
  geocodeAddress,
} = require('./src/aggregator');
const { tilesInRadius } = require('./src/tiles');
const { getCachedListings, staleTiles } = require('./src/cache');
const queue = require('./src/queue');
const { addManualListing, readManualListings } = require('./src/adapters/nextdoor');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_ADDRESS = process.env.DEFAULT_ADDRESS || '3051 Adeline Ave, Berkeley, CA';
const DEFAULT_RADIUS_MILES = parseFloat(process.env.DEFAULT_RADIUS_MILES || '50');

const VALID_CATEGORIES = ['couches', 'tables', 'chairs'];

// Pull the shared query shape out of a request once, so /api/search and
// /api/search/status interpret address/radius/dims/filters identically.
function parseQuery(req) {
  const category = VALID_CATEGORIES.includes(req.query.category) ? req.query.category : 'couches';
  const priceType = ['all', 'for_sale', 'free'].includes(req.query.priceType)
    ? req.query.priceType
    : 'all';
  const address = req.query.address || DEFAULT_ADDRESS;
  const radiusMiles = parseFloat(req.query.radiusMiles) || DEFAULT_RADIUS_MILES;

  const dims = {};
  ['minWidth', 'maxWidth', 'minDepth', 'maxDepth', 'minHeight', 'maxHeight'].forEach((key) => {
    if (req.query[key]) dims[key] = parseFloat(req.query[key]);
  });
  return { category, priceType, address, radiusMiles, dims };
}

// Read whatever the cache holds for this query's tiles and shape it for the UI.
// Manual Nextdoor listings live in a separate JSON file (not the scrape cache),
// so they're merged in here; they carry no coordinates and are treated as
// "distance unknown" by the enrichment/radius filter, as before.
async function readCached({ category, priceType, address, radiusMiles, dims }) {
  const origin = await geocodeAddress(address);
  const tileIds = tilesInRadius(origin.lat, origin.lon, radiusMiles);
  const cached = getCachedListings({ category, tileIds });
  const manual = readManualListings().filter((l) => !l.category || l.category === category);
  const listings = enrichListings({
    listings: [...cached, ...manual],
    origin,
    category,
    dims,
    radiusMiles,
    priceType,
  });
  return { origin, tileIds, listings };
}

// Kick off a search: return cached results immediately and enqueue background
// refresh jobs for any stale/missing tiles. The client then polls
// /api/search/status with the returned searchId to get the ETA and, once jobs
// finish, the freshly scraped listings merged in.
app.get('/api/search', async (req, res) => {
  try {
    const q = parseQuery(req);
    const { origin, tileIds, listings } = await readCached(q);

    // Figure out which (source, tiles) pairs are stale and need a refresh.
    const staleBySource = {};
    for (const source of SCRAPED_SOURCES) {
      const stale = staleTiles({ tileIds, source, category: q.category });
      if (stale.length) staleBySource[source] = stale;
    }

    const searchId = crypto.randomUUID();
    const jobIds = queue.enqueueSearch({
      searchId,
      category: q.category,
      address: q.address,
      radiusMiles: q.radiusMiles,
      staleBySource,
    });

    res.json({
      searchId,
      query: q,
      origin,
      tileCount: tileIds.length,
      count: listings.length,
      listings,
      refreshing: jobIds.length > 0,
      status: queue.getSearchStatus(searchId),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Poll endpoint: current job status for a search plus the latest cached
// listings for the same query (so newly scraped items appear as jobs finish).
app.get('/api/search/status', async (req, res) => {
  try {
    const searchId = req.query.searchId;
    if (!searchId) return res.status(400).json({ error: 'searchId is required' });
    const q = parseQuery(req);
    const { listings } = await readCached(q);
    res.json({
      searchId,
      status: queue.getSearchStatus(searchId),
      count: listings.length,
      listings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/manual-listings', (req, res) => {
  res.json(readManualListings());
});

app.post('/api/manual-listings', (req, res) => {
  const { title, price, priceType, url, city, text, category } = req.body || {};
  if (!title && !text) {
    return res.status(400).json({ error: 'Provide at least a title or pasted text.' });
  }
  const entry = addManualListing({ title, price, priceType, url, city, text });
  if (category) entry.category = category;
  res.status(201).json(entry);
});

app.get('/api/config', (req, res) => {
  res.json({
    defaultAddress: DEFAULT_ADDRESS,
    defaultRadiusMiles: DEFAULT_RADIUS_MILES,
    categories: VALID_CATEGORIES,
    sourcesUsingLiveData: {
      facebook_marketplace: Boolean(process.env.APIFY_ACTOR_FACEBOOK && process.env.APIFY_TOKEN),
      craigslist: Boolean(process.env.APIFY_ACTOR_CRAIGSLIST && process.env.APIFY_TOKEN),
      offerup: Boolean(process.env.APIFY_ACTOR_OFFERUP && process.env.APIFY_TOKEN),
      nextdoor_manual: true,
    },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  queue.start(); // begin draining the background refresh queue
  console.log(`Couch Finder running at http://localhost:${PORT}`);
});
