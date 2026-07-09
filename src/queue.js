// In-process background refresh queue.
//
// Scraping a source via Apify takes tens of seconds to minutes, so it must not
// happen inside the search request. Instead, a search enqueues one job per
// stale source into `fetch_jobs`, and this worker drains the queue in the
// background: it scrapes, writes results into the cache, marks the covered
// tiles fresh, and records how long the job took. Those recorded durations feed
// the ETA a search shows the user.
//
// This is deliberately a single-process, SQLite-backed queue -- no Redis or
// external broker -- which is plenty for one local app. `fetch_jobs` persists
// across restarts; any jobs left "running" when the process died are reset to
// pending on boot.

const { db } = require('./db');
const { fetchSource } = require('./aggregator');
const { upsertListings, markTilesFresh } = require('./cache');

const MAX_CONCURRENCY = parseInt(process.env.FETCH_CONCURRENCY || '2', 10);

// Fallback per-source duration estimate (ms) before we have real history.
const DEFAULT_JOB_MS = 45 * 1000;

let running = 0;
let started = false;

function now() {
  return Date.now();
}

// Reset any jobs stuck in "running" from a previous process, then start the
// drain loop. Called once at server startup.
function start() {
  if (started) return;
  started = true;
  db.prepare(`UPDATE fetch_jobs SET status = 'pending' WHERE status = 'running'`).run();
  tick();
}

// Enqueue refresh jobs for a search. `staleBySource` maps a source name to the
// list of stale tile ids it should refresh. Returns the created job ids.
function enqueueSearch({ searchId, category, address, radiusMiles, staleBySource }) {
  const stmt = db.prepare(`
    INSERT INTO fetch_jobs
      (search_id, source, category, address, radius_miles, tile_ids,
       status, enqueued_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  const ids = [];
  for (const [source, tileIds] of Object.entries(staleBySource)) {
    if (!tileIds || !tileIds.length) continue;
    const info = stmt.run(
      searchId,
      source,
      category,
      address,
      radiusMiles,
      JSON.stringify(tileIds),
      now()
    );
    ids.push(Number(info.lastInsertRowid));
  }
  tick();
  return ids;
}

// Pull and start pending jobs until we hit the concurrency cap.
function tick() {
  if (!started) return;
  while (running < MAX_CONCURRENCY) {
    const job = db
      .prepare(`SELECT * FROM fetch_jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 1`)
      .get();
    if (!job) break;
    db.prepare(`UPDATE fetch_jobs SET status = 'running', started_at = ? WHERE id = ?`).run(
      now(),
      job.id
    );
    running += 1;
    runJob(job); // async, not awaited -- concurrency is bounded by `running`
  }
}

async function runJob(job) {
  const startedAt = now();
  try {
    const listings = await fetchSource(job.source, {
      category: job.category,
      address: job.address,
      radiusMiles: job.radius_miles,
    });
    const count = upsertListings(listings, job.category);
    markTilesFresh({
      tileIds: JSON.parse(job.tile_ids || '[]'),
      source: job.source,
      category: job.category,
    });
    const finishedAt = now();
    db.prepare(
      `UPDATE fetch_jobs
       SET status = 'done', finished_at = ?, duration_ms = ?, result_count = ?
       WHERE id = ?`
    ).run(finishedAt, finishedAt - startedAt, count, job.id);
  } catch (err) {
    const finishedAt = now();
    db.prepare(
      `UPDATE fetch_jobs
       SET status = 'error', finished_at = ?, duration_ms = ?, error = ?
       WHERE id = ?`
    ).run(finishedAt, finishedAt - startedAt, String(err && err.message), job.id);
  } finally {
    running -= 1;
    // Schedule the next pull on a fresh tick so we never recurse deeply.
    setImmediate(tick);
  }
}

// Rolling average completed-job duration for a source (ms), or a default.
function avgDurationForSource(source) {
  const row = db
    .prepare(
      `SELECT AVG(duration_ms) AS avg FROM (
         SELECT duration_ms FROM fetch_jobs
         WHERE source = ? AND status = 'done' AND duration_ms IS NOT NULL
         ORDER BY id DESC LIMIT 10
       )`
    )
    .get(source);
  return row && row.avg ? Math.round(row.avg) : DEFAULT_JOB_MS;
}

// Status of a search's refresh jobs: counts, whether it's still working, and a
// rough ETA. ETA sums the estimated remaining time of outstanding jobs divided
// by concurrency -- a coarse but honest "about this long" number.
function getSearchStatus(searchId) {
  const jobs = db
    .prepare(`SELECT * FROM fetch_jobs WHERE search_id = ? ORDER BY id ASC`)
    .all(searchId);

  const counts = { pending: 0, running: 0, done: 0, error: 0 };
  let remainingMs = 0;
  for (const j of jobs) {
    counts[j.status] = (counts[j.status] || 0) + 1;
    if (j.status === 'pending') {
      remainingMs += avgDurationForSource(j.source);
    } else if (j.status === 'running') {
      const elapsed = now() - (j.started_at || now());
      remainingMs += Math.max(0, avgDurationForSource(j.source) - elapsed);
    }
  }

  const outstanding = counts.pending + counts.running;
  const etaMs = outstanding ? Math.round(remainingMs / Math.min(MAX_CONCURRENCY, outstanding || 1)) : 0;

  return {
    total: jobs.length,
    counts,
    done: outstanding === 0,
    etaMs,
    sources: jobs.map((j) => ({
      source: j.source,
      status: j.status,
      resultCount: j.result_count,
      durationMs: j.duration_ms,
      error: j.error,
    })),
  };
}

module.exports = { start, enqueueSearch, getSearchStatus, avgDurationForSource, MAX_CONCURRENCY };
