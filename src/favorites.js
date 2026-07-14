// Saved-listing store. Favorites are keyed by listing id and hold a full JSON
// snapshot of the listing, so they persist independently of the scrape cache
// (a saved listing stays viewable even after it's re-scraped or evicted).

const { db } = require('./db');

function now() {
  return Date.now();
}

// Save (or refresh the snapshot of) a listing. Returns the stored favorite.
function addFavorite(listing) {
  if (!listing || !listing.id) throw new Error('listing with an id is required');
  const id = String(listing.id);
  const savedAt = now();
  db.prepare(
    `INSERT INTO favorites (id, data, saved_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`
  ).run(id, JSON.stringify(listing), savedAt);
  return { id, savedAt, listing };
}

function removeFavorite(id) {
  const info = db.prepare(`DELETE FROM favorites WHERE id = ?`).run(String(id));
  return info.changes > 0;
}

// All saved listings, newest first, each with the saved timestamp attached.
function listFavorites() {
  return db
    .prepare(`SELECT id, data, saved_at FROM favorites ORDER BY saved_at DESC`)
    .all()
    .map((r) => ({ ...JSON.parse(r.data), savedAt: r.saved_at, favorited: true }));
}

// Just the set of saved ids, for marking search results.
function favoriteIds() {
  return db.prepare(`SELECT id FROM favorites`).all().map((r) => r.id);
}

module.exports = { addFavorite, removeFavorite, listFavorites, favoriteIds };
