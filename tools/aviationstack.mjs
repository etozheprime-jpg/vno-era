// aviationstack → VNO Era flight shape. Used by tools/fetch-arrivals.mjs (locally and in GitHub Actions).
export const AIRPORT = 'VNO';

// aviationstack returns local airport wall-clock times labelled "+00:00"; convert using the airport's tz.
const dtfCache = new Map();
function tzOffsetMs(ts, tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtfCache.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ts))) p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}
export function wallToEpoch(str, tz) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    const guess = wall - tzOffsetMs(wall, tz);
    return wall - tzOffsetMs(guess, tz);
  } catch { return wall - tzOffsetMs(wall, 'Europe/Vilnius'); }
}
export function vilniusDay(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius' }).format(ts);
}

// Countries outside the Schengen area, identified by the origin airport's time zone.
const NON_SCHENGEN_TZ = new Set([
  'Europe/London', 'Europe/Dublin', 'Europe/Belfast', 'Europe/Guernsey', 'Europe/Jersey', 'Europe/Isle_of_Man', 'Europe/Gibraltar',
  'Europe/Istanbul', 'Asia/Istanbul', 'Asia/Nicosia', 'Asia/Famagusta', 'Europe/Nicosia',
  'Europe/Belgrade', 'Europe/Tirane', 'Europe/Skopje', 'Europe/Podgorica', 'Europe/Sarajevo', 'Europe/Chisinau',
  'Europe/Kiev', 'Europe/Kyiv', 'Europe/Minsk', 'Europe/Moscow', 'Europe/Kaliningrad',
  'Asia/Jerusalem', 'Asia/Tel_Aviv', 'Asia/Dubai', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Riyadh', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Baku',
  'Africa/Cairo', 'Africa/Casablanca', 'Africa/Tunis', 'America/New_York', 'Asia/Tashkent', 'Asia/Almaty',
]);

function normalizeFlight(it) {
  const a = it.arrival || {}, d = it.departure || {}, fl = it.flight || {}, al = it.airline || {};
  if (fl.codeshared) return null; // keep only the operating carrier
  if (a.iata !== AIRPORT) return null;
  const atz = a.timezone || 'Europe/Vilnius';
  const dtz = d.timezone || atz;
  const sched = wallToEpoch(a.scheduled, atz);
  if (!sched) return null;
  const alCode = al.iata || (fl.iata || '').replace(/\d+[A-Z]?$/, '') || al.icao || '';
  const num = fl.number || (fl.iata || '').slice(alCode.length);
  const status = it.flight_status;
  let actual = wallToEpoch(a.actual_runway, atz) ?? wallToEpoch(a.actual, atz);
  const est = wallToEpoch(a.estimated_runway, atz) ?? wallToEpoch(a.estimated, atz) ?? (a.delay ? sched + a.delay * 60000 : sched);
  if (status === 'landed' && !actual) actual = est;
  const depActual = wallToEpoch(d.actual_runway, dtz) ?? wallToEpoch(d.actual, dtz);
  const dep = depActual ?? wallToEpoch(d.estimated, dtz) ?? wallToEpoch(d.scheduled, dtz);
  const cancelled = status === 'cancelled';
  const live = it.live && it.live.latitude != null && !it.live.is_ground
    ? { lat: it.live.latitude, lon: it.live.longitude, alt: it.live.altitude, heading: it.live.direction, at: Date.parse(it.live.updated) || null }
    : null;
  return {
    id: `${alCode}${num || ''}-${d.iata || 'X'}-${String(a.scheduled).slice(0, 16)}`,
    flightNo: num ? `${alCode} ${num}` : alCode || al.name || '—',
    airline: alCode, airlineName: al.name || alCode, number: num || '',
    from: d.iata || '???', fromName: d.airport || d.iata || '', fromTz: dtz,
    schengen: !NON_SCHENGEN_TZ.has(dtz),
    aircraft: it.aircraft?.iata || it.aircraft?.icao || '',
    belt: a.baggage || null, terminal: a.terminal || null, gate: a.gate || null,
    sched, est: cancelled ? null : est, actual: cancelled ? null : actual, dep,
    departed: !!depActual || status === 'active' || status === 'landed' || !!actual,
    cancelled, diverted: status === 'diverted',
    pos: live,
  };
}

export function normalize(raw) {
  const seen = new Set();
  const out = [];
  for (const it of raw?.data || []) {
    const f = normalizeFlight(it);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out.sort((x, y) => x.sched - y.sched);
}
