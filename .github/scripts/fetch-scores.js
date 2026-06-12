#!/usr/bin/env node
'use strict';

/**
 * Fetches World Cup 2026 match data from football-data.org and writes
 * results.json in the openfootball format consumed by the sweepstake app.
 *
 * Requires FOOTBALL_DATA_API_KEY env var (free tier at football-data.org).
 * Competition ID 2000 = FIFA World Cup.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY      = process.env.FOOTBALL_DATA_API_KEY;
const COMPETITION  = 2000;
const OUTPUT       = path.resolve(__dirname, '../../results.json');

if (!API_KEY) {
  console.error('FOOTBALL_DATA_API_KEY is not set.');
  console.error('Register for a free key at https://www.football-data.org/ and add it as a GitHub secret.');
  process.exit(1);
}

// football-data.org name  →  name used in the app's RANKED / FLAGS arrays
const NAME_MAP = {
  'United States':              'USA',
  "Côte d'Ivoire":              'Ivory Coast',
  'Ivory Coast':                'Ivory Coast',
  'Bosnia and Herzegovina':     'Bosnia & Herzegovina',
  'Czechia':                    'Czech Republic',
  'Democratic Republic of Congo': 'DR Congo',
  'Congo DR':                   'DR Congo',
  'Republic of Korea':          'South Korea',
  'Korea Republic':             'South Korea',
  'Curacao':                    'Curaçao',
  'Curaçao':                    'Curaçao',
  'Cape Verde Islands':         'Cape Verde',
};

// football-data.org stage  →  app round string
const STAGE_ROUND = {
  GROUP_STAGE:                 null,   // derived from group field below
  ROUND_OF_32:                 'Round of 32',
  ROUND_OF_16:                 'Round of 16',
  QUARTER_FINALS:              'Quarter-final',
  SEMI_FINALS:                 'Semi-final',
  FINAL:                       'Final',
  THIRD_PLACE:                 'Match for third place',
  PLAY_OFF_FOR_THIRD_PLACE:    'Match for third place',
};

function mapTeam(name) {
  return NAME_MAP[name] || name;
}

function mapRound(stage, group) {
  if (stage === 'GROUP_STAGE') {
    // 'GROUP_A' → 'Group A', 'GROUP_L' → 'Group L', etc.
    return group ? group.replace(/^GROUP_/, 'Group ') : 'Group Stage';
  }
  return STAGE_ROUND[stage] || stage;
}

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

async function main() {
  console.log(`Fetching competition ${COMPETITION} from football-data.org…`);
  const data = await fetchJson(`https://api.football-data.org/v4/competitions/${COMPETITION}/matches`);

  if (!Array.isArray(data.matches)) throw new Error('Unexpected API response – no matches array');

  const matches = data.matches.map(m => {
    const team1 = mapTeam(m.homeTeam.name);
    const team2 = mapTeam(m.awayTeam.name);
    const round = mapRound(m.stage, m.group);
    const isGroup = m.stage === 'GROUP_STAGE';

    const dt   = new Date(m.utcDate);
    const date = dt.toISOString().slice(0, 10);
    const time = dt.toISOString().slice(11, 16); // HH:MM – app treats no-offset as UTC

    const entry = { team1, team2, round, date, time };
    if (isGroup) entry.group = round; // app uses group field for group-stage rows

    const s = m.score;
    const notScheduled = m.status !== 'TIMED' && m.status !== 'SCHEDULED';

    if (s && s.fullTime.home !== null && notScheduled) {
      const score = { ft: [s.fullTime.home, s.fullTime.away] };

      if (s.duration === 'EXTRA_TIME' || s.duration === 'PENALTY_SHOOTOUT') {
        // extraTime in football-data.org is the 120-min total (incl. regular-time goals),
        // which is exactly what the app's `et` field expects.
        if (s.extraTime.home !== null) {
          score.et = [s.extraTime.home, s.extraTime.away];
        }
      }
      if (s.duration === 'PENALTY_SHOOTOUT' && s.penalties.home !== null) {
        score.p = [s.penalties.home, s.penalties.away];
      }

      entry.score = score;
    }

    return entry;
  });

  fs.writeFileSync(OUTPUT, JSON.stringify({ matches }, null, 2));
  const played = matches.filter(m => m.score).length;
  console.log(`Written ${matches.length} matches to results.json (${played} played).`);
}

main().catch(err => {
  console.error('fetch-scores failed:', err.message);
  process.exit(1);
});
