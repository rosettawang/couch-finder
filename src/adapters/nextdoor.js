const fs = require('fs');
const path = require('path');
const { parseDimensionsFromText } = require('../dimensions');

const SOURCE = 'nextdoor_manual';
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'manualListings.json');

// Nextdoor has no public API and no viable scraping actor: its "For Sale &
// Free" listings sit behind an authenticated session tied to a verified
// neighborhood, which most scraping services won't touch (higher account-ban
// risk, and it's explicitly against Nextdoor's terms). Practically, the only
// reliable way to get a Nextdoor listing into this app is for you to paste
// its text/link in yourself via the "Add Nextdoor listing" button in the UI.
// This adapter just reads back whatever you've pasted in.

function readManualListings() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeManualListings(listings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(listings, null, 2));
}

function addManualListing({ title, price, priceType, url, city, text }) {
  const listings = readManualListings();
  const dims = parseDimensionsFromText(`${title || ''} ${text || ''}`);
  const entry = {
    id: `nextdoor-manual-${Date.now()}`,
    source: SOURCE,
    title: title || (text || '').slice(0, 80) || 'Untitled Nextdoor listing',
    price: price ?? 0,
    priceType: priceType || (price ? 'for_sale' : 'free'),
    description: text || '',
    city: city || null,
    lat: null,
    lon: null,
    url: url || null,
    imageUrl: null,
    postedAt: new Date().toISOString(),
    category: null, // set by caller if known
    _dims: dims,
  };
  listings.push(entry);
  writeManualListings(listings);
  return entry;
}

async function search({ category }) {
  const listings = readManualListings();
  // Manual listings aren't tagged with lat/lon (no geocoding attempted for
  // hand-entered addresses), so radius filtering treats them as "distance
  // unknown" and includes them; category filtering is best-effort text match.
  return listings.filter(
    (l) => !category || !l.category || l.category === category
  );
}

module.exports = { search, addManualListing, readManualListings };
