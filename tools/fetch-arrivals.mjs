// Fetch VNO arrivals from aviationstack once and write data/arrivals.json.
// Runs in GitHub Actions (key from repository secrets) or locally (key from .env).
//   node tools/fetch-arrivals.mjs                 — one API request, if today's limit allows
//   node tools/fetch-arrivals.mjs --seed <file>   — build data/arrivals.json from a saved raw response (no request)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { normalize, vilniusDay, AIRPORT } from './aviationstack.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'data', 'arrivals.json');

if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const KEY = process.env.AVIATIONSTACK_KEY || '';
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 15);
const BASE = process.env.AVIATIONSTACK_HTTPS === '1' ? 'https://api.aviationstack.com' : 'http://api.aviationstack.com'; // Free plan: HTTP only

const now = Date.now();
const day = vilniusDay(now);
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { flights: [], usage: {} };
const usage = prev.usage?.day === day ? { ...prev.usage } : { ...prev.usage, day, count: 0 };
usage.dailyLimit = DAILY_LIMIT;

let flights = prev.flights || [];
let fetchedAt = prev.fetchedAt || null;
let attempt;

const seedIdx = process.argv.indexOf('--seed');
if (seedIdx > 0) {
  const seed = JSON.parse(readFileSync(process.argv[seedIdx + 1], 'utf8'));
  flights = normalize(seed.raw);
  fetchedAt = seed.fetchedAt;
  usage.quota = seed.quota;
  attempt = { at: seed.fetchedAt, ok: true };
} else if (!KEY) {
  attempt = { at: now, ok: false, code: 'missing_access_key' };
} else if (usage.count >= DAILY_LIMIT) {
  attempt = { at: now, ok: false, code: 'daily_limit' };
} else if (usage.quota && usage.quota.remaining <= 0 && usage.quota.month === day.slice(0, 7)) {
  attempt = { at: now, ok: false, code: 'usage_limit_reached' };
} else {
  usage.count += 1; // count before the call: a failed call still costs quota
  try {
    const res = await fetch(`${BASE}/v1/flights?access_key=${encodeURIComponent(KEY)}&arr_iata=${AIRPORT}&limit=100`, { signal: AbortSignal.timeout(20000) });
    const lim = res.headers.get('x-quota-limit'), rem = res.headers.get('x-quota-remaining');
    if (rem != null) usage.quota = { limit: Number(lim) || 100, remaining: Number(rem), month: day.slice(0, 7) };
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) {
      const e = json?.error || {};
      attempt = { at: now, ok: false, code: e.code || `http_${res.status}`, message: e.message || res.statusText };
      if (e.code === 'usage_limit_reached') usage.quota = { ...(usage.quota || { limit: 100 }), remaining: 0, month: day.slice(0, 7) };
    } else {
      flights = normalize(json);
      fetchedAt = now;
      attempt = { at: now, ok: true };
    }
  } catch (err) {
    attempt = { at: now, ok: false, code: 'network', message: String(err.message || err) };
  }
}

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: 'aviationstack', fetchedAt, usage, lastAttempt: attempt, flights }));
console.log(`${attempt.ok ? 'OK' : 'NOT UPDATED: ' + attempt.code} · flights ${flights.length} · today ${usage.count}/${DAILY_LIMIT} · API quota left ${usage.quota?.remaining ?? '?'}`);
