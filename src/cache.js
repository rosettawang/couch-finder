// Read/write helpers over the SQLite cache. Everything that touches the
// `listings` and `tile_fetch` tables lives here so the queue worker and the
// search endpoint share one consistent view of what's cached and what's stale.

const { db } = require('./db');
const { tileIdFor } = require('./tiles');

// node:sqlite's DatabaseSync has no better-sqlite3-style db.transaction()
// helper, so wrap a batch of writes in an explicit transaction ourselves.
function inTransaction(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// How long a (tile, source, category) fetch stays "fresh" before a search will
// re-enqueue it. Marketplace listings churn over hours, not minutes, so a few
// hours keeps results current without re-scraping on every visit.
const DEFAULT_TTL_MS = parseInt(process.env.CACHE_TTL_MS || `${6 * 60 * 60 * 1000}`, 10);

function now() {
  return Date.now();
}

// node:sqlite only binds null, number, bigint, string, and Buffer. Scraper
// output isn't always clean (e.g. an actor returning an array/object for an
// image field), so coerce to safe types before binding.
function toText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Arrays/objects (e.g. a list of image URLs): take the first primitive or
  // JSON-encode as a fallback so nothing is silently lost.
  if (Array.isArray(v)) return v.length ? toText(v[0]) : null;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// Build a "(?, ?, ...)" fragment for an IN clause of the given length.
function placeholders(n) {
  return Array.from({ length: n }, () => '?').join(', ');
}

// Insert or replace listings, tagging each with the tile that contains it.
// Called by the queue worker after a source scrape completes.
function upsertListings(listings, category) {
  if (!listings || !listings.length) return 0;
  const ts = now();
  const stmt = db.prepare(`
    INSERT INTO listings
      (id, source, category, title, price, priceType, description, city,
       lat, lon, url, imageUrl, postedAt, dimensions, tile_id, fetched_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, price=excluded.price, priceType=excluded.priceType,
      description=excluded.description, city=excluded.city,
      lat=excluded.lat, lon=excluded.lon, url=excluded.url,
      imageUrl=excluded.imageUrl, postedAt=excluded.postedAt,
      dimensions=excluded.dimensions, tile_id=excluded.tile_id,
      fetched_at=excluded.fetched_at
  `);

  inTransaction(() => {
    for (const l of listings) {
      const lat = toNum(l.lat);
      const lon = toNum(l.lon);
      stmt.run(
        String(l.id),
        toText(l.source),
        category,
        toText(l.title),
        toNum(l.price),
        toText(l.priceType),
        toText(l.description),
        toText(l.city),
        lat,
        lon,
        toText(l.url),
        toText(l.imageUrl),
        toText(l.postedAt),
        l._dims ? JSON.stringify(l._dims) : null,
        tileIdFor(lat, lon),
        ts
      );
    }
  });
  return listings.length;
}

// All cached listings for a category whose tile is in the given set. Manual
// Nextdoor entries often have no coordinates (tile_id NULL); include those too
// so they aren't silently dropped, matching the original aggregator behavior.
function getCachedListings({ category, tileIds }) {
  if (!tileIds || !tileIds.length) return [];
  const rows = db
    .prepare(
      `SELECT * FROM listings
       WHERE category = ?
         AND (tile_id IN (${placeholders(tileIds.length)}) OR tile_id IS NULL)`
    )
    .all(category, ...tileIds);

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    title: r.title,
    price: r.price,
    priceType: r.priceType,
    description: r.description,
    city: r.city,
    lat: r.lat,
    lon: r.lon,
    url: r.url,
    imageUrl: r.imageUrl,
    postedAt: r.postedAt,
    _dims: r.dimensions ? JSON.parse(r.dimensions) : undefined,
    fetchedAt: r.fetched_at,
  }));
}

// Of the given tiles, which are stale (or never fetched) for this source?
function staleTiles({ tileIds, source, category, ttlMs = DEFAULT_TTL_MS }) {
  if (!tileIds || !tileIds.length) return [];
  const cutoff = now() - ttlMs;
  const fresh = new Set(
    db
      .prepare(
        `SELECT tile_id FROM tile_fetch
         WHERE source = ? AND category = ? AND last_fetched >= ?
           AND tile_id IN (${placeholders(tileIds.length)})`
      )
      .all(source, category, cutoff, ...tileIds)
      .map((r) => r.tile_id)
  );
  return tileIds.filter((t) => !fresh.has(t));
}

// Mark tiles fresh for a source after a successful scrape.
function markTilesFresh({ tileIds, source, category }) {
  if (!tileIds || !tileIds.length) return;
  const ts = now();
  const stmt = db.prepare(
    `INSERT INTO tile_fetch (tile_id, source, category, last_fetched)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tile_id, source, category)
       DO UPDATE SET last_fetched = excluded.last_fetched`
  );
  inTransaction(() => {
    for (const id of tileIds) stmt.run(id, source, category, ts);
  });
}

module.exports = {
  DEFAULT_TTL_MS,
  upsertListings,
  getCachedListings,
  staleTiles,
  markTilesFresh,
};
