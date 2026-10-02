// VNO Era — data layer.
// Two sources share one normalized flight shape:
//   live — data/arrivals.json: AirLabs schedules + OpenSky positions, produced by tools/fetch-arrivals.mjs
//          (GitHub Actions, run only by the repository owner)
//   demo — deterministic simulated schedule (no network, no API key)

export const CONFIG = {
  dataUrl: 'data/arrivals.json',
  workflow: 'update.yml',
  branch: 'main',
  timeoutMs: 15000,
};

// owner/repo when served from GitHub Pages (https://<owner>.github.io/<repo>/)
export function githubRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
  if (!m) return null;
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return repo ? { owner: m[1], repo } : null;
}

export const TZ = 'Europe/Vilnius';
export const VNO = { iata: 'VNO', city: 'Vilnius', name: 'Vilnius Airport', lat: 54.6341, lon: 25.2858 };

// [IATA, city, airport name, lat, lon, schengen]
const AIRPORT_TABLE = [
  ['KUN', 'Kaunas', 'Kaunas', 54.964, 24.085, 1], ['PLQ', 'Palanga', 'Palanga', 55.973, 21.094, 1],
  ['RIX', 'Riga', 'Riga', 56.924, 23.971, 1], ['TLL', 'Tallinn', 'Tallinn', 59.413, 24.833, 1],
  ['HEL', 'Helsinki', 'Helsinki', 60.317, 24.963, 1], ['TMP', 'Tampere', 'Tampere', 61.414, 23.604, 1],
  ['WAW', 'Warsaw', 'Warsaw Chopin', 52.166, 20.967, 1], ['WMI', 'Warsaw', 'Warsaw Modlin', 52.451, 20.652, 1],
  ['KTW', 'Katowice', 'Katowice', 50.474, 19.080, 1], ['KRK', 'Kraków', 'Kraków', 50.078, 19.785, 1],
  ['GDN', 'Gdańsk', 'Gdańsk', 54.378, 18.466, 1], ['PRG', 'Prague', 'Prague', 50.101, 14.260, 1],
  ['VIE', 'Vienna', 'Vienna', 48.110, 16.570, 1], ['BUD', 'Budapest', 'Budapest', 47.437, 19.256, 1],
  ['CPH', 'Copenhagen', 'Copenhagen', 55.618, 12.651, 1], ['BLL', 'Billund', 'Billund', 55.740, 9.152, 1],
  ['AAL', 'Aalborg', 'Aalborg', 57.093, 9.849, 1], ['ARN', 'Stockholm', 'Stockholm Arlanda', 59.652, 17.919, 1],
  ['NYO', 'Stockholm', 'Stockholm Skavsta', 58.789, 16.912, 1], ['GOT', 'Gothenburg', 'Gothenburg', 57.663, 12.280, 1],
  ['OSL', 'Oslo', 'Oslo Gardermoen', 60.194, 11.100, 1], ['TRF', 'Oslo', 'Oslo Torp', 59.187, 10.259, 1],
  ['BGO', 'Bergen', 'Bergen', 60.293, 5.218, 1], ['SVG', 'Stavanger', 'Stavanger', 58.877, 5.638, 1],
  ['KEF', 'Reykjavík', 'Keflavík', 63.985, -22.606, 1],
  ['FRA', 'Frankfurt', 'Frankfurt', 50.038, 8.562, 1], ['MUC', 'Munich', 'Munich', 48.354, 11.786, 1],
  ['BER', 'Berlin', 'Berlin Brandenburg', 52.367, 13.503, 1], ['HAM', 'Hamburg', 'Hamburg', 53.630, 9.988, 1],
  ['DUS', 'Düsseldorf', 'Düsseldorf', 51.290, 6.767, 1], ['CGN', 'Cologne', 'Cologne Bonn', 50.866, 7.143, 1],
  ['DTM', 'Dortmund', 'Dortmund', 51.518, 7.612, 1],
  ['AMS', 'Amsterdam', 'Amsterdam Schiphol', 52.311, 4.768, 1], ['EIN', 'Eindhoven', 'Eindhoven', 51.450, 5.374, 1],
  ['BRU', 'Brussels', 'Brussels', 50.901, 4.484, 1], ['CRL', 'Brussels', 'Brussels Charleroi', 50.459, 4.454, 1],
  ['LUX', 'Luxembourg', 'Luxembourg', 49.623, 6.204, 1],
  ['CDG', 'Paris', 'Paris Charles de Gaulle', 49.010, 2.548, 1], ['ORY', 'Paris', 'Paris Orly', 48.726, 2.365, 1],
  ['BVA', 'Paris', 'Paris Beauvais', 49.454, 2.113, 1], ['NCE', 'Nice', 'Nice', 43.658, 7.216, 1],
  ['ZRH', 'Zurich', 'Zurich', 47.465, 8.549, 1], ['GVA', 'Geneva', 'Geneva', 46.238, 6.109, 1], ['BSL', 'Basel', 'Basel', 47.590, 7.529, 1],
  ['MXP', 'Milan', 'Milan Malpensa', 45.630, 8.723, 1], ['BGY', 'Milan', 'Milan Bergamo', 45.674, 9.704, 1],
  ['FCO', 'Rome', 'Rome Fiumicino', 41.800, 12.239, 1], ['CIA', 'Rome', 'Rome Ciampino', 41.799, 12.595, 1],
  ['BLQ', 'Bologna', 'Bologna', 44.535, 11.289, 1], ['VCE', 'Venice', 'Venice', 45.505, 12.352, 1],
  ['TSF', 'Venice', 'Venice Treviso', 45.648, 12.194, 1], ['PSA', 'Pisa', 'Pisa', 43.684, 10.393, 1],
  ['NAP', 'Naples', 'Naples', 40.886, 14.291, 1], ['BRI', 'Bari', 'Bari', 41.139, 16.761, 1],
  ['CTA', 'Catania', 'Catania', 37.467, 15.066, 1], ['OLB', 'Olbia', 'Olbia', 40.899, 9.518, 1],
  ['MLA', 'Malta', 'Malta', 35.858, 14.478, 1],
  ['BCN', 'Barcelona', 'Barcelona', 41.297, 2.083, 1], ['MAD', 'Madrid', 'Madrid', 40.498, -3.568, 1],
  ['AGP', 'Málaga', 'Málaga', 36.675, -4.499, 1], ['ALC', 'Alicante', 'Alicante', 38.282, -0.558, 1],
  ['VLC', 'Valencia', 'Valencia', 39.489, -0.482, 1], ['PMI', 'Palma', 'Palma de Mallorca', 39.552, 2.739, 1],
  ['TFS', 'Tenerife', 'Tenerife South', 28.045, -16.573, 1], ['LPA', 'Gran Canaria', 'Gran Canaria', 27.932, -15.387, 1],
  ['FUE', 'Fuerteventura', 'Fuerteventura', 28.453, -13.864, 1], ['ACE', 'Lanzarote', 'Lanzarote', 28.946, -13.605, 1],
  ['LIS', 'Lisbon', 'Lisbon', 38.781, -9.136, 1], ['FAO', 'Faro', 'Faro', 37.014, -7.966, 1],
  ['ATH', 'Athens', 'Athens', 37.936, 23.945, 1], ['SKG', 'Thessaloniki', 'Thessaloniki', 40.520, 22.971, 1],
  ['HER', 'Heraklion', 'Heraklion', 35.340, 25.180, 1], ['RHO', 'Rhodes', 'Rhodes', 36.405, 28.086, 1],
  ['CFU', 'Corfu', 'Corfu', 39.602, 19.912, 1], ['ZTH', 'Zakynthos', 'Zakynthos', 37.751, 20.884, 1],
  ['KGS', 'Kos', 'Kos', 36.793, 27.092, 1],
  ['SPU', 'Split', 'Split', 43.539, 16.298, 1], ['DBV', 'Dubrovnik', 'Dubrovnik', 42.561, 18.268, 1],
  ['ZAG', 'Zagreb', 'Zagreb', 45.743, 16.069, 1], ['OTP', 'Bucharest', 'Bucharest', 44.571, 26.085, 1],
  ['SOF', 'Sofia', 'Sofia', 42.697, 23.411, 1], ['BOJ', 'Burgas', 'Burgas', 42.570, 27.515, 1],
  ['VAR', 'Varna', 'Varna', 43.232, 27.825, 1],
  ['STN', 'London', 'London Stansted', 51.885, 0.235, 0], ['LTN', 'London', 'London Luton', 51.875, -0.368, 0],
  ['LGW', 'London', 'London Gatwick', 51.154, -0.182, 0], ['LHR', 'London', 'London Heathrow', 51.470, -0.454, 0],
  ['MAN', 'Manchester', 'Manchester', 53.354, -2.275, 0], ['BHX', 'Birmingham', 'Birmingham', 52.454, -1.748, 0],
  ['BRS', 'Bristol', 'Bristol', 51.383, -2.719, 0], ['LPL', 'Liverpool', 'Liverpool', 53.334, -2.850, 0],
  ['LBA', 'Leeds', 'Leeds Bradford', 53.866, -1.661, 0], ['EMA', 'East Midlands', 'East Midlands', 52.831, -1.328, 0],
  ['EDI', 'Edinburgh', 'Edinburgh', 55.950, -3.373, 0], ['BFS', 'Belfast', 'Belfast', 54.658, -6.216, 0],
  ['DUB', 'Dublin', 'Dublin', 53.421, -6.270, 0],
  ['IST', 'Istanbul', 'Istanbul', 41.275, 28.752, 0], ['SAW', 'Istanbul', 'Istanbul Sabiha Gökçen', 40.899, 29.309, 0],
  ['AYT', 'Antalya', 'Antalya', 36.899, 30.801, 0], ['DLM', 'Dalaman', 'Dalaman', 36.713, 28.793, 0],
  ['BJV', 'Bodrum', 'Bodrum', 37.251, 27.664, 0], ['LCA', 'Larnaca', 'Larnaca', 34.875, 33.625, 0],
  ['PFO', 'Paphos', 'Paphos', 34.718, 32.486, 0], ['TLV', 'Tel Aviv', 'Tel Aviv Ben Gurion', 32.011, 34.887, 0],
  ['HRG', 'Hurghada', 'Hurghada', 27.178, 33.799, 0], ['SSH', 'Sharm el-Sheikh', 'Sharm el-Sheikh', 27.977, 34.395, 0],
  ['DXB', 'Dubai', 'Dubai', 25.253, 55.366, 0], ['DOH', 'Doha', 'Doha', 25.273, 51.608, 0],
  ['TBS', 'Tbilisi', 'Tbilisi', 41.669, 44.955, 0], ['KUT', 'Kutaisi', 'Kutaisi', 42.177, 42.483, 0],
  ['EVN', 'Yerevan', 'Yerevan', 40.147, 44.396, 0], ['GYD', 'Baku', 'Baku', 40.468, 50.047, 0],
  ['BEG', 'Belgrade', 'Belgrade', 44.818, 20.309, 0], ['TIV', 'Tivat', 'Tivat', 42.405, 18.723, 0],
  ['TGD', 'Podgorica', 'Podgorica', 42.359, 19.252, 0],
];
export const AIRPORTS = Object.fromEntries(AIRPORT_TABLE.map(([iata, city, name, lat, lon, sch]) => [iata, { iata, city, name, lat, lon, schengen: !!sch }]));

export const AIRLINES = {
  FR: { name: 'Ryanair', color: '#1F5CC6' },
  W6: { name: 'Wizz Air', color: '#C6007E' },
  SK: { name: 'SAS', color: '#3A63C9' },
  BT: { name: 'airBaltic', color: '#A6CE39' },
  LO: { name: 'LOT', color: '#2D5BB9' },
  LH: { name: 'Lufthansa', color: '#F2B600' },
  AY: { name: 'Finnair', color: '#5A7BD8' },
  TK: { name: 'Turkish Airlines', color: '#E81932' },
  DY: { name: 'Norwegian', color: '#E3343F' },
  KL: { name: 'KLM', color: '#00A1DE' },
  FZ: { name: 'flydubai', color: '#F26B21' },
  SN: { name: 'Brussels Airlines', color: '#E04A3F' },
  OS: { name: 'Austrian', color: '#E2001A' },
  LX: { name: 'SWISS', color: '#D52B1E' },
  GW: { name: 'GetJet Airlines', color: '#E8A33D' },
  HN: { name: 'Heston Airlines', color: '#3BA4C9' },
};
// Stable colour for airlines not in the table.
function airlineColor(code) {
  let h = 0;
  for (const c of String(code)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 58%)`;
}

// Demo timetable (Vilnius local time). Entries before 04:00 belong to the next calendar day.
const SCHEDULE = [
  ['06:50', 'BT', '341', 'RIX', 'A220-300'], ['07:35', 'LO', '771', 'WAW', 'E175'],
  ['08:05', 'AY', '1101', 'HEL', 'ATR 72'], ['08:40', 'FR', '2984', 'BGY', 'B737-8200'],
  ['09:15', 'LH', '880', 'FRA', 'A320neo'], ['09:40', 'DY', '1072', 'OSL', 'B737-800'],
  ['10:20', 'W6', '2563', 'LTN', 'A321neo'], ['10:45', 'SK', '1742', 'ARN', 'CRJ900'],
  ['11:10', 'KL', '1427', 'AMS', 'E190'], ['11:30', 'TK', '1411', 'IST', 'A321'],
  ['11:55', 'BT', '343', 'RIX', 'A220-300'], ['12:20', 'LO', '773', 'WAW', 'E195'],
  ['12:41', 'FR', '1571', 'STN', 'B737-8200'], ['12:48', 'SK', '743', 'CPH', 'CRJ900'],
  ['12:56', 'W6', '1023', 'BUD', 'A321neo'], ['13:25', 'LH', '882', 'MUC', 'A320'],
  ['13:50', 'FR', '2803', 'CIA', 'B737-800'], ['14:15', 'AY', '1103', 'HEL', 'ATR 72'],
  ['14:40', 'FR', '3214', 'DUB', 'B737-800'], ['15:05', 'W6', '4471', 'DTM', 'A320'],
  ['15:30', 'BT', '345', 'RIX', 'A220-300'], ['16:00', 'FZ', '1823', 'DXB', 'B737 MAX 8'],
  ['16:25', 'SN', '2805', 'BRU', 'A320'], ['16:50', 'FR', '1573', 'STN', 'B737-8200'],
  ['17:15', 'LO', '775', 'WAW', 'E175'], ['17:40', 'LH', '884', 'FRA', 'A320neo'],
  ['18:05', 'FR', '6421', 'BCN', 'B737-800'], ['18:30', 'SK', '1744', 'ARN', 'CRJ900'],
  ['18:55', 'W6', '3017', 'EIN', 'A321neo'], ['19:20', 'TK', '1413', 'IST', 'A321neo'],
  ['19:45', 'BT', '347', 'RIX', 'A220-300'], ['20:10', 'DY', '1074', 'OSL', 'B737-800'],
  ['20:35', 'FR', '2617', 'BGY', 'B737-8200'], ['21:00', 'LO', '777', 'WAW', 'E195'],
  ['21:30', 'FR', '8325', 'BER', 'B737-800'], ['22:00', 'AY', '1105', 'HEL', 'ATR 72'],
  ['22:25', 'FR', '3219', 'CRL', 'B737-8200'], ['22:55', 'W6', '1027', 'TLV', 'A321neo'],
  ['23:20', 'BT', '349', 'RIX', 'A220-300'], ['23:55', 'FR', '1577', 'STN', 'B737-8200'],
  ['00:35', 'FR', '2619', 'BGY', 'B737-800'], ['01:10', 'W6', '1029', 'LTN', 'A321neo'],
];

// ---------- geo ----------
const R = 6371, rad = (d) => (d * Math.PI) / 180;
export function geoFromVNO(lat, lon) {
  const p1 = rad(VNO.lat), p2 = rad(lat), dl = rad(lon - VNO.lon);
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(a));
  const bearing = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  // Azimuthal equidistant projection centred on VNO: every route into VNO is a straight radial line.
  return { dist, bearing, x: dist * Math.sin(bearing), y: -dist * Math.cos(bearing) };
}
for (const ap of Object.values(AIRPORTS)) Object.assign(ap, geoFromVNO(ap.lat, ap.lon));

// ---------- time zone helpers ----------
const dtfParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function parts(ts) {
  const o = {};
  for (const p of dtfParts.formatToParts(new Date(ts))) o[p.type] = +p.value;
  return o;
}
export function tzOffsetMin(ts) {
  const p = parts(ts);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts) / 60000);
}
export function localDayStart(ts) {
  const p = parts(ts);
  const guess = Date.UTC(p.year, p.month - 1, p.day) - tzOffsetMin(ts) * 60000;
  return Date.UTC(p.year, p.month - 1, p.day) - tzOffsetMin(guess) * 60000;
}
export function localYMD(ts) {
  const p = parts(ts);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// ---------- seeded RNG ----------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60000;
const SMALL = /ATR|CRJ|E17|E19/;

function buildDay(dayStart) {
  const key = localYMD(dayStart + 12 * 3600000);
  return SCHEDULE.map(([t, al, num, from, aircraft]) => {
    const [h, m] = t.split(':').map(Number);
    const sched = dayStart + ((h < 4 ? 24 : 0) + h) * 3600000 + m * MIN;
    const r = rng(`${key}|${al}${num}`);
    const ap = AIRPORTS[from];
    const roll = r();
    let delay = 0, cancelled = false;
    if (roll < 0.012) cancelled = true;
    else if (roll < 0.62) delay = Math.round(r() * 9 - 6);
    else if (roll < 0.88) delay = 5 + Math.round(r() * 12);
    else if (roll < 0.97) delay = 20 + Math.round(r() * 25);
    else delay = 60 + Math.round(r() * 50);
    const block = Math.round(ap.dist / 790 * 60 + 24);
    const taxi = 4 + Math.round(r() * 4);
    const deplane = SMALL.test(aircraft) ? 5 : 7 + Math.round(r() * 2);
    const border = ap.schengen ? [0, 0] : [6 + Math.round(r() * 4), 16 + Math.round(r() * 8)];
    const bagsFirst = taxi + 10 + Math.round(r() * 4);
    const bagsLast = bagsFirst + 8 + Math.round(r() * 5);
    return {
      id: `${al}${num}-${localYMD(sched)}`,
      demo: true,
      airline: al, number: num, flightNo: `${al} ${num}`,
      from, aircraft,
      belt: 1 + Math.floor(r() * 4),
      stand: String(1 + Math.floor(r() * 14)),
      sched, block, cancelled,
      _delay: delay, _depDelay: Math.max(0, delay + Math.round(r() * 8 - 3)),
      ground: { taxi, deplane, border, bagsFirst, bagsLast },
    };
  });
}

// Snapshot of the demo world at time `now` (what a real API would return).
function demoSnapshot(now) {
  const d0 = localDayStart(now);
  const all = [...buildDay(localDayStart(d0 - 12 * 3600000)), ...buildDay(d0), ...buildDay(localDayStart(d0 + 36 * 3600000))];
  return all
    .filter((f) => f.sched > now - 6 * 3600000 && f.sched < now + 20 * 3600000)
    .map((f) => {
      const truth = f.sched + f._delay * MIN;
      const dep = f.sched - f.block * MIN + f._depDelay * MIN;
      // Estimates get more accurate as the flight approaches.
      const minsOut = Math.max(0, (truth - now) / MIN);
      const err = minsOut > 0 ? (rng(`${f.id}|${Math.floor(now / (5 * MIN))}`)() - 0.5) * Math.min(1, minsOut / 90) * 8 : 0;
      // Far-out flights show the timetable; delays/cancellations surface a few hours ahead, like real feeds.
      const known = f.sched - now < 4 * 3600000;
      const est = known ? truth + Math.round(err) * MIN : f.sched;
      const cancelled = f.cancelled && f.sched - now < 6 * 3600000;
      const out = { ...f, cancelled, dep: known ? dep : f.sched - f.block * MIN, est: cancelled ? null : est, actual: !f.cancelled && now >= truth ? truth : null, departed: now >= dep && !f.cancelled };
      if (f.cancelled && !cancelled) out.est = f.sched;
      delete out._delay; delete out._depDelay;
      return out;
    })
    .sort((a, b) => a.sched - b.sched);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DataError extends Error {
  constructor(code, message, extra = {}) { super(message || code); this.code = code; Object.assign(this, extra); }
}

// source: 'live' | 'demo'
export async function fetchArrivals(source = 'live', { force = false } = {}) {
  if (source === 'live') {
    if (!navigator.onLine) throw new DataError('offline');
    let res;
    try {
      res = await fetch(`${CONFIG.dataUrl}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout?.(CONFIG.timeoutMs) });
    } catch { throw new DataError('network'); }
    if (!res.ok) throw new DataError(res.status === 404 ? 'no-data' : 'network');
    const json = await res.json().catch(() => null);
    if (!json || !Array.isArray(json.flights)) throw new DataError('no-data');
    return {
      source: 'live', provider: json.source, fetchedAt: json.fetchedAt, usage: json.usage || null, lastAttempt: json.lastAttempt || null, opensky: json.opensky || null,
      flights: json.flights.map(normalizeLive),
    };
  }
  if (!navigator.onLine) throw new DataError('offline');
  await sleep(220 + Math.random() * 300); // feel of a real request
  const now = Date.now();
  return { fetchedAt: now, source: 'demo', flights: demoSnapshot(now) };
}

function groundFor(schengen, aircraft) {
  const small = SMALL.test(aircraft || '');
  return schengen
    ? { taxi: 6, deplane: small ? 5 : 7, border: [0, 0], bagsFirst: 16, bagsLast: 28 }
    : { taxi: 6, deplane: small ? 5 : 7, border: [8, 20], bagsFirst: 18, bagsLast: 30 };
}
function airportOf(f) {
  return AIRPORTS[f.from] || {
    iata: f.from, city: f.fromName || f.from, name: f.fromName || f.from,
    schengen: f.schengen ?? true, dist: null, x: null, y: null,
  };
}

// Server already converted times to epoch ms; fill in what the client derives.
function normalizeLive(f) {
  const ap = airportOf(f);
  const block = ap.dist != null ? Math.round(ap.dist / 790 * 60 + 24) : 120;
  return { ...f, dep: f.dep ?? f.sched - block * MIN, block, ground: groundFor(ap.schengen, f.aircraft) };
}

// ---------- derived state ----------
// Combines a snapshot record with the current clock for display.
// Text is produced by the UI from `status` / `phase` keys (see i18n.js).
export function derive(f, now = Date.now()) {
  const ap = airportOf(f);
  const known = AIRLINES[f.airline];
  const al = { name: known?.name || f.airlineName || f.airline, color: known?.color || airlineColor(f.airline) };
  const arr = f.actual ?? f.est;
  const delay = arr ? Math.round((arr - f.sched) / MIN) : 0;
  const g = f.ground;
  const exitFrom = arr ? arr + (g.taxi + g.deplane + g.border[0]) * MIN : null;
  const exitTo = arr ? arr + (Math.max(g.taxi + g.deplane + g.border[1], g.bagsLast) + 5) * MIN : null;

  let phase, assumed = false;
  if (f.diverted) phase = 'diverted';
  else if (f.cancelled) phase = 'cancelled';
  else if (f.actual) phase = now >= exitTo ? 'arrived' : 'landed';
  else if (now >= arr + 5 * MIN) { phase = now >= exitTo ? 'arrived' : 'landed'; assumed = true; } // ETA passed, no confirmation yet
  else if (!f.departed && now < f.dep) phase = 'scheduled';
  else if (arr - now <= 12 * MIN) phase = 'approach';
  else phase = 'enroute';

  const airborne = phase === 'enroute' || phase === 'approach';
  const progress = airborne ? Math.min(0.995, Math.max(0, (now - f.dep) / (arr - f.dep)))
    : phase === 'landed' || phase === 'arrived' ? 1 : 0;

  // Real position (if the provider sends one) wins over the time-based estimate.
  let pos = null;
  if (airborne && f.pos && f.pos.lat != null) {
    // Real fix from OpenSky, then dead-reckoned along the great circle so it reaches VNO at the ETA.
    const p0 = geoFromVNO(f.pos.lat, f.pos.lon);
    const span = arr - (f.pos.at || now);
    const k = span > 0 ? Math.min(1, Math.max(0, (arr - now) / span)) : 0;
    pos = { x: p0.x * k, y: p0.y * k, dist: p0.dist * k, real: true };
  } else if (airborne && ap.x != null) pos = { x: ap.x * (1 - progress), y: ap.y * (1 - progress), dist: ap.dist * (1 - progress) };

  let tone = 'ok', status = { key: 'ontime' };
  if (phase === 'diverted') { tone = 'bad'; status = { key: 'diverted' }; }
  else if (phase === 'cancelled') { tone = 'bad'; status = { key: 'cancelled' }; }
  else if (phase === 'landed') status = { key: assumed ? 'likely' : 'landed' };
  else if (phase === 'arrived') { tone = 'muted'; status = { key: 'arrived' }; }
  else if (delay >= 30) { tone = 'bad'; status = { key: 'delayed', n: delay }; }
  else if (delay >= 5) { tone = 'warn'; status = { key: 'late', n: delay }; }
  else if (delay <= -5) status = { key: 'early', n: -delay };

  return {
    ...f, ap, al, arr, delay, phase, assumed, tone, status, progress, exitFrom, exitTo,
    pos, remainingKm: pos ? Math.round(pos.dist) : null,
  };
}
