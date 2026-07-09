// Shared helper for running an Apify actor and getting back its dataset items.
// Each source adapter supplies (a) the actor's input shape for a given search
// and (b) a mapper from that actor's raw output fields to our normalized
// listing shape. Actor input/output schemas vary by which actor you pick from
// the Apify Store, so those two functions are the part you'll likely need to
// adjust per actor -- everything else here is boilerplate.

let ApifyClient;
try {
  // Lazy require so the app still boots without the dependency installed
  // if someone strips it out for a mock-only deployment.
  ({ ApifyClient } = require('apify-client'));
} catch (e) {
  ApifyClient = null;
}

async function runApifyActor({ actorId, input, mapItem, timeoutSecs = 60 }) {
  const token = process.env.APIFY_TOKEN;
  if (!token || !actorId || !ApifyClient) {
    return null; // caller should fall back to mock data
  }

  const client = new ApifyClient({ token });
  const run = await client.actor(actorId).call(input, { timeout: timeoutSecs });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items.map(mapItem).filter(Boolean);
}

module.exports = { runApifyActor };
