const fetch = require('node-fetch');

// Free-text address -> {lat, lon} using OpenStreetMap's Nominatim service.
// Nominatim's usage policy requires a descriptive User-Agent and asks for
// no more than ~1 request/sec, which is fine for this app's low volume.
// https://operations.osmfoundation.org/policies/nominatim/

const cache = new Map();

// Approximate fallback if geocoding fails (e.g. no network access) --
// downtown Berkeley, CA. Only used as a last resort.
const FALLBACK_COORDS = { lat: 37.8716, lon: -122.2727 };

async function geocodeAddress(address) {
  if (cache.has(address)) return cache.get(address);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      address
    )}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'couch-finder-app/1.0 (personal local-search project)' },
    });
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    const results = await res.json();
    if (!results.length) throw new Error('No geocoding results');
    const coords = { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
    cache.set(address, coords);
    return coords;
  } catch (err) {
    console.warn(`Geocoding failed for "${address}", using fallback coords:`, err.message);
    return FALLBACK_COORDS;
  }
}

const zipCache = new Map();

// Reverse geocode lat/lon -> US zip code, used by the OfferUp adapter (its
// actor takes a zipCode rather than a free-text address or lat/lon).
async function reverseGeocodeZip(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (zipCache.has(key)) return zipCache.get(key);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'couch-finder-app/1.0 (personal local-search project)' },
    });
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    const result = await res.json();
    const zip = result?.address?.postcode || null;
    if (zip) zipCache.set(key, zip);
    return zip;
  } catch (err) {
    console.warn('Reverse geocoding to zip failed:', err.message);
    return null;
  }
}

module.exports = { geocodeAddress, reverseGeocodeZip };
