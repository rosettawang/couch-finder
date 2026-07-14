const state = { priceType: 'all', view: 'results', favorites: new Set(), lastResults: [] };

const els = {
  q: document.getElementById('q'),
  categoryField: document.getElementById('categoryField'),
  category: document.getElementById('category'),
  address: document.getElementById('address'),
  radius: document.getElementById('radius'),
  dimsSection: document.getElementById('dimsSection'),
  results: document.getElementById('results'),
  resultCount: document.getElementById('resultCount'),
  viewTabs: document.getElementById('viewTabs'),
  favCount: document.getElementById('favCount'),
  dataNote: document.getElementById('dataNote'),
  priceTabs: document.getElementById('priceTabs'),
  searchBtn: document.getElementById('searchBtn'),
  addNextdoorBtn: document.getElementById('addNextdoorBtn'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  ndSave: document.getElementById('ndSave'),
  ndCancel: document.getElementById('ndCancel'),
};

// The category preset and couch-dimension filters only apply to a preset
// search. When the free-text box has a value, hide both — that search goes
// straight to the scrapers as a raw term.
function updateFormMode() {
  const freeText = els.q.value.trim().length > 0;
  els.categoryField.style.display = freeText ? 'none' : 'block';
  els.dimsSection.style.display =
    !freeText && els.category.value === 'couches' ? 'block' : 'none';
}
els.category.addEventListener('change', updateFormMode);
els.q.addEventListener('input', updateFormMode);
updateFormMode();

els.priceTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  [...els.priceTabs.children].forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.priceType = btn.dataset.value;
});

function sourceLabel(source) {
  return {
    facebook_marketplace: 'Facebook Marketplace',
    craigslist: 'Craigslist',
    offerup: 'OfferUp',
    nextdoor_manual: 'Nextdoor (manual)',
  }[source] || source;
}

function renderResults(listings) {
  state.lastResults = listings;
  els.results.innerHTML = '';
  if (!listings.length) {
    const msg =
      state.view === 'favorites'
        ? 'No saved listings yet. Tap the ♥ on a result to save it.'
        : 'No listings match your filters yet.';
    els.results.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }

  listings.forEach((l) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = l.id;

    const isFav = state.favorites.has(String(l.id));
    const favBtn = `<button class="fav-btn ${isFav ? 'active' : ''}" data-id="${escapeHtml(
      String(l.id)
    )}" title="${isFav ? 'Remove from favorites' : 'Save to favorites'}" aria-label="Save to favorites">${
      isFav ? '♥' : '♡'
    }</button>`;

    const dimBadge =
      l.dimensionMatch === 'match' && l.dimensions?.parsed
        ? `<span class="badge dim-match">${l.dimensions.width}"W x ${l.dimensions.depth}"D x ${l.dimensions.height}"H</span>`
        : l.dimensionMatch === 'unknown'
        ? '<span class="badge dim-unknown">dims not listed</span>'
        : '';

    const distanceText =
      l.distanceMiles === null || l.distanceMiles === undefined
        ? 'distance unknown'
        : `${l.distanceMiles.toFixed(1)} mi away`;

    card.innerHTML = `
      <div class="thumb">
        ${favBtn}
        ${
          l.imageUrl
            ? `<img src="${encodeURI(l.imageUrl)}" alt="${escapeHtml(l.title)}" loading="lazy" onerror="this.parentElement.textContent='No image'">`
            : 'No image'
        }
      </div>
      <div class="body">
        <div class="title">${escapeHtml(l.title)}</div>
        <div class="price ${l.priceType}">${l.priceType === 'free' ? 'Free' : '$' + l.price}</div>
        <div class="badge-row">
          <span class="badge">${sourceLabel(l.source)}</span>
          ${dimBadge}
        </div>
        <div class="meta">${escapeHtml(l.city || 'Unknown location')} · ${distanceText}</div>
        ${l.url ? `<a class="view-link" href="${l.url}" target="_blank" rel="noopener">View listing →</a>` : ''}
      </div>
    `;
    els.results.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

let pollTimer = null;

function buildParams() {
  const freeText = els.q.value.trim();
  const params = new URLSearchParams({
    priceType: state.priceType,
    address: els.address.value,
    radiusMiles: els.radius.value,
  });
  if (freeText) {
    params.set('q', freeText);
  } else {
    params.set('category', els.category.value);
    if (els.category.value === 'couches') {
      ['minWidth', 'maxWidth', 'minDepth', 'maxDepth', 'minHeight', 'maxHeight'].forEach((id) => {
        const val = document.getElementById(id).value;
        if (val) params.set(id, val);
      });
    }
  }
  return params;
}

function formatEta(ms) {
  if (!ms) return '';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `~${secs}s`;
  return `~${Math.round(secs / 60)} min`;
}

// Show a refresh banner above results describing background scrape progress.
function renderStatus(status, count) {
  if (!status || status.done) {
    if (state.configNote) els.dataNote.textContent = state.configNote;
    return;
  }
  const c = status.counts || {};
  const finished = (c.done || 0) + (c.error || 0);
  const eta = formatEta(status.etaMs);
  els.dataNote.textContent =
    `Refreshing ${status.total} source job${status.total === 1 ? '' : 's'} in the background — ` +
    `${finished}/${status.total} done${eta ? `, ${eta} remaining` : ''}. ` +
    `Showing ${count} cached result${count === 1 ? '' : 's'} now; new ones appear as they arrive.`;
}

async function runSearch() {
  if (pollTimer) clearTimeout(pollTimer);
  els.results.innerHTML = '<div class="loading">Loading cached results…</div>';

  const params = buildParams();

  try {
    const res = await fetch(`/api/search?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    els.resultCount.textContent = `${data.count} result${data.count === 1 ? '' : 's'}`;
    renderResults(data.listings);
    renderStatus(data.status, data.count);
    if (data.refreshing && data.searchId) {
      pollStatus(data.searchId, params);
    }
  } catch (err) {
    els.results.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

// Poll the status endpoint until all background jobs finish, merging in newly
// scraped listings each tick.
function pollStatus(searchId, params) {
  const statusParams = new URLSearchParams(params);
  statusParams.set('searchId', searchId);

  const poll = async () => {
    try {
      const res = await fetch(`/api/search/status?${statusParams.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Status check failed');
      els.resultCount.textContent = `${data.count} result${data.count === 1 ? '' : 's'}`;
      renderResults(data.listings);
      renderStatus(data.status, data.count);
      if (!data.status || !data.status.done) {
        pollTimer = setTimeout(poll, 2000);
      }
    } catch (err) {
      console.warn('Status poll failed:', err.message);
    }
  };
  pollTimer = setTimeout(poll, 2000);
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    els.address.value = cfg.defaultAddress;
    els.radius.value = cfg.defaultRadiusMiles;
    const live = Object.entries(cfg.sourcesUsingLiveData)
      .filter(([, v]) => v)
      .map(([k]) => sourceLabel(k));
    const mock = Object.entries(cfg.sourcesUsingLiveData)
      .filter(([, v]) => !v)
      .map(([k]) => sourceLabel(k));
    state.configNote = live.length
      ? `Live data: ${live.join(', ')}. Demo data: ${mock.join(', ') || 'none'}.`
      : `Running on demo/mock data for all sources except manual Nextdoor entries. Configure APIFY_TOKEN + actor IDs in .env for live results.`;
    els.dataNote.textContent = state.configNote;
  } catch {
    els.dataNote.textContent = 'Could not load config — is the server running?';
  }
}

// --- Favorites ---

// Load saved listings into state (ids for marking hearts, and the full
// snapshots for the Favorites view).
async function loadFavorites() {
  try {
    const res = await fetch('/api/favorites');
    const data = await res.json();
    state.favoriteListings = data.listings || [];
    state.favorites = new Set(state.favoriteListings.map((l) => String(l.id)));
  } catch (err) {
    console.warn('Could not load favorites:', err.message);
    state.favoriteListings = [];
  }
  updateFavCount();
}

function updateFavCount() {
  els.favCount.textContent = state.favorites.size ? `(${state.favorites.size})` : '';
}

// Save or unsave a listing, then refresh whichever view is showing.
async function toggleFavorite(id) {
  const key = String(id);
  if (state.favorites.has(key)) {
    await fetch(`/api/favorites/${encodeURIComponent(key)}`, { method: 'DELETE' });
    state.favorites.delete(key);
    state.favoriteListings = (state.favoriteListings || []).filter((l) => String(l.id) !== key);
  } else {
    const listing = state.lastResults.find((l) => String(l.id) === key);
    if (!listing) return;
    await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listing }),
    });
    state.favorites.add(key);
    state.favoriteListings = [{ ...listing, favorited: true }, ...(state.favoriteListings || [])];
  }
  updateFavCount();

  if (state.view === 'favorites') {
    renderResults(state.favoriteListings);
  } else {
    // Just flip the heart on the affected card, no full re-render.
    const btn = els.results.querySelector(`.fav-btn[data-id="${CSS.escape(key)}"]`);
    if (btn) {
      const isFav = state.favorites.has(key);
      btn.classList.toggle('active', isFav);
      btn.textContent = isFav ? '♥' : '♡';
      btn.title = isFav ? 'Remove from favorites' : 'Save to favorites';
    }
  }
}

// Heart clicks (event delegation so it works for cards added by polling too).
els.results.addEventListener('click', (e) => {
  const btn = e.target.closest('.fav-btn');
  if (!btn) return;
  e.preventDefault();
  toggleFavorite(btn.dataset.id);
});

// Results / Favorites view switch.
els.viewTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  [...els.viewTabs.children].forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.view = btn.dataset.view;
  if (state.view === 'favorites') {
    if (pollTimer) clearTimeout(pollTimer);
    els.resultCount.textContent = `${state.favoriteListings.length} saved`;
    renderResults(state.favoriteListings);
  } else {
    runSearch();
  }
});

els.searchBtn.addEventListener('click', () => {
  // Searching always returns to the results view.
  if (state.view !== 'results') {
    state.view = 'results';
    [...els.viewTabs.children].forEach((b) =>
      b.classList.toggle('active', b.dataset.view === 'results')
    );
  }
  runSearch();
});

els.addNextdoorBtn.addEventListener('click', () => {
  els.modalBackdrop.style.display = 'flex';
});
els.ndCancel.addEventListener('click', () => {
  els.modalBackdrop.style.display = 'none';
});
els.ndSave.addEventListener('click', async () => {
  const body = {
    title: document.getElementById('ndTitle').value,
    price: parseFloat(document.getElementById('ndPrice').value) || 0,
    url: document.getElementById('ndUrl').value,
    text: document.getElementById('ndText').value,
    category: els.category.value,
  };
  body.priceType = body.price > 0 ? 'for_sale' : 'free';
  await fetch('/api/manual-listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  els.modalBackdrop.style.display = 'none';
  runSearch();
});

Promise.all([loadConfig(), loadFavorites()]).then(runSearch);
