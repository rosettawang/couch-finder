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
const favorites = require('./src/favorites');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_ADDRESS = process.env.DEFAULT_ADDRESS || '3051 Adeline Ave, Berkeley, CA';
const DEFAULT_RADIUS_MILES = parseFloat(process.env.DEFAULT_RADIUS_MILES || '50');

const VALID_CATEGORIES = ['couches', 'tables', 'chairs'];

// Pull the shared query shape out of a request once, so /api/search and
// /api/search/status interpret address/radius/dims/filters identically.
//
// `category` is one of the furniture presets (couches/tables/chairs) and drives
// the couch dimension filter. `q` is a free-text term for anything else
// (e.g. "scaffolding", "standing desk"). The effective search `term` is the
// free-text query if present, otherwise the preset. `term` is what gets sent to
// the scrapers and what segments the cache, so different searches never collide.
function parseQuery(req) {
  const category = VALID_CATEGORIES.includes(req.query.category) ? req.query.category : 'couches';
  const q = (req.query.q || '').trim();
  const isFreeText = q.length > 0;
  const term = isFreeText ? q : category;

  const priceType = ['all', 'for_sale', 'free'].includes(req.query.priceType)
    ? req.query.priceType
    : 'all';
  const address = req.query.address || DEFAULT_ADDRESS;
  const radiusMiles = parseFloat(req.query.radiusMiles) || DEFAULT_RADIUS_MILES;

  // Couch dimensions only apply to the couches preset, never to free-text.
  const dims = {};
  if (!isFreeText && category === 'couches') {
    ['minWidth', 'maxWidth', 'minDepth', 'maxDepth', 'minHeight', 'maxHeight'].forEach((key) => {
      if (req.query[key]) dims[key] = parseFloat(req.query[key]);
    });
  }
  return { category, q, isFreeText, term, priceType, address, radiusMiles, dims };
}

// Read whatever the cache holds for this query's tiles and shape it for the UI.
// Manual Nextdoor listings live in a separate JSON file (not the scrape cache),
// so they're merged in here; they carry no coordinates and are treated as
// "distance unknown" by the enrichment/radius filter, as before.
async function readCached({ term, isFreeText, priceType, address, radiusMiles, dims }) {
  const origin = await geocodeAddress(address);
  const tileIds = tilesInRadius(origin.lat, origin.lon, radiusMiles);
  // `term` is the effective search term (free-text or preset) and is what the
  // cache is keyed on, so scaffolding results never mix with couch results.
  const cached = getCachedListings({ category: term, tileIds });
  // Manual Nextdoor entries are furniture. Show ones whose category matches the
  // term; also show uncategorized ones for preset searches, but NOT for a
  // free-text search (a couch shouldn't appear under "used scaffolding").
  const manual = readManualListings().filter(
    (l) => l.category === term || (!l.category && !isFreeText)
  );
  const listings = enrichListings({
    listings: [...cached, ...manual],
    origin,
    category: term,
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
    // Staleness and refresh jobs are keyed on the effective term, not the
    // preset, so each distinct search term maintains its own cache freshness.
    const staleBySource = {};
    for (const source of SCRAPED_SOURCES) {
      const stale = staleTiles({ tileIds, source, category: q.term });
      if (stale.length) staleBySource[source] = stale;
    }

    const searchId = crypto.randomUUID();
    const jobIds = queue.enqueueSearch({
      searchId,
      category: q.term,
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

// --- Favorites ---
app.get('/api/favorites', (req, res) => {
  res.json({ listings: favorites.listFavorites() });
});

app.post('/api/favorites', (req, res) => {
  const listing = req.body && req.body.listing;
  if (!listing || !listing.id) {
    return res.status(400).json({ error: 'A listing with an id is required.' });
  }
  const saved = favorites.addFavorite(listing);
  res.status(201).json(saved);
});

app.delete('/api/favorites/:id', (req, res) => {
  const removed = favorites.removeFavorite(req.params.id);
  res.json({ removed });
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
