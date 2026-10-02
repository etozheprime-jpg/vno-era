// OpenSky Network: real positions for inbound VNO flights, attached at fetch time.
// The app then dead-reckons each aircraft from that point to Vilnius by its ETA.

const BBOX = { lamin: 24, lomin: -25, lamax: 67, lomax: 57 }; // Europe, Middle East, Iceland
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

async function token(id, secret) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`token http_${res.status}`);
  return (await res.json()).access_token;
}

export async function fetchStates({ clientId, clientSecret } = {}) {
  const headers = {};
  if (clientId && clientSecret) headers.Authorization = `Bearer ${await token(clientId, clientSecret)}`;
  const q = new URLSearchParams(BBOX);
  const res = await fetch(`https://opensky-network.org/api/states/all?${q}`, { headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const json = await res.json();
  return { time: json.time * 1000, states: json.states || [] };
}

// Exact match: AirLabs live data gives each inbound flight's ICAO 24-bit address (hex);
// OpenSky has a fresher fix for most of them. AirLabs' own position is the fallback.
// No guessing by route: a wrong aircraft on the map is worse than an estimated one.
export function attachPositions(flights, live, os) {
  const byHex = new Map();
  for (const s of os?.states || []) if (!s[8] && s[5] != null && s[6] != null) byHex.set(s[0].toLowerCase(), s);
  const byCallsign = new Map();
  for (const s of os?.states || []) if (s[1]) byCallsign.set(s[1].trim(), s);
  const liveBy = new Map();
  for (const l of live) { if (l.flight_iata) liveBy.set(l.flight_iata, l); if (l.flight_icao) liveBy.set(l.flight_icao, l); }
  const stats = { opensky: 0, airlabs: 0 };
  for (const f of flights) {
    if (f.actual || f.cancelled || !f.est) continue;
    const l = liveBy.get(f.callsign) || liveBy.get(f.airline + f.number);
    const s = (l?.hex && byHex.get(l.hex.toLowerCase())) || (f.callsign && byCallsign.get(f.callsign));
    if (s && !s[8]) {
      f.pos = { lat: s[6], lon: s[5], alt: s[7] ?? s[13], heading: s[10], at: (s[3] || os.time / 1000) * 1000, icao24: s[0], by: 'opensky' };
      stats.opensky++;
    } else if (l && l.lat != null && l.status !== 'landed') {
      f.pos = { lat: l.lat, lon: l.lng, alt: l.alt, heading: l.dir, at: (l.updated || Date.now() / 1000) * 1000, icao24: l.hex || null, by: 'airlabs' };
      stats.airlabs++;
    }
  }
  return stats;
}
