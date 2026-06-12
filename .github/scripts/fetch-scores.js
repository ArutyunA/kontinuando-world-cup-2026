#!/usr/bin/env node
'use strict';

/**
 * Fetches World Cup 2026 match data from football-data.org and builds the
 * results.json payload consumed by the sweepstake app.
 *
 * Exports fetchAndBuild() for the live update loop (update-loop.js).
 * Run directly (`node fetch-scores.js`) for a one-shot write — handy for
 * manual testing or a single workflow_dispatch run.
 *
 * Requires FOOTBALL_DATA_API_KEY env var (free tier at football-data.org).
 * Competition ID 2000 = FIFA World Cup.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY     = process.env.FOOTBALL_DATA_API_KEY;
const COMPETITION = 2000;
const OUTPUT      = path.resolve(__dirname, '../../results.json');

// football-data.org name  →  name used in the app's RANKED / FLAGS arrays
const NAME_MAP = {
  'United States':                'USA',
  "Côte d'Ivoire":                'Ivory Coast',
  'Ivory Coast':                  'Ivory Coast',
  'Bosnia and Herzegovina':       'Bosnia & Herzegovina',
  'Czechia':                      'Czech Republic',
  'Democratic Republic of Congo': 'DR Congo',
  'Congo DR':                     'DR Congo',
  'Republic of Korea':            'South Korea',
  'Korea Republic':               'South Korea',
  'Curacao':                      'Curaçao',
  'Curaçao':                      'Curaçao',
  'Cape Verde Islands':           'Cape Verde',
};

// football-data.org stage  →  app round string
const STAGE_ROUND = {
  GROUP_STAGE:              null,   // derived from the group field below
  ROUND_OF_32:             'Round of 32',
  ROUND_OF_16:             'Round of 16',
  QUARTER_FINALS:          'Quarter-final',
  SEMI_FINALS:             'Semi-final',
  FINAL:                   'Final',
  THIRD_PLACE:             'Match for third place',
  PLAY_OFF_FOR_THIRD_PLACE:'Match for third place',
};

// Statuses that mean a match is actively being played (poll fast).
const LIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED']);
// Statuses that mean a match hasn't kicked off yet.
const PENDING_STATUSES = new Set(['SCHEDULED', 'TIMED']);

const mapTeam  = name => NAME_MAP[name] || name;
const mapRound = (stage, group) =>
  stage === 'GROUP_STAGE'
    ? (group ? group.replace(/^GROUP_/, 'Group ') : 'Group Stage')
    : (STAGE_ROUND[stage] || stage);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get(
      { hostname: u.hostname, path: u.pathname + u.search, headers: { 'X-Auth-Token': API_KEY } },
      res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
        });
      }
    ).on('error', reject);
  });
}

/**
 * Fetch the competition feed and build the app payload.
 * Returns { data, status } where
 *   data   = { live, matches }   (written to results.json)
 *   status = { live, nextKickoffMs, played }   (drives the loop cadence)
 */
async function fetchAndBuild() {
  if (!API_KEY) {
    throw new Error('FOOTBALL_DATA_API_KEY is not set — add it as a GitHub secret (free key at football-data.org).');
  }

  const feed = await fetchJson(`https://api.football-data.org/v4/competitions/${COMPETITION}/matches`);
  if (!Array.isArray(feed.matches)) throw new Error('Unexpected API response – no matches array');

  const now = Date.now();
  let live = false;
  let nextKickoffMs = Infinity; // ms until the next match that hasn't started yet

  const matches = feed.matches.map(m => {
    const team1 = mapTeam(m.homeTeam.name);
    const team2 = mapTeam(m.awayTeam.name);
    const round = mapRound(m.stage, m.group);
    const isGroup = m.stage === 'GROUP_STAGE';

    const dt   = new Date(m.utcDate);
    const date = dt.toISOString().slice(0, 10);
    const time = dt.toISOString().slice(11, 16); // HH:MM – app treats no-offset as UTC

    if (LIVE_STATUSES.has(m.status)) live = true;
    if (PENDING_STATUSES.has(m.status)) {
      const delta = dt.getTime() - now;
      if (delta > 0 && delta < nextKickoffMs) nextKickoffMs = delta;
    }

    const entry = { team1, team2, round, date, time };
    if (isGroup) entry.group = round; // app uses the group field for group-stage rows

    const s = m.score;
    const started = !PENDING_STATUSES.has(m.status);
    if (s && s.fullTime.home !== null && started) {
      const score = { ft: [s.fullTime.home, s.fullTime.away] };
      if (s.duration === 'EXTRA_TIME' || s.duration === 'PENALTY_SHOOTOUT') {
        // extraTime here is the 120-min total (incl. regular-time goals),
        // which is exactly what the app's `et` field expects.
        if (s.extraTime.home !== null) score.et = [s.extraTime.home, s.extraTime.away];
      }
      if (s.duration === 'PENALTY_SHOOTOUT' && s.penalties.home !== null) {
        score.p = [s.penalties.home, s.penalties.away];
      }
      entry.score = score;
    }
    return entry;
  });

  const played = matches.filter(m => m.score).length;
  return {
    data:   { live, matches },
    status: { live, nextKickoffMs, played },
  };
}

/**
 * Write the payload to results.json only if it differs from what's on disk.
 * Returns true if the file was changed.
 */
function writeIfChanged(data) {
  const next = JSON.stringify(data, null, 2) + '\n';
  let prev = null;
  try { prev = fs.readFileSync(OUTPUT, 'utf8'); } catch { /* first run */ }
  if (prev === next) return false;
  fs.writeFileSync(OUTPUT, next);
  return true;
}

module.exports = { fetchAndBuild, writeIfChanged, OUTPUT };

// One-shot mode when run directly.
if (require.main === module) {
  fetchAndBuild()
    .then(({ data, status }) => {
      const changed = writeIfChanged(data);
      console.log(`Built ${data.matches.length} matches (${status.played} played, live=${status.live}). ` +
                  (changed ? 'results.json updated.' : 'No change.'));
    })
    .catch(err => { console.error('fetch-scores failed:', err.message); process.exit(1); });
}
