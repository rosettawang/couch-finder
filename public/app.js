const state = { priceType: 'all' };

const els = {
  category: document.getElementById('category'),
  address: document.getElementById('address'),
  radius: document.getElementById('radius'),
  dimsSection: document.getElementById('dimsSection'),
  results: document.getElementById('results'),
  resultCount: document.getElementById('resultCount'),
  dataNote: document.getElementById('dataNote'),
  priceTabs: document.getElementById('priceTabs'),
  searchBtn: document.getElementById('searchBtn'),
  addNextdoorBtn: document.getElementById('addNextdoorBtn'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  ndSave: document.getElementById('ndSave'),
  ndCancel: document.getElementById('ndCancel'),
};

function toggleDimsSection() {
  els.dimsSection.style.display = els.category.value === 'couches' ? 'block' : 'none';
}
els.category.addEventListener('change', toggleDimsSection);
toggleDimsSection();

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
  els.results.innerHTML = '';
  if (!listings.length) {
    els.results.innerHTML = '<div class="empty">No listings match your filters yet.</div>';
    return;
  }

  listings.forEach((l) => {
    const card = document.createElement('div');
    card.className = 'card';

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
      <div class="thumb">${
        l.imageUrl
          ? `<img src="${encodeURI(l.imageUrl)}" alt="${escapeHtml(l.title)}" loading="lazy" onerror="this.parentElement.textContent='No image'">`
          : 'No image'
      }</div>
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
  const params = new URLSearchParams({
    category: els.category.value,
    priceType: state.priceType,
    address: els.address.value,
    radiusMiles: els.radius.value,
  });
  if (els.category.value === 'couches') {
    ['minWidth', 'maxWidth', 'minDepth', 'maxDepth', 'minHeight', 'maxHeight'].forEach((id) => {
      const val = document.getElementById(id).value;
      if (val) params.set(id, val);
    });
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

els.searchBtn.addEventListener('click', runSearch);

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

loadConfig().then(runSearch);
