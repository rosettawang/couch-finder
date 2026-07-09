// Geographic tiling for the search cache.
//
// The map is divided into a fixed lat/lng grid. Each cell ("tile") is the unit
// of both caching and refresh work: a listing belongs to exactly one tile (the
// one containing its coordinates), and staleness is tracked per (tile, source).
// A search converts an address+radius into the set of tiles it covers, returns
// cached listings for those tiles instantly, and only enqueues scrape work for
// the tiles that are missing or stale.
//
// We use a simple equirectangular grid rather than H3 hexagons to avoid a
// native dependency. TILE_DEG of 0.05 degrees is roughly 3.5 miles of latitude
// (a bit less in longitude at Berkeley's latitude), which is a reasonable
// caching granularity for a local-furniture search.

const { haversineMiles } = require('./distance');

const TILE_DEG = 0.05;

function tileIndex(deg) {
  return Math.floor(deg / TILE_DEG);
}

// Stable string id for the tile containing (lat, lon).
function tileIdFor(lat, lon) {
  if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return `${tileIndex(lat)}_${tileIndex(lon)}`;
}

// Lat/lon bounds of a tile id, plus its center.
function tileBounds(tileId) {
  const [latIdx, lonIdx] = tileId.split('_').map(Number);
  const minLat = latIdx * TILE_DEG;
  const minLon = lonIdx * TILE_DEG;
  return {
    minLat,
    minLon,
    maxLat: minLat + TILE_DEG,
    maxLon: minLon + TILE_DEG,
    centerLat: minLat + TILE_DEG / 2,
    centerLon: minLon + TILE_DEG / 2,
  };
}

// All tile ids whose cell intersects the circle of `radiusMiles` around
// (lat, lon). We walk the grid over the radius' bounding box and keep any tile
// whose nearest point to the origin is within the radius. Longitude degrees
// shrink with latitude, so we scale the longitude span by cos(latitude).
function tilesInRadius(lat, lon, radiusMiles) {
  const milesPerLatDeg = 69.0;
  const milesPerLonDeg = Math.max(1, 69.0 * Math.cos((lat * Math.PI) / 180));

  const latPad = radiusMiles / milesPerLatDeg;
  const lonPad = radiusMiles / milesPerLonDeg;

  const minLatIdx = tileIndex(lat - latPad);
  const maxLatIdx = tileIndex(lat + latPad);
  const minLonIdx = tileIndex(lon - lonPad);
  const maxLonIdx = tileIndex(lon + lonPad);

  const tiles = [];
  for (let latIdx = minLatIdx; latIdx <= maxLatIdx; latIdx++) {
    for (let lonIdx = minLonIdx; lonIdx <= maxLonIdx; lonIdx++) {
      const id = `${latIdx}_${lonIdx}`;
      const b = tileBounds(id);
      // Nearest point on the tile rectangle to the origin, clamped per axis.
      const nearLat = Math.min(Math.max(lat, b.minLat), b.maxLat);
      const nearLon = Math.min(Math.max(lon, b.minLon), b.maxLon);
      const d = haversineMiles(lat, lon, nearLat, nearLon);
      if (d !== null && d <= radiusMiles) tiles.push(id);
    }
  }
  return tiles;
}

module.exports = { TILE_DEG, tileIdFor, tileBounds, tilesInRadius };
