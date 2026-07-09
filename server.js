require('dotenv').config();
const express = require('express');
const path = require('path');

const aggregator = require('./src/aggregator');
const { addManualListing, readManualListings } = require('./src/adapters/nextdoor');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_ADDRESS = process.env.DEFAULT_ADDRESS || '3051 Adeline Ave, Berkeley, CA';
const DEFAULT_RADIUS_MILES = parseFloat(process.env.DEFAULT_RADIUS_MILES || '50');

const VALID_CATEGORIES = ['couches', 'tables', 'chairs'];

app.get('/api/search', async (req, res) => {
  try {
    const category = VALID_CATEGORIES.includes(req.query.category)
      ? req.query.category
      : 'couches';
    const priceType = ['all', 'for_sale', 'free'].includes(req.query.priceType)
      ? req.query.priceType
      : 'all';
    const address = req.query.address || DEFAULT_ADDRESS;
    const radiusMiles = parseFloat(req.query.radiusMiles) || DEFAULT_RADIUS_MILES;

    const dims = {};
    ['minWidth', 'maxWidth', 'minDepth', 'maxDepth', 'minHeight', 'maxHeight'].forEach((key) => {
      if (req.query[key]) dims[key] = parseFloat(req.query[key]);
    });

    const result = await aggregator.search({ category, priceType, address, radiusMiles, dims });
    res.json({
      query: { category, priceType, address, radiusMiles, dims },
      origin: result.origin,
      count: result.listings.length,
      listings: result.listings,
      sourceErrors: result.errors,
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
  console.log(`Couch Finder running at http://localhost:${PORT}`);
});
