// Demo/fallback data used when no APIFY_TOKEN / actor ID is configured for a
// source, so the app is fully usable out of the box. Coordinates are
// approximate city centers within roughly 50 miles of Berkeley, CA, except
// one Sacramento item which is intentionally out of range to demonstrate
// radius filtering.

const CITIES = {
  berkeley: { name: 'Berkeley, CA', lat: 37.8716, lon: -122.2727 },
  oakland: { name: 'Oakland, CA', lat: 37.8044, lon: -122.2712 },
  sf: { name: 'San Francisco, CA', lat: 37.7749, lon: -122.4194 },
  walnutCreek: { name: 'Walnut Creek, CA', lat: 37.9101, lon: -122.0652 },
  sanJose: { name: 'San Jose, CA', lat: 37.3382, lon: -121.8863 },
  vallejo: { name: 'Vallejo, CA', lat: 38.1041, lon: -122.2566 },
  fremont: { name: 'Fremont, CA', lat: 37.5485, lon: -121.9886 },
  sacramento: { name: 'Sacramento, CA', lat: 38.5816, lon: -121.4944 }, // ~75mi, out of range
};

let idCounter = 1;
function nextId(prefix) {
  return `${prefix}-${idCounter++}`;
}

const COUCHES = [
  {
    title: 'Mid-century modern sofa, great condition - 84x36x32',
    price: 350,
    priceType: 'for_sale',
    city: CITIES.berkeley,
    description: 'Solid wood frame, 84" W x 36" D x 32" H. Light wear, from a smoke-free home.',
  },
  {
    title: 'FREE - IKEA Kivik sofa, must pick up this weekend',
    price: 0,
    priceType: 'free',
    city: CITIES.oakland,
    description: 'Dimensions: W 90" x D 38" x H 33". Some fading, moving out of state.',
  },
  {
    title: 'Small apartment loveseat, 58" wide',
    price: 120,
    priceType: 'for_sale',
    city: CITIES.sf,
    description: '58 x 34 x 30 inches. Perfect for studios. Grey fabric.',
  },
  {
    title: 'Leather sectional couch - excellent shape',
    price: 600,
    priceType: 'for_sale',
    city: CITIES.walnutCreek,
    description: 'L-shaped sectional, overall 110" x 84" x 34". Genuine leather.',
  },
  {
    title: 'FREE couch - curb alert, first come first serve',
    price: 0,
    priceType: 'free',
    city: CITIES.fremont,
    description: 'No dimensions listed, just come measure it yourself. Decent condition.',
  },
  {
    title: 'Pottery Barn sofa, 82"W x 37"D x 34"H',
    price: 425,
    priceType: 'for_sale',
    city: CITIES.sanJose,
    description: 'Down-filled cushions, neutral tan color, no stains or tears.',
  },
  {
    title: 'Sacramento estate sale - antique sofa',
    price: 200,
    priceType: 'for_sale',
    city: CITIES.sacramento,
    description: '80 x 34 x 31 in. Included to demonstrate the 50-mile radius filter.',
  },
];

const TABLES = [
  {
    title: 'Solid oak dining table, seats 6',
    price: 275,
    priceType: 'for_sale',
    city: CITIES.berkeley,
    description: '72" x 38" x 30". A few scratches on top, structurally solid.',
  },
  {
    title: 'FREE particle board desk/table',
    price: 0,
    priceType: 'free',
    city: CITIES.oakland,
    description: 'Basic 48x24 table, some water damage on one corner.',
  },
  {
    title: 'IKEA round coffee table',
    price: 40,
    priceType: 'for_sale',
    city: CITIES.vallejo,
    description: '31" diameter, 18" high. Light use.',
  },
];

const CHAIRS = [
  {
    title: 'Set of 4 wooden dining chairs',
    price: 100,
    priceType: 'for_sale',
    city: CITIES.berkeley,
    description: 'Matching set, minor wobble on one leg, easy fix.',
  },
  {
    title: 'FREE office chair, needs new casters',
    price: 0,
    priceType: 'free',
    city: CITIES.sf,
    description: 'Otherwise comfortable, adjustable height.',
  },
  {
    title: 'Mid-century accent chair, great condition',
    price: 85,
    priceType: 'for_sale',
    city: CITIES.walnutCreek,
    description: '30" W x 32" D x 33" H. Tweed upholstery.',
  },
];

const CATEGORY_DATA = { couches: COUCHES, tables: TABLES, chairs: CHAIRS };

// Each "source" reshuffles/duplicates the base data with slightly different
// prices and a couple of source-only items, to make the multi-source
// aggregation visible in the demo.
function buildSourceListings(source, category) {
  const base = CATEGORY_DATA[category] || [];
  return base.map((item, i) => ({
    id: nextId(`${source}-${category}`),
    source,
    title: item.title,
    price: item.price,
    priceType: item.priceType,
    description: item.description,
    city: item.city.name,
    lat: item.city.lat,
    lon: item.city.lon,
    url: `https://example.com/${source}/listing/${category}-${i}`,
    imageUrl: null,
    postedAt: new Date(Date.now() - i * 1000 * 60 * 60 * 24).toISOString(),
  }));
}

async function mockSearch(source, category) {
  return buildSourceListings(source, category);
}

module.exports = { mockSearch };
