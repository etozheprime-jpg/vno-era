// AirLabs schedules → VNO Era flight shape.
export const AIRPORT = 'VNO';
const BASE = 'https://airlabs.co/api/v9';

export function vilniusDay(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius' }).format(ts);
}

const ts = (sec, utc) => (sec ? sec * 1000 : utc ? Date.parse(utc.replace(' ', 'T') + 'Z') || null : null);

function normalizeFlight(r) {
  if (r.arr_iata !== AIRPORT) return null;
  if (r.cs_flight_iata) return null; // marketing (codeshare) record — keep only the operating flight
  const sched = ts(r.arr_time_ts, r.arr_time_utc);
  if (!sched) return null;
  const status = r.status;
  let actual = ts(r.arr_actual_ts, r.arr_actual_utc);
  const est = ts(r.arr_estimated_ts, r.arr_estimated_utc) ?? (r.arr_delayed ? sched + r.arr_delayed * 60000 : sched);
  if (status === 'landed' && !actual) actual = est;
  const depActual = ts(r.dep_actual_ts, r.dep_actual_utc);
  const dep = depActual ?? ts(r.dep_estimated_ts, r.dep_estimated_utc) ?? ts(r.dep_time_ts, r.dep_time_utc);
  const alCode = r.airline_iata || r.airline_icao || '';
  const num = r.flight_number || (r.flight_iata || '').slice(alCode.length);
  const from = r.dep_iata || r.dep_icao || '???';
  const cancelled = status === 'cancelled';
  return {
    id: `${alCode}${num}-${from}-${new Date(sched).toISOString().slice(0, 16)}`,
    flightNo: num ? `${alCode} ${num}` : alCode || '—',
    airline: alCode, airlineName: alCode, number: num || '',
    callsign: r.flight_icao || null, airlineIcao: r.airline_icao || null,
    from, fromName: from,
    aircraft: r.aircraft_icao || '',
    belt: r.arr_baggage || null, terminal: r.arr_terminal || null, gate: r.arr_gate || null,
    sched, est: cancelled ? null : est, actual: cancelled ? null : actual, dep,
    departed: !!depActual || status === 'active' || status === 'landed' || !!actual,
    cancelled, diverted: status === 'diverted',
    pos: null,
  };
}

export function normalize(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const f = normalizeFlight(r);
    if (!f || seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out.sort((x, y) => x.sched - y.sched);
}

// Fetch up to maxPages pages (Free keys: 50 results per page). Returns { list, requests, error }.
export async function fetchSchedules(key, { maxPages = 2 } = {}) {
  const list = [];
  let requests = 0;
  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE}/schedules?arr_iata=${AIRPORT}&limit=50&offset=${page * 50}&api_key=${encodeURIComponent(key)}`;
    requests++;
    let json;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      json = await res.json().catch(() => null);
      if (!res.ok && !json?.error) return { list, requests, error: { code: `http_${res.status}`, message: res.statusText } };
    } catch (err) {
      return { list, requests, error: { code: 'network', message: String(err.message || err) } };
    }
    if (json?.error) return { list, requests, error: { code: json.error.code || 'airlabs', message: json.error.message || '' } };
    list.push(...(json?.response || []));
    if (!json?.request?.has_more) break;
  }
  return { list, requests, error: null };
}

// Live aircraft bound for VNO: gives each flight's ICAO 24-bit address (hex) for an exact OpenSky match,
// plus AirLabs' own position as a fallback. One request.
export async function fetchLive(key) {
  const fields = 'hex,flight_iata,flight_icao,lat,lng,alt,dir,updated,status';
  try {
    const res = await fetch(`${BASE}/flights?arr_iata=${AIRPORT}&_fields=${fields}&api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20000) });
    const json = await res.json().catch(() => null);
    if (json?.error) return { list: [], error: { code: json.error.code || 'airlabs', message: json.error.message || '' } };
    return { list: json?.response || [], error: null };
  } catch (err) {
    return { list: [], error: { code: 'network', message: String(err.message || err) } };
  }
}
