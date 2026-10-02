// One update of data/arrivals.json: AirLabs schedules + live flights (hex) + OpenSky positions.
// Runs in GitHub Actions (keys from repository secrets) or locally (keys from .env).
//   node tools/fetch-arrivals.mjs
// Limits: DAILY_LIMIT updates per Vilnius day, MONTHLY_LIMIT AirLabs requests per calendar month.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'arrivals.json');

if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
// data.js reads browser globals only inside functions; give it harmless stand-ins.
globalThis.location ??= { hostname: '', pathname: '/' };
globalThis.navigator ??= { onLine: true };
const { normalize, fetchSchedules, fetchLive, vilniusDay } = await import('./airlabs.mjs');
const { fetchStates, attachPositions } = await import('./opensky.mjs');

const KEY = process.env.AIRLABS_KEY || '';
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 15);
const MONTHLY_LIMIT = Number(process.env.MONTHLY_LIMIT || 1000);
const MAX_PAGES = Number(process.env.MAX_PAGES || 1);
const PER_UPDATE = MAX_PAGES + 1; // schedules page(s) + one live-flights request

const now = Date.now();
const day = vilniusDay(now);
const month = day.slice(0, 7);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const fresh = prev.source === 'airlabs';
const old = fresh ? prev.usage || {} : {};
const usage = {
  day, count: old.day === day ? old.count || 0 : 0, dailyLimit: DAILY_LIMIT,
  month, monthRequests: old.month === month ? old.monthRequests || 0 : 0, monthlyLimit: MONTHLY_LIMIT,
};

let flights = fresh ? prev.flights || [] : [];
let fetchedAt = fresh ? prev.fetchedAt : null;
let opensky = fresh ? prev.opensky || null : null;
let attempt;

if (!KEY) attempt = { at: now, ok: false, code: 'missing_access_key' };
else if (usage.count >= DAILY_LIMIT) attempt = { at: now, ok: false, code: 'daily_limit' };
else if (usage.monthRequests + PER_UPDATE > MONTHLY_LIMIT) attempt = { at: now, ok: false, code: 'monthly_limit' };
else {
  usage.count += 1;
  const r = await fetchSchedules(KEY, { maxPages: MAX_PAGES });
  usage.monthRequests += r.requests;
  if (process.env.DEBUG_RAW) writeFileSync(join(ROOT, '.cache', 'airlabs-raw.json'), JSON.stringify(r.list));
  if (r.error && !r.list.length) {
    attempt = { at: now, ok: false, code: r.error.code, message: r.error.message };
  } else {
    flights = normalize(r.list);
    fetchedAt = now;
    attempt = { at: now, ok: true, records: r.list.length, requests: r.requests };
    // Positions are a bonus: any failure here just leaves schedule-based positions.
    const live = await fetchLive(KEY);
    usage.monthRequests += 1;
    let os = null, osError = null;
    try { os = await fetchStates({ clientId: process.env.OPENSKY_CLIENT_ID, clientSecret: process.env.OPENSKY_CLIENT_SECRET }); }
    catch (err) { osError = String(err.message || err); }
    const stats = attachPositions(flights, live.list, os);
    opensky = { at: os?.time || now, error: osError, live: live.list.length, liveError: live.error?.code || null, ...stats };
  }
}
usage.quota = { limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - usage.monthRequests), month };

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: 'airlabs', fetchedAt, usage, lastAttempt: attempt, opensky, flights }));
console.log(`${attempt.ok ? `OK · records ${attempt.records} → flights ${flights.length}` : 'NOT UPDATED: ' + attempt.code + (attempt.message ? ` (${attempt.message})` : '')}`
  + ` · today ${usage.count}/${DAILY_LIMIT} · month ${usage.monthRequests}/${MONTHLY_LIMIT}`
  + (opensky ? ` · positions: OpenSky ${opensky.opensky}, AirLabs ${opensky.airlabs} (live list ${opensky.live}${opensky.liveError ? ', error ' + opensky.liveError : ''}${opensky.error ? ', OpenSky error ' + opensky.error : ''})` : ''));
