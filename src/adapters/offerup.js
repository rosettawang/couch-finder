const { runApifyActor } = require('../apifyRunner');
const { mockSearch } = require('../mockData');
const { geocodeAddress, reverseGeocodeZip } = require('../geocode');

const SOURCE = 'offerup';

// Verified against igolaizola/offerup-scraper on the Apify Store (input
// schema + "Track OfferUp Furniture Listings" example), July 2026.
//
// Input: { query, zipCode, maxItems }
// Output per item: { image, url, id, title, price, location, flags,
// condition, firmPrice, priceDrop, details }
// Note: no lat/lon in the output, so these listings get distanceMiles=null
// (treated as "distance unknown" and always included, same as manual
// Nextdoor entries) rather than being geo-filtered.

const CATEGORY_QUERY = { couches: 'sofa', tables: 'table', chairs: 'chair' };

function parsePrice(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  const num = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isNaN(num) ? 0 : num;
}

async function search({ category, address }) {
  const actorId = process.env.APIFY_ACTOR_OFFERUP;
  const query = CATEGORY_QUERY[category] || category;

  // The actor wants a zip code, not a free-text address, so derive one from
  // whatever address/radius origin the rest of the app is using. Falls back
  // to OFFERUP_ZIP_CODE in .env if reverse geocoding doesn't return a zip.
  let zipCode = process.env.OFFERUP_ZIP_CODE || null;
  if (!zipCode && actorId) {
    const { lat, lon } = await geocodeAddress(address);
    zipCode = await reverseGeocodeZip(lat, lon);
  }

  const result =
    actorId && zipCode
      ? await runApifyActor({
          actorId,
          input: {
            query,
            zipCode,
            maxItems: 40,
          },
          mapItem: (item) => ({
            id: item.id || item.url,
            source: SOURCE,
            title: item.title,
            price: parsePrice(item.price),
            priceType:
              parsePrice(item.price) === 0 || /free/i.test(item.title || '') ? 'free' : 'for_sale',
            description: item.details || item.condition || '',
            city: item.location || null,
            lat: null,
            lon: null,
            url: item.url,
            imageUrl: item.image || null,
            postedAt: null, // not provided by this actor
          }),
        })
      : null;

  if (result) return result;
  return mockSearch(SOURCE, category); // no actor/zip configured -> demo data
}

module.exports = { search };
