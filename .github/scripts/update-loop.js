#!/usr/bin/env node
'use strict';

/**
 * Long-running live score loop for GitHub Actions.
 *
 * GitHub's cron is coarse (5-min minimum) and unreliable, so instead of one
 * fetch per scheduled run we keep a single run alive and poll from inside it:
 *
 *   • a match is in play .............. every 12s  (= 5 calls/min, within the
 *                                       free tier's 10/min)
 *   • kick-off within 15 min ......... every 12s
 *   • next match within 2 hours ...... every 60s
 *   • nothing imminent ............... exit; the cron schedule restarts us
 *
 * We commit + push results.json ONLY when the scores actually change, so the
 * git history (and GitHub Pages rebuilds) stay quiet between goals.
 *
 * The run exits cleanly before GitHub's 6-hour job cap; the workflow's cron
 * keeps a replacement queued so coverage is seamless across a match day.
 */

const { execSync } = require('child_process');
const { fetchAndBuild, writeIfChanged } = require('./fetch-scores');

const FAST_MS        = 12 * 1000;            // 5 calls/min
const MED_MS         = 60 * 1000;
const SOON_MS        = 15 * 60 * 1000;       // "kick-off soon" window
const WARMUP_MS      = 2 * 60 * 60 * 1000;   // stay alive within 2h of a match
const MAX_RUNTIME_MS = 330 * 60 * 1000;      // 5h30 — exit before the 6h job cap
const TOURNAMENT_END = Date.parse('2026-07-20T00:00:00Z');
const MAX_ERRORS     = 6;                     // consecutive failures before bailing

const BRANCH = process.env.GIT_BRANCH || 'main';
const startedAt = Date.now();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const git = (args, opts = {}) =>
  execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim();

function configureGit() {
  git('config user.name "github-actions[bot]"');
  git('config user.email "github-actions[bot]@users.noreply.github.com"');
}

function pushWithRetry() {
  const delays = [2000, 4000, 8000, 16000];
  for (let attempt = 0; ; attempt++) {
    try {
      git(`pull --rebase --autostash origin ${BRANCH}`);
      git(`push origin HEAD:refs/heads/${BRANCH}`);
      return true;
    } catch (err) {
      if (attempt >= delays.length) {
        console.error('push failed after retries:', err.message);
        return false;
      }
      execSync(`sleep ${delays[attempt] / 1000}`);
    }
  }
}

function commitIfChanged() {
  const dirty = git('status --porcelain results.json');
  if (!dirty) return false;
  git('add results.json');
  git(`commit -m "chore: live score update ${new Date().toISOString()}"`);
  const pushed = pushWithRetry();
  console.log(pushed ? '↑ pushed score update' : '⚠️ commit made but push failed (will retry next change)');
  return true;
}

// How long to wait before the next poll — or null to stop.
function cadence(status) {
  if (status.live) return FAST_MS;
  if (status.nextKickoffMs <= SOON_MS) return FAST_MS;
  if (status.nextKickoffMs <= WARMUP_MS) return MED_MS;
  return null; // nothing imminent — let the cron schedule restart us later
}

async function main() {
  if (Date.now() > TOURNAMENT_END) {
    console.log('Tournament is over — nothing to do.');
    return;
  }
  configureGit();

  let errors = 0;
  while (Date.now() - startedAt < MAX_RUNTIME_MS) {
    let status;
    try {
      const built = await fetchAndBuild();
      status = built.status;
      if (writeIfChanged(built.data)) commitIfChanged();
      errors = 0;
      console.log(`poll ok — live=${status.live} played=${status.played} ` +
                  `nextKickoff=${Number.isFinite(status.nextKickoffMs) ? Math.round(status.nextKickoffMs / 60000) + 'm' : 'none'} ` +
                  `reqsLeft=${status.requestsAvailable ?? '?'}/min`);
    } catch (err) {
      // 429 is expected back-pressure, not a failure: wait out the window and retry.
      if (err.rateLimited) {
        const waitMs = (err.resetSeconds + 1) * 1000;
        console.warn(`Rate limited — sleeping ${err.resetSeconds + 1}s until the counter resets.`);
        await sleep(waitMs);
        continue;
      }
      if (++errors >= MAX_ERRORS) { console.error(`Giving up after ${errors} errors:`, err.message); return; }
      console.error(`poll error (${errors}/${MAX_ERRORS}):`, err.message);
      await sleep(MED_MS);
      continue;
    }

    let next = cadence(status);
    if (next === null) { console.log('No match imminent — exiting; the schedule will restart the loop.'); return; }
    // Self-throttle: if we're down to the last request this minute, wait for the
    // window to reset before the next call so we never trip the 429 limit.
    if (status.requestsAvailable != null && status.requestsAvailable <= 1) {
      const resetMs = ((status.resetSeconds ?? 60) + 1) * 1000;
      next = Math.max(next, resetMs);
      console.warn(`Only ${status.requestsAvailable} request(s) left this minute — backing off ${Math.round(next / 1000)}s.`);
    }
    await sleep(next);
  }
  console.log('Max runtime reached — exiting; the queued run will take over.');
}

main().catch(err => { console.error('update-loop crashed:', err.message); process.exit(1); });
