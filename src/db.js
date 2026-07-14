// SQLite persistence for the search cache, using Node's built-in
// `node:sqlite` (no native dependency to compile). Holds three things:
//
//   listings    - normalized listings keyed by source id, each tagged with the
//                 tile it falls in and when it was fetched.
//   tile_fetch  - per (tile, source, category) freshness bookkeeping, so a
//                 search can tell which tiles need a refresh scrape.
//   fetch_jobs  - the background refresh queue itself; completed jobs keep
//                 their duration so we can estimate ETAs for future searches.

const path = require('path');
const fs = require('fs');

// node:sqlite is stable enough for our use but emits an ExperimentalWarning on
// load. Filter just that one line so it doesn't spam the server log on boot.
const originalEmit = process.emit;
process.emit = function (name, data, ...rest) {
  if (
    name === 'warning' &&
    data &&
    data.name === 'ExperimentalWarning' &&
    /SQLite/i.test(data.message)
  ) {
    return false;
  }
  return originalEmit.call(this, name, data, ...rest);
};

const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.CACHE_DB_PATH || path.join(DATA_DIR, 'cache.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS listings (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    category    TEXT NOT NULL,
    title       TEXT,
    price       REAL,
    priceType   TEXT,
    description TEXT,
    city        TEXT,
    lat         REAL,
    lon         REAL,
    url         TEXT,
    imageUrl    TEXT,
    postedAt    TEXT,
    dimensions  TEXT,          -- JSON string or NULL
    tile_id     TEXT,
    fetched_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_listings_tile ON listings(tile_id, category);

  CREATE TABLE IF NOT EXISTS tile_fetch (
    tile_id      TEXT NOT NULL,
    source       TEXT NOT NULL,
    category     TEXT NOT NULL,
    last_fetched INTEGER NOT NULL,
    PRIMARY KEY (tile_id, source, category)
  );

  CREATE TABLE IF NOT EXISTS fetch_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id    TEXT,
    source       TEXT NOT NULL,
    category     TEXT NOT NULL,
    address      TEXT,
    radius_miles REAL,
    tile_ids     TEXT,          -- JSON array of tile ids this job refreshes
    status       TEXT NOT NULL, -- pending | running | done | error
    enqueued_at  INTEGER,
    started_at   INTEGER,
    finished_at  INTEGER,
    duration_ms  INTEGER,
    result_count INTEGER,
    error        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON fetch_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_search ON fetch_jobs(search_id);

  -- Saved/favorited listings. We snapshot the full listing JSON (rather than
  -- just referencing listings.id) so a favorite survives even after the source
  -- listing is re-scraped, evicted, or falls outside a later search's radius.
  CREATE TABLE IF NOT EXISTS favorites (
    id       TEXT PRIMARY KEY,   -- listing id
    data     TEXT NOT NULL,      -- JSON snapshot of the listing
    saved_at INTEGER NOT NULL
  );
`);

module.exports = { db };
