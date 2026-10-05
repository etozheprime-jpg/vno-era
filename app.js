// VNO Era — app shell, views, alerts, install, offline.
import { TZ, CONFIG, fetchArrivals, derive, githubRepo } from './data.js';
import { Radar } from './map.js';
import { t, setLang, lang, locale, LANGS } from './i18n.js';

const VERSION = '1.4.0';
const MIN = 60000;
const TABS = ['home', 'arrivals', 'map', 'watch', 'settings'];
const MAP_RANGES = [800, 1600, 2600, 3800];
const PREF_KEYS = ['t60', 't30', 't15', 'landed', 'delayed', 'exit'];
const DEFAULT_PREFS = { t60: false, t30: true, t15: false, landed: true, delayed: true, exit: true };
const LIVE_FRESH_MS = 15 * MIN;

// ---------- utils ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const icon = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const store = {
  get(k, d) { try { const v = localStorage.getItem('vno.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vno.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const fmtT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtYMD = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
let fmtDay;
const tm = (ts) => (ts ? fmtT.format(ts) : '—');
function cdText(ms) {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
function rel(ms) {
  if (ms <= 30000) return t('time.now');
  const m = Math.ceil(ms / MIN);
  return m < 60 ? t('time.inMin', { m }) : t('time.inHM', { h: Math.floor(m / 60), m: pad(m % 60) });
}
function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return t('time.justNow');
  if (s < 60) return t('time.agoS', { n: s });
  const m = Math.round(s / 60);
  return m < 60 ? t('time.agoM', { n: m }) : t('time.agoHM', { h: Math.floor(m / 60), m: pad(m % 60) });
}
function agoShort(ts, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ts) / MIN));
  return m < 60 ? t('time.agoM', { n: m }) : t('time.agoH', { h: Math.floor(m / 60) });
}
const dur = (min) => t('time.dur', { h: Math.floor(min / 60), m: pad(Math.round(min % 60)) });
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const haptic = () => { if (settings.haptics && navigator.vibrate) try { navigator.vibrate(8); } catch { /* ignore */ } };
const statusText = (f) => t('status.' + f.status.key, { n: f.status.n });
const phaseText = (f) => t('phase.' + f.phase);
const vno = () => t('city.vno');
function errText(code = '') {
  if (t(`err.${code}`) !== `err.${code}`) return t(`err.${code}`);
  if (/key/i.test(code)) return t('err.invalid_key');
  if (/limit|quota/i.test(code)) return t('err.monthly_limit');
  return t('err.generic');
}

// ---------- state ----------
const settings = Object.assign({ theme: 'system', fx: 'auto', interval: 60, haptics: true, lang: 'lt', source: 'live' }, store.get('settings', {}));
const state = {
  snapshot: store.get('snapshot.' + settings.source, null),
  error: null, fails: 0,
  tab: 'home',
  filter: 'upcoming', query: '',
  watch: store.get('watch', {}),
  fired: store.get('fired', {}),
  mapRange: 1600, mapSel: null, map3d: null,
  autoLite: false,
};
const mounted = {};
const scrollPos = {};
let radar = null, miniRadar = null;
let deferredPrompt = null;
let wakeLock = null, wantWake = false;

const saveSettings = () => store.set('settings', settings);
const saveWatch = () => { store.set('watch', state.watch); updateBadge(); };

function flights(now = Date.now()) {
  return state.snapshot ? state.snapshot.flights.map((f) => derive(f, now)) : [];
}
const byId = (id, now) => flights(now).find((f) => f.id === id);
const isActive = (f) => ['scheduled', 'enroute', 'approach'].includes(f.phase);
const isDone = (f) => f.phase === 'landed' || f.phase === 'arrived';
const isOff = (f) => f.phase === 'cancelled' || f.phase === 'diverted';
const nextArrival = (fl) => fl.filter(isActive).sort((a, b) => a.arr - b.arr)[0] || null;
const isLive = () => state.snapshot?.source === 'live';

// ---------- language ----------
function applyLang() {
  setLang(settings.lang);
  fmtDay = new Intl.DateTimeFormat(locale(), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
function remountAll() {
  radar?.destroy(); miniRadar?.destroy();
  radar = miniRadar = null;
  for (const k of Object.keys(mounted)) delete mounted[k];
  for (const tab of TABS) viewEl(tab).innerHTML = '';
  renderActive();
  if (sheetOpen) renderSheet();
  renderNet();
}
const radarLabels = () => ({ km: t('u.km'), north: t('map.north'), aria: t('map.aria') });

// ---------- effects / theme ----------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const lowEnd = () => (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) || navigator.connection?.saveData;
const isLite = () => settings.fx === 'lite' || (settings.fx === 'auto' && (lowEnd() || state.autoLite));
function applyFx() {
  const root = document.documentElement;
  root.classList.toggle('lite', isLite());
  root.classList.toggle('no-motion', reduceMotion.matches);
  radar?.set3D(state.map3d ?? (!isLite() && !reduceMotion.matches));
}
function probeFps() {
  if (settings.fx !== 'auto' || reduceMotion.matches || document.hidden) return;
  let frames = 0, slow = 0, last = performance.now();
  const t0 = last;
  const step = (ts) => {
    if (ts - last > 34) slow++;
    last = ts; frames++;
    if (ts - t0 < 1500) requestAnimationFrame(step);
    else if (frames > 10 && slow / frames > 0.25) { state.autoLite = true; applyFx(); }
  };
  requestAnimationFrame(step);
}
function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'system') delete root.dataset.theme; else root.dataset.theme = settings.theme;
  const metas = $$('meta[name="theme-color"]');
  if (settings.theme === 'system') { metas[0].content = '#070B14'; metas[1].content = '#F3F5F9'; } else {
    const c = settings.theme === 'dark' ? '#070B14' : '#F3F5F9';
    metas.forEach((m) => (m.content = c));
  }
}

// ---------- shared fragments ----------
function routeHTML(f) {
  return `<div class="route">
    <div class="ap"><b>${esc(f.from)}</b><span>${esc(f.ap.city)}</span></div>
    <div class="track ${isDone(f) ? 'is-landed' : ''}" style="--p:${f.progress.toFixed(3)}"><div class="track-fill"></div>${icon('plane')}</div>
    <div class="ap end"><b>VNO</b><span>${vno()}</span></div>
  </div>`;
}
const exitText = (f) => (f.exitFrom ? `${tm(f.exitFrom)}–${tm(f.exitTo)}` : '—');
const isWatched = (id) => !!state.watch[id];

function subText(f, now) {
  if (isOff(f)) return '';
  if (isDone(f)) return t('landedAt', { t: (f.assumed ? '≈ ' : '') + tm(f.arr) });
  if (f.arr - now <= 30000) return t('due');
  return `<span data-rel="${f.arr}">${rel(f.arr - now)}</span>`;
}

function rowHTML(f, now) {
  const changed = Math.abs(f.delay) >= 5 && !isOff(f);
  const past = f.phase === 'arrived' || isOff(f);
  return `<button class="row ${past ? 'is-past' : ''}" data-action="open-flight" data-id="${esc(f.id)}">
    <div class="row-time"><b>${tm(changed ? f.arr : f.sched)}</b>${changed ? `<s>${tm(f.sched)}</s>` : ''}</div>
    <div class="row-main">
      <div class="row-fno" style="--al:${f.al.color}"><i></i>${esc(f.flightNo)}${isWatched(f.id) ? icon('bell', 'fill') : ''}</div>
      <div class="row-city">${esc(f.ap.name)}</div>
    </div>
    <div class="row-status"><span class="pill tone-${f.tone}">${esc(statusText(f))}</span><small>${subText(f, now)}</small></div>
  </button>`;
}

function updatedHTML(now) {
  const s = state.snapshot;
  if (!s?.fetchedAt) return '';
  const src = s.source === 'live' ? t('src.live') : t('src.demo');
  const owner = s.source === 'live' && ownerToken() && githubRepo();
  return `<span>${src} · ${t('updated', { ago: `<span data-ago="${s.fetchedAt}">${ago(s.fetchedAt, now)}</span>` })}</span>
    <button data-action="refresh">${icon('refresh')}${t('refresh')}</button>
    ${owner ? `<button data-action="owner-update" ${ownerUpdating ? 'disabled' : ''}>${icon('download')}API ${usageToday().count}/${usageToday().max}</button>` : ''}`;
}

// ---------- HOME ----------
function mountHome(v) {
  v.innerHTML = `<div class="home-grid">
    <div id="homeMain"></div>
    <div>
      <div id="homeList"></div>
      <div class="section-head"><h2 class="section-title">${t('home.map')}</h2><button class="link-btn" data-action="go" data-tab="map">${t('open')} ${icon('chev')}</button></div>
      <button class="card mini-map" data-action="go" data-tab="map" aria-label="${esc(t('home.openMap'))}">
        <div class="radar-host" id="miniRadar"></div>
        <div class="mini-map-cap"><span id="miniCap"></span></div>
      </button>
      <div class="updated" id="homeUpdated"></div>
    </div>
  </div>`;
  miniRadar = new Radar($('#miniRadar'), { mini: true, range: 1800, labels: radarLabels() });
}

function heroHTML(f, now) {
  if (!f) {
    return `<div class="card hero"><div class="empty"><div class="empty-ic">${icon('land')}</div><h3>${t('home.noMoreT')}</h3><p>${t('home.noMoreX')}</p></div></div>`;
  }
  const ms = f.arr - now;
  const delayed = Math.abs(f.delay) >= 5;
  return `<article class="hero card" role="button" tabindex="0" data-action="open-flight" data-id="${esc(f.id)}" aria-label="${esc(t('home.aria', { f: f.flightNo, c: f.ap.city }))}">
    <div class="hero-top"><span class="eyebrow">${t('home.next')}</span><span class="pill lg tone-${f.tone}">${esc(statusText(f))}</span></div>
    <div class="hero-flight"><span class="hero-fno">${esc(f.flightNo)}</span><span class="al" style="--al:${f.al.color}"><i></i>${esc(f.al.name)}</span></div>
    ${routeHTML(f)}
    <div class="hero-cd">
      <div class="eyebrow">${f.phase === 'approach' ? t('home.landingIn') : t('home.arrivesIn')}</div>
      <div class="cd num" data-cd="${f.arr}">${cdText(ms)}</div>
      <div class="cd-units">${ms >= 3600000 ? `<span>${t('cd.hrs')}</span>` : ''}<span>${t('cd.min')}</span><span>${t('cd.sec')}</span></div>
    </div>
    <div class="hero-times">
      <span>${t('home.sched')} ${delayed ? `<s>${tm(f.sched)}</s>` : `<b>${tm(f.sched)}</b>`}</span>
      ${delayed ? `<span>${t('home.expected')} <b>${tm(f.arr)}</b></span>` : ''}
      <span>${esc(phaseText(f))}</span>
    </div>
    <div class="exit">${icon('exit')}<div><small>${t('exit.title')}</small><b>≈ ${exitText(f)}</b></div></div>
  </article>`;
}

function qaHTML(f) {
  if (!f) return '';
  const w = isWatched(f.id);
  return `<div class="qa">
    <button class="${w ? 'is-on' : ''}" data-action="watch" data-id="${esc(f.id)}" aria-pressed="${w}"><span class="qa-ic">${icon('bell')}</span><span>${w ? t('qa.watching') : t('qa.watch')}</span></button>
    <button data-action="route" data-id="${esc(f.id)}"><span class="qa-ic">${icon('route')}</span><span>${t('qa.route')}</span></button>
    <button data-action="wait" data-id="${esc(f.id)}"><span class="qa-ic">${icon('clock')}</span><span>${t('qa.wait')}</span></button>
    <button data-action="open-flight" data-id="${esc(f.id)}"><span class="qa-ic">${icon('open')}</span><span>${t('qa.details')}</span></button>
  </div>`;
}

const skeletonHTML = () => `<div class="sk hero-sk"></div><div class="qa">${'<div class="sk" style="height:64px"></div>'.repeat(4)}</div>`;

function noDataHTML() {
  return `<div class="card hero"><div class="empty"><div class="empty-ic">${icon('offline')}</div><h3>${t('home.noDataT')}</h3>
    <p>${esc(errText(state.error.code))}</p><br>
    <button class="btn primary" data-action="set" data-key="source" data-value="demo">${t('home.useDemo')}</button></div></div>`;
}

function updateHome(now) {
  const fl = flights(now);
  const main = $('#homeMain');
  if (!state.snapshot) {
    main.innerHTML = state.error && state.error.code !== 'offline' ? noDataHTML() : skeletonHTML();
    $('#homeList').innerHTML = state.error ? '' : `<div class="section-head"><h2 class="section-title">${t('home.nextList')}</h2></div>${'<div class="sk row-sk"></div>'.repeat(3)}`;
    $('#miniCap').textContent = t('inAir', { n: 0 });
    return;
  }
  const hero = nextArrival(fl);
  main.innerHTML = heroHTML(hero, now) + qaHTML(hero);
  const next = fl.filter((f) => isActive(f) && f !== hero).sort((a, b) => a.arr - b.arr).slice(0, 4);
  $('#homeList').innerHTML = `<div class="section-head"><h2 class="section-title">${t('home.nextList')}</h2><button class="link-btn" data-action="go" data-tab="arrivals">${t('all')} ${icon('chev')}</button></div>
    <div class="list">${next.map((f) => rowHTML(f, now)).join('') || `<p class="fine">${t('home.noFurther')}</p>`}</div>`;
  $('#homeUpdated').innerHTML = updatedHTML(now);
  const info = miniRadar.update(fl, now);
  $('#miniCap').textContent = t('inAir', { n: info.airborne });
}

// ---------- ARRIVALS ----------
const FILTERS = [
  ['upcoming', (f, now) => isActive(f) || (f.phase === 'landed' && now - f.arr < 30 * MIN)],
  ['air', (f) => f.phase === 'enroute' || f.phase === 'approach'],
  ['landed', (f) => isDone(f)],
  ['delayed', (f) => f.delay >= 15 || isOff(f)],
  ['all', () => true],
];
function mountArrivals(v) {
  v.innerHTML = `<div class="view-head"><div><h1 class="view-title">${t('tab.arrivals')}</h1><div class="view-sub" id="arrSub"></div></div></div>
    <label class="search">${icon('search')}<span class="sr">${t('arr.searchLabel')}</span>
      <input id="arrSearch" type="search" inputmode="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${esc(t('arr.search'))}" enterkeyhint="search"></label>
    <div class="chips-scroll" id="arrChips" role="toolbar" aria-label="${esc(t('arr.filter'))}"></div>
    <div id="arrList" style="margin-top:6px"></div>
    <div class="updated" id="arrUpdated"></div>`;
  const input = $('#arrSearch');
  input.value = state.query;
  input.addEventListener('input', () => { state.query = input.value; updateArrivals(Date.now()); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
}
function updateArrivals(now) {
  const fl = flights(now);
  $('#arrSub').textContent = t('arr.sub', { day: fmtDay.format(now) });
  $('#arrChips').innerHTML = FILTERS.map(([k, fn]) =>
    `<button class="chip" data-action="filter" data-filter="${k}" aria-pressed="${state.filter === k}">${t('f.' + k)}<b>${fl.filter((f) => fn(f, now)).length}</b></button>`).join('');
  const list = $('#arrList');
  if (!state.snapshot) { list.innerHTML = state.error ? '' : '<div class="sk row-sk"></div>'.repeat(6); return; }
  const fn = FILTERS.find((x) => x[0] === state.filter)[1];
  const q = state.query.trim().toLowerCase().replace(/\s+/g, '');
  const rows = fl.filter((f) => fn(f, now)).filter((f) => !q || [f.flightNo, f.ap.city, f.ap.name, f.from, f.al.name].some((s) => String(s).toLowerCase().replace(/\s+/g, '').includes(q)));
  if (!rows.length) {
    list.innerHTML = `<div class="empty"><div class="empty-ic">${icon('search')}</div><h3>${t('arr.none')}</h3><p>${q ? t('arr.noMatch') : t('arr.noCat')}</p></div>`;
  } else {
    let html = '', lastKey = '';
    const today = fmtYMD.format(now);
    for (const f of rows) {
      const day = fmtYMD.format(f.sched);
      const key = `${day} ${tm(f.sched).slice(0, 2)}`;
      if (key !== lastKey) {
        html += `<div class="hour-label">${day === today ? '' : `${day > today ? t('tomorrow') : t('yesterday')} · `}${tm(f.sched).slice(0, 2)}:00</div>`;
        lastKey = key;
      }
      html += rowHTML(f, now);
    }
    list.innerHTML = `<div class="list">${html}</div>`;
  }
  $('#arrUpdated').innerHTML = updatedHTML(now);
}

// ---------- MAP ----------
function mountMap(v) {
  v.innerHTML = `<div class="view-head"><div><h1 class="view-title">${t('tab.map')}</h1><div class="view-sub" id="mapSub"></div></div></div>
    <div class="mapv">
      <div class="card map-card">
        <div class="radar-host" id="bigRadar"></div>
        <div class="map-legend"><span id="mapLegend">${t('map.estimated')}</span></div>
        <div class="map-range" id="mapRange"></div>
        <div id="mapSel"></div>
        <div class="map-tools">
          <button data-action="map-3d" id="map3dBtn" aria-label="${esc(t('map.3d'))}">${icon('cube')}</button>
          <button data-action="map-zoom" data-dir="-1" aria-label="${esc(t('map.zoomIn'))}">${icon('plus')}</button>
          <button data-action="map-zoom" data-dir="1" aria-label="${esc(t('map.zoomOut'))}">${icon('minus')}</button>
        </div>
      </div>
      <div>
        <div class="section-head" style="margin-top:8px"><h2 class="section-title">${t('f.air')}</h2></div>
        <div class="chips-scroll" id="airList"></div>
      </div>
      <p class="fine">${t('map.note')}</p>
    </div>`;
  radar = new Radar($('#bigRadar'), {
    range: state.mapRange, labels: radarLabels(),
    onSelect: (id) => { state.mapSel = id; haptic(); updateMap(Date.now()); },
  });
  if (state.mapSel) radar.select(state.mapSel);
  applyFx();
}
function updateMap(now, light = false) {
  if (!radar) return;
  const fl = flights(now);
  const info = radar.update(fl, now);
  if (light) return;
  const sel = state.mapSel && fl.find((f) => f.id === state.mapSel);
  const extra = [info.hidden ? t('map.beyond', { n: info.hidden }) : '', info.noPos ? t('map.noPos', { n: info.noPos }) : ''].filter(Boolean).join(' · ');
  $('#mapSub').textContent = t('inAir', { n: info.airborne });
  const os = state.snapshot?.opensky;
  $('#mapLegend').textContent = os?.at && !os.error && fl.some((f) => f.pos?.real) ? t('map.osLegend', { t: tm(os.at) }) : t('map.estimated');
  $('#mapRange').textContent = t('map.range', { km: state.mapRange }) + (extra ? ` · ${extra}` : '');
  $('#map3dBtn').classList.toggle('is-on', radar.host.classList.contains('is-3d'));
  $('#mapSel').innerHTML = sel ? `<button class="map-sel" data-action="open-flight" data-id="${esc(sel.id)}">
      <div class="map-sel-main"><b>${esc(sel.flightNo)}</b> <span class="pill tone-${sel.tone}" style="height:22px;font-size:12px">${esc(statusText(sel))}</span>
      <div>${esc(sel.ap.city)} · ${sel.remainingKm != null ? `${sel.remainingKm} ${t('u.km')} · ` : ''}${isDone(sel) ? t('map.landed', { t: tm(sel.arr) }) : t('map.eta', { t: tm(sel.arr) })}</div></div>
      ${icon('chev')}</button>` : '';
  const air = fl.filter((f) => f.phase === 'enroute' || f.phase === 'approach').sort((a, b) => a.arr - b.arr);
  $('#airList').innerHTML = air.length ? air.map((f) => `<button class="air-card ${f.id === state.mapSel ? 'is-sel' : ''}" data-action="map-select" data-id="${esc(f.id)}">
      <b>${esc(f.flightNo)}</b><span>${esc(f.ap.city)}${f.remainingKm != null ? ` · ${f.remainingKm} ${t('u.km')}` : ''}</span><em class="num" data-cd="${f.arr}">${cdText(f.arr - now)}</em></button>`).join('')
    : `<p class="fine" style="margin:0">${t('map.none')}</p>`;
}

// ---------- WATCHLIST ----------
function notifCap() {
  if (!('Notification' in window)) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  return Notification.permission; // default | granted | denied
}
function capNotice(compact = false) {
  const c = notifCap();
  if (c === 'granted') return compact ? '' : `<div class="notice">${icon('check')}<div>${t('cap.granted')}</div></div>`;
  if (c === 'default') return `<div class="notice">${icon('bell')}<div>${t('cap.default')}<br><button class="btn primary" data-action="enable-notif">${t('cap.enable')}</button></div></div>`;
  if (c === 'denied') return `<div class="notice warn">${icon('bell')}<div>${t('cap.denied')}</div></div>`;
  if (c === 'ios-install') return `<div class="notice warn">${icon('phone')}<div>${t('cap.ios')}<br><button class="btn" data-action="install-ios">${t('cap.howInstall')}</button></div></div>`;
  return `<div class="notice warn">${icon('bell')}<div>${t('cap.unsupported')}</div></div>`;
}
function mountWatch(v) {
  v.innerHTML = `<div class="view-head"><div><h1 class="view-title">${t('watch.title')}</h1><div class="view-sub">${t('watch.sub')}</div></div></div><div id="watchCap"></div><div id="watchList"></div>`;
}
const TAG = { t60: () => `60 ${t('u.min')}`, t30: () => `30 ${t('u.min')}`, t15: () => `15 ${t('u.min')}`, landed: () => t('tag.landed'), delayed: () => t('tag.delayed'), exit: () => t('tag.exit') };
function updateWatch(now) {
  const ids = Object.keys(state.watch);
  $('#watchCap').innerHTML = ids.length ? capNotice(true) : '';
  if (!ids.length) {
    $('#watchList').innerHTML = `<div class="empty"><div class="empty-ic">${icon('bell')}</div><h3>${t('watch.emptyT')}</h3><p>${t('watch.emptyX')}</p><br><button class="btn primary" data-action="go" data-tab="arrivals">${icon('land')}${t('watch.browse')}</button></div>`;
    return;
  }
  const fl = flights(now);
  const cards = ids.map((id) => {
    const f = fl.find((x) => x.id === id);
    const p = state.watch[id];
    if (!f) {
      return `<article class="card wcard"><div class="wcard-top"><div><b>${esc(p.flightNo || id)}</b><span>${t('watch.gone')}</span></div></div>
        <div class="wcard-actions" style="grid-template-columns:1fr"><button class="btn danger" data-action="unwatch" data-id="${esc(id)}">${icon('trash')}${t('remove')}</button></div></article>`;
    }
    const on = PREF_KEYS.filter((k) => p[k]).map((k) => `<span class="tag">${TAG[k]()}</span>`).join('');
    const done = isDone(f);
    return `<article class="card wcard">
      <div class="wcard-top"><div><b>${esc(f.flightNo)}</b><span>${esc(f.ap.name)} → ${vno()}</span></div><span class="pill tone-${f.tone}">${esc(statusText(f))}</span></div>
      <div class="wcard-cd">${done || isOff(f) ? `<b class="cd-sm">${isOff(f) ? esc(statusText(f)) : t('landedAt', { t: tm(f.arr) })}</b>` : `<b class="cd-sm num" data-cd="${f.arr}">${cdText(f.arr - now)}</b>`}
        <small>${done ? t('d.landed') : t('d.expected')} ${tm(f.arr)}<br>${t('exitShort', { t: exitText(f) })}</small></div>
      <div class="wcard-tags">${on || `<span class="tag">${t('tag.none')}</span>`}</div>
      <div class="wcard-actions">
        <button class="btn" data-action="open-flight" data-id="${esc(f.id)}">${t('details')}</button>
        <button class="btn" data-action="notify-settings" data-id="${esc(f.id)}">${icon('bell')}${t('alerts')}</button>
        <button class="btn icon-only" data-action="unwatch" data-id="${esc(f.id)}" aria-label="${esc(t('watch.stopAria', { f: f.flightNo }))}">${icon('trash')}</button>
      </div></article>`;
  });
  $('#watchList').innerHTML = `<div class="list wlist">${cards.join('')}</div>`;
}

// ---------- SETTINGS ----------
function seg(name, value, options) {
  return `<div class="seg-ctl" role="group">${options.map(([v, l]) => `<button data-action="set" data-key="${name}" data-value="${v}" aria-pressed="${String(value) === String(v)}">${l}</button>`).join('')}</div>`;
}
function mountSettings() { /* rendered fully in update */ }
function updateSettings(now) {
  const c = notifCap();
  const s = state.snapshot;
  const live = settings.source === 'live';
  const link = (action, label, ic = 'chev') => `<button class="srow" data-action="${action}"><div class="srow-main" style="color:var(--accent);font-weight:650">${label}</div>${icon(ic)}</button>`;
  $('[data-view="settings"]').innerHTML = `<div class="view-head"><div><h1 class="view-title">${t('tab.settings')}</h1></div></div>
  <div class="settings-cols"><div>
    <div class="group"><h2 class="group-title">${t('set.language')}</h2><div class="group-body"><div class="srow stack">${seg('lang', settings.lang, LANGS)}</div></div></div>
    <div class="group"><h2 class="group-title">${t('set.data')}</h2><div class="group-body">
      <div class="srow stack"><div class="srow-main">${t('set.source')}</div>${seg('source', settings.source, [['live', t('src.liveOpt')], ['demo', t('src.demoOpt')]])}
        <div class="srow-main"><span>${live ? t('set.liveOwnerDesc') : t('set.demoDesc')}</span></div></div>
      <div class="srow"><div class="srow-main">${t('set.lastUpdated')}</div><span class="srow-val">${s?.fetchedAt ? `<span data-ago="${s.fetchedAt}">${ago(s.fetchedAt, now)}</span>` : '—'}</span></div>
      ${live && s?.usage ? `<div class="srow"><div class="srow-main">${t('set.today')}</div><span class="srow-val">${usageToday().count} / ${usageToday().max}</span></div>
      ${s.usage.quota ? `<div class="srow"><div class="srow-main">${t('set.quotaLeft')}</div><span class="srow-val">${s.usage.quota.remaining} / ${s.usage.quota.limit}</span></div>` : ''}` : ''}
      <div class="srow stack"><div class="srow-main">${t('set.checkEvery')}</div>${seg('interval', settings.interval, [[30, `30 s`], [60, `1 ${t('u.min')}`], [120, `2 ${t('u.min')}`]])}</div>
    </div></div>
    ${live ? ownerGroupHTML(now) : ''}
    <div class="group"><h2 class="group-title">${t('set.notifs')}</h2><div class="group-body">
      <div class="srow"><div class="srow-main">${t('set.sysNotifs')}</div><span class="srow-val">${t('ns.' + c)}</span></div>
      ${c === 'default' ? link('enable-notif', t('cap.enable')) : ''}
      ${c === 'ios-install' ? link('install-ios', t('set.howIOS')) : ''}
      <button class="srow" data-action="test-notif"><div class="srow-main">${t('set.test')}</div>${icon('chev')}</button>
    </div></div>
  </div><div>
    <div class="group"><h2 class="group-title">${t('set.appearance')}</h2><div class="group-body"><div class="srow stack">${seg('theme', settings.theme, [['system', t('theme.system')], ['light', t('theme.light')], ['dark', t('theme.dark')]])}</div></div></div>
    <div class="group"><h2 class="group-title">${t('set.effects')}</h2><div class="group-body">
      <div class="srow stack">${seg('fx', settings.fx, [['auto', t('fx.auto')], ['full', t('fx.full')], ['lite', t('fx.lite')]])}</div>
      <label class="srow"><div class="srow-main">${t('set.haptics')}<span>${t('set.androidOnly')}</span></div><span class="switch"><input type="checkbox" data-setting="haptics" ${settings.haptics ? 'checked' : ''}><i></i></span></label>
    </div><p class="group-note">${t('set.fxNote')}${settings.fx === 'auto' ? ` — ${t('set.currently')} <b>${isLite() ? t('fx.lite') : t('fx.full')}</b>` : ''}.</p></div>
    <div class="group"><h2 class="group-title">${t('set.app')}</h2><div class="group-body">
      ${isStandalone() ? `<div class="srow"><div class="srow-main">${t('set.installed')}</div>${icon('check')}</div>` : link('install', t('set.install'), 'download')}
      <div class="srow"><div class="srow-main">${t('set.version')}</div><span class="srow-val">${VERSION}</span></div>
      <button class="srow" data-action="reset"><div class="srow-main" style="color:var(--bad)">${t('set.reset')}</div></button>
    </div><p class="group-note">${t('set.tzNote', { tz: esc(TZ) })}</p></div>
  </div></div>`;
}

// ---------- view switching ----------
const VIEWS = {
  home: [mountHome, updateHome], arrivals: [mountArrivals, updateArrivals], map: [mountMap, updateMap],
  watch: [mountWatch, updateWatch], settings: [mountSettings, updateSettings],
};
function viewEl(tab) { return $(`[data-view="${tab}"]`); }
function renderActive(now = Date.now()) {
  const [mount, update] = VIEWS[state.tab];
  if (!mounted[state.tab]) { mount(viewEl(state.tab)); mounted[state.tab] = true; }
  update(now);
}
function show(tab) {
  if (!TABS.includes(tab)) tab = 'home';
  if (tab !== state.tab) scrollPos[state.tab] = window.scrollY;
  state.tab = tab;
  for (const tb of TABS) viewEl(tb).hidden = tb !== tab;
  $$('#tabbar button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  renderActive();
  window.scrollTo(0, scrollPos[tab] || 0);
}
function go(tab) {
  if (sheetOpen) { hideSheet(); history.replaceState({ tab }, '', `#/${tab}`); show(tab); return; }
  if (tab === state.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (state.tab === 'home') history.pushState({ tab }, '', `#/${tab}`); else history.replaceState({ tab }, '', `#/${tab}`);
  show(tab);
}
function parseHash() {
  const m = location.hash.match(/^#\/([\w-]+)(?:\/(.+))?$/);
  return m ? { tab: m[1], arg: m[2] && decodeURIComponent(m[2]) } : { tab: 'home' };
}

// ---------- bottom sheet ----------
const sheet = $('#sheet'), sheetBody = $('#sheetBody'), backdrop = $('#backdrop');
let sheetOpen = false, sheetRender = null, lastFocus = null;
function openSheet(render) {
  sheetRender = render;
  renderSheet(true);
  if (sheetOpen) return;
  sheetOpen = true;
  lastFocus = document.activeElement;
  history.pushState({ sheet: 1, tab: state.tab }, '', location.hash);
  sheet.hidden = false; backdrop.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { sheet.classList.add('is-open'); backdrop.classList.add('is-open'); }));
  document.documentElement.style.overflow = 'hidden';
  setTimeout(() => $('.close-btn', sheet)?.focus({ preventScroll: true }), 340);
}
function renderSheet(reset = false) {
  if (!sheetRender) return;
  const st = sheetBody.scrollTop;
  sheetBody.innerHTML = sheetRender(Date.now());
  sheetBody.scrollTop = reset ? 0 : st;
}
function hideSheet() {
  if (!sheetOpen) return;
  sheetOpen = false; sheetRender = null;
  sheet.classList.remove('is-open'); backdrop.classList.remove('is-open');
  document.documentElement.style.overflow = '';
  setTimeout(() => { if (!sheetOpen) { sheet.hidden = true; backdrop.hidden = true; sheetBody.innerHTML = ''; } }, 330);
  lastFocus?.focus?.({ preventScroll: true });
}
function closeSheet() { if (history.state?.sheet) history.back(); else hideSheet(); }

(function sheetDrag() {
  let y0 = null, dy = 0, fromBody = false;
  const desktop = matchMedia('(min-width: 1024px)');
  const start = (y, body) => { if (desktop.matches || (body && sheetBody.scrollTop > 0)) return; y0 = y; dy = 0; fromBody = body; };
  const move = (y, e) => {
    if (y0 == null) return;
    dy = Math.max(0, y - y0);
    if (dy > 6) {
      sheet.classList.add('is-dragging');
      sheet.style.transform = `translateY(${dy}px)`;
      backdrop.style.opacity = String(Math.max(0.2, 1 - dy / 400));
      if (fromBody && e.cancelable) e.preventDefault();
    }
  };
  const end = () => {
    if (y0 == null) return;
    sheet.classList.remove('is-dragging');
    sheet.style.transform = ''; backdrop.style.opacity = '';
    if (dy > 110) closeSheet();
    y0 = null;
  };
  const grab = $('#sheetGrab');
  grab.addEventListener('pointerdown', (e) => { grab.setPointerCapture(e.pointerId); start(e.clientY, false); });
  grab.addEventListener('pointermove', (e) => move(e.clientY, e));
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
  sheetBody.addEventListener('touchstart', (e) => start(e.touches[0].clientY, true), { passive: true });
  sheetBody.addEventListener('touchmove', (e) => { if (y0 != null && e.touches[0].clientY < y0) { y0 = null; return; } move(e.touches[0].clientY, e); }, { passive: false });
  sheetBody.addEventListener('touchend', end);
})();

function sheetHead(eyebrow, title, sub) {
  return `<div class="sheet-head"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h2 id="sheetTitle">${title}</h2>${sub || ''}</div>
    <button class="close-btn" data-action="close-sheet" aria-label="${esc(t('close'))}">${icon('x')}</button></div>`;
}

function detailsHTML(id) {
  return (now) => {
    const f = byId(id, now);
    if (!f) return sheetHead('', t('d.notFound')) + `<p class="fine">${t('d.notFoundX')}</p>`;
    const done = isDone(f);
    const w = isWatched(f.id);
    const g = f.ground;
    const nonS = !f.ap.schengen;
    const s = state.snapshot;
    const srcNote = f.demo ? t('d.demo') : s?.fetchedAt ? t('d.liveSrc', { ago: ago(s.fetchedAt, now) }) : '';
    return `${sheetHead('', esc(f.flightNo), `<div class="al" style="--al:${f.al.color}"><i></i>${esc(f.al.name)}${f.aircraft ? ` · ${esc(f.aircraft)}` : ''}</div>`)}
    <div class="card d-route">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="pill lg tone-${f.tone}">${esc(statusText(f))}</span><span class="eyebrow">${esc(phaseText(f))}</span></div>
      ${routeHTML(f)}
      <div class="d-cd">${done ? `<span class="eyebrow">${t('d.landed')}</span><b class="num">${tm(f.arr)}</b>`
        : isOff(f) ? `<span class="eyebrow">${esc(statusText(f))}</span><b>—</b>`
        : `<span class="eyebrow">${t('home.arrivesIn')}</span><b class="num" data-cd="${f.arr}">${cdText(f.arr - now)}</b>`}</div>
    </div>
    <div class="grid2">
      <div class="kv"><small>${t('d.scheduled')}</small><b>${tm(f.sched)}</b><span>${t('d.vilniusTime')}</span></div>
      <div class="kv"><small>${done ? t('d.landed') : t('d.expected')}</small><b>${isOff(f) ? '—' : tm(f.arr)}</b><span>${f.delay >= 1 ? `+${f.delay} ${t('u.min')}` : f.delay <= -1 ? `−${-f.delay} ${t('u.min')}` : t('d.onSchedule')}</span></div>
      <div class="kv"><small>${f.departed ? t('d.departed') : t('d.departs')}</small><b>${tm(f.dep)}</b><span>${t('d.from', { x: esc(f.from) })}</span></div>
      <div class="kv"><small>${t('d.flight')}</small><b>${f.arr ? dur((f.arr - f.dep) / MIN) : '—'}</b><span>${f.ap.dist != null ? `${Math.round(f.ap.dist).toLocaleString(locale())} ${t('u.km')}` : esc(f.ap.name)}</span></div>
    </div>
    <div class="group-body info-list">
      <div class="srow">${icon('exit')}<div class="srow-main"><b>${t('d.exit', { t: exitText(f) })}</b><span>${t('d.hall')}</span></div></div>
      <div class="srow">${icon('passport')}<div class="srow-main">${nonS ? t('d.passport') : t('d.noPassport')}<span>${nonS ? t('d.nonSchengen', { a: g.border[0], b: g.border[1] }) : t('d.schengen')}</span></div></div>
      <div class="srow">${icon('bag')}<div class="srow-main">${f.belt ? t('d.belt', { n: esc(f.belt) }) : t('d.bags')}<span>${t('d.firstBags', { t: f.arr ? tm(f.arr + g.bagsFirst * MIN) : '—' })}</span></div></div>
    </div>
    <p class="fine">${t('d.fine')} ${srcNote}</p>
    <div class="sheet-foot">
      <button class="btn ${w ? '' : 'primary'}" data-action="watch" data-id="${esc(f.id)}">${icon(w ? 'check' : 'bell')}${w ? t('qa.watching') : t('watch')}</button>
      <button class="btn icon-only" data-action="route" data-id="${esc(f.id)}" aria-label="${esc(t('qa.route'))}">${icon('route')}</button>
      <button class="btn icon-only" data-action="wait" data-id="${esc(f.id)}" aria-label="${esc(t('qa.wait'))}">${icon('clock')}</button>
      <button class="btn icon-only" data-action="share" data-id="${esc(f.id)}" aria-label="${esc(t('share'))}">${icon('share')}</button>
    </div>`;
  };
}

function waitHTML(id) {
  return (now) => {
    const f = byId(id, now);
    if (!f || !f.arr) return sheetHead(t('qa.wait'), t('w.na')) + `<p class="fine">${t('w.naX')}</p>`;
    const g = f.ground;
    const stand = f.arr + g.taxi * MIN;
    const nonS = !f.ap.schengen;
    const steps = [
      [f.dep, f.departed ? t('w.departed', { x: esc(f.from) }) : t('w.departs', { x: esc(f.from) }), tm(f.dep)],
      [f.arr, t('w.touchdown'), `${tm(f.arr)}${f.arr > now ? ` · <span data-rel="${f.arr}">${rel(f.arr - now)}</span>` : ''}`],
      [stand, t('w.stand'), `≈ ${tm(stand + 2 * MIN)}`],
      ...(nonS ? [[stand + (g.deplane + g.border[0]) * MIN, t('d.passport'), `≈ ${tm(stand + g.deplane * MIN)}–${tm(stand + (g.deplane + g.border[1]) * MIN)}`]] : []),
      [f.arr + g.bagsFirst * MIN, f.belt ? t('w.bags', { n: esc(f.belt) }) : t('w.bagsAny'), `≈ ${tm(f.arr + g.bagsFirst * MIN)}–${tm(f.arr + g.bagsLast * MIN)}`],
      [f.exitFrom, t('w.exit'), `≈ ${exitText(f)}`, true],
    ];
    const waitMin = Math.round((f.exitTo - f.exitFrom) / MIN);
    const canWake = 'wakeLock' in navigator;
    return `${sheetHead(t('qa.wait'), esc(f.flightNo), `<div class="al">${esc(f.ap.city)} → ${vno()}</div>`)}
      <div class="card wait-big"><span class="eyebrow">${t('w.beBy')}</span><b class="num">${tm(f.exitFrom)}</b>
        <span>${t('w.mostOut', { t: tm(f.exitTo), n: waitMin })}</span></div>
      <ol class="tl">${steps.map(([ts, label, val, key], i) => {
        const next = steps[i + 1]?.[0];
        const cls = key ? 'is-key' : ts <= now && (!next || next > now) ? 'is-now' : ts <= now ? 'is-done' : '';
        return `<li class="${cls}"><span class="dot"></span><b>${label}</b><span>${val}</span></li>`;
      }).join('')}</ol>
      ${nonS ? '' : `<p class="fine" style="margin-top:0">${t('w.schengen')}</p>`}
      ${canWake ? `<div class="group-body"><label class="srow"><div class="srow-main">${t('w.keepOn')}<span>${t('w.keepOnSub')}</span></div><span class="switch"><input type="checkbox" data-wake ${wantWake ? 'checked' : ''}><i></i></span></label></div>` : ''}
      <p class="fine">${t('w.fine')}</p>
      <div class="sheet-foot"><button class="btn ${isWatched(f.id) ? '' : 'primary'}" data-action="watch" data-id="${esc(f.id)}">${icon('bell')}${isWatched(f.id) ? t('alerts') : t('w.notify')}</button><button class="btn" data-action="close-sheet">${t('done')}</button></div>`;
  };
}

function notifySheetHTML(id) {
  return (now) => {
    const f = byId(id, now);
    const p = state.watch[id];
    if (!p) return sheetHead(t('n.eyebrow'), t('n.notWatching')) + `<p class="fine">${t('n.notWatchingX')}</p>`;
    return `${sheetHead(t('n.eyebrow'), esc(f?.flightNo || p.flightNo), f ? `<div class="al">${esc(f.ap.city)} → ${vno()} · ${tm(f.arr)}</div>` : '')}
      ${capNotice()}
      <div class="group-body">${PREF_KEYS.map((k) => `<label class="srow"><div class="srow-main">${t('pref.' + k)}</div><span class="switch"><input type="checkbox" role="switch" data-pref="${k}" data-id="${esc(id)}" ${p[k] ? 'checked' : ''}><i></i></span></label>`).join('')}</div>
      <p class="fine">${t('n.fine')}</p>
      <div class="sheet-foot"><button class="btn danger" data-action="unwatch" data-id="${esc(id)}">${t('n.stop')}</button><button class="btn primary" data-action="close-sheet">${t('done')}</button></div>`;
  };
}

function installIOSHTML() {
  return () => `${sheetHead(t('install'), t('i.iosTitle'))}
    <div class="notice">${icon('phone')}<div>${t('i.iosNote')}</div></div>
    <ol class="steps">
      <li><span>${t('i.s1', { icon: icon('ios-share') })}</span></li>
      <li><span>${t('i.s2', { icon: icon('add-square') })}</span></li>
      <li><span>${t('i.s3')}</span></li>
    </ol>
    <p class="fine">${t('i.chrome')}</p>
    <div class="sheet-foot"><button class="btn" data-action="install-later">${t('i.later')}</button><button class="btn primary" data-action="close-sheet">${t('i.gotIt')}</button></div>`;
}
function installGenericHTML() {
  return () => `${sheetHead(t('install'), t('set.install'))}
    <ol class="steps"><li><span>${t('i.g1')}</span></li><li><span>${t('i.g2')}</span></li></ol>
    <p class="fine">${t('i.gNote')}</p>
    <div class="sheet-foot"><button class="btn primary" data-action="close-sheet">${t('i.gotIt')}</button></div>`;
}

function openDetails(id) { openSheet(detailsHTML(id)); }

// ---------- watch + alerts ----------
function addWatch(f, now = Date.now()) {
  state.watch[f.id] = { ...DEFAULT_PREFS, flightNo: f.flightNo, addedAt: now };
  // Baseline: don't fire alerts for thresholds that have already passed.
  const mins = (f.arr - now) / MIN;
  const fired = (state.fired[f.id] = {});
  for (const n of [60, 30, 15]) if (mins <= n) fired['t' + n] = true;
  if (isDone(f)) fired.landed = true;
  fired.delay = f.delay >= 15 ? f.delay : 0;
  fired.cancelled = isOff(f);
  fired.exit = f.exitFrom;
  store.set('fired', state.fired);
  saveWatch();
}
function removeWatch(id) {
  delete state.watch[id]; delete state.fired[id];
  store.set('fired', state.fired); saveWatch();
}
async function notify(title, body, id) {
  let system = false;
  if ('Notification' in window && Notification.permission === 'granted') {
    const opts = { body, tag: `${id}-${title}`, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', lang: lang(), data: { url: `./#/flight/${encodeURIComponent(id)}` } };
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
      system = true;
    } catch { /* fall back to in-app */ }
  }
  if (!system || document.visibilityState === 'visible') {
    toast(`${title} · ${body}`, id === 'test' ? { ms: 5000 } : { action: t('t.view'), onAction: () => openDetails(id), ms: 6000 });
    haptic();
  }
}
function checkAlerts(now = Date.now()) {
  const ids = Object.keys(state.watch);
  if (!ids.length || !state.snapshot) return;
  const fl = flights(now);
  for (const id of ids) {
    const f = fl.find((x) => x.id === id);
    const p = state.watch[id];
    if (!f) { if (now - (p.addedAt || 0) > 36 * 3600000) removeWatch(id); continue; }
    if (f.phase === 'arrived' && now - f.exitTo > 3 * 3600000) { removeWatch(id); continue; }
    const fired = (state.fired[id] ||= {});
    const mins = (f.arr - now) / MIN;
    const route = `${f.ap.city} → ${vno()}`;
    const exit = exitText(f);
    if (isOff(f)) {
      if (p.delayed && !fired.cancelled) { fired.cancelled = true; notify(t('nt.cancelled', { f: f.flightNo }), t('nt.cancelledBody', { route }), id); }
      continue;
    }
    if (isActive(f)) {
      // One alert per crossing, even if several thresholds are passed at once.
      const due = mins > 0 ? [60, 30, 15].filter((n) => mins <= n && !fired['t' + n]) : [];
      if (due.length) {
        due.forEach((n) => (fired['t' + n] = true));
        if (due.some((n) => p['t' + n])) notify(t('nt.arrivesIn', { f: f.flightNo, m: Math.max(1, Math.round(mins)) }), t('nt.arrivesBody', { route, t: tm(f.arr), exit }), id);
      }
      if (p.delayed && f.delay >= 15 && f.delay >= (fired.delay || 0) + 10) {
        fired.delay = f.delay;
        notify(t('nt.delayed', { f: f.flightNo, n: f.delay }), t('nt.delayedBody', { t: tm(f.arr), exit }), id);
      }
    }
    if (p.landed && !fired.landed && f.actual && isDone(f)) {
      fired.landed = true;
      notify(t('nt.landed', { f: f.flightNo }), t('nt.landedBody', { t: tm(f.arr), exit }), id);
    }
    if (f.exitFrom) {
      if (fired.exit == null) fired.exit = f.exitFrom;
      else if (Math.abs(f.exitFrom - fired.exit) >= 5 * MIN) {
        fired.exit = f.exitFrom;
        if (p.exit && f.phase !== 'arrived') notify(t('nt.exit', { f: f.flightNo }), t('nt.exitBody', { exit }), id);
      }
    }
  }
  store.set('fired', state.fired);
  updateBadge(fl);
}
function updateBadge(fl = flights()) {
  const n = Object.keys(state.watch).filter((id) => { const f = fl.find((x) => x.id === id); return f && isActive(f); }).length;
  const b = $('#watchBadge');
  b.hidden = !n; b.textContent = n;
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch { /* unsupported */ }
}

// ---------- owner: fetch new data via GitHub Actions ----------
// Only people with write access to the repository can run the workflow; the token lives on the owner's device only.
let ownerUpdating = false;
const ownerToken = () => store.get('ownerToken', null);
function usageToday() {
  const u = state.snapshot?.usage || {};
  const max = u.dailyLimit || 15;
  return { count: u.day === fmtYMD.format(Date.now()) ? u.count || 0 : 0, max };
}
const workflowUrl = (gh) => `https://github.com/${gh.owner}/${gh.repo}/actions/workflows/${CONFIG.workflow}`;
function ownerGroupHTML(now) {
  const gh = githubRepo();
  const u = usageToday();
  const s = state.snapshot;
  const last = s?.lastAttempt;
  const quotaOut = s?.usage?.quota && s.usage.quota.remaining <= 0;
  let body;
  if (!gh) body = `<div class="srow"><div class="srow-main">${t('owner.title')}<span>${t('owner.notPublished')}</span></div></div>`;
  else if (!ownerToken()) body = `<button class="srow" data-action="owner-open"><div class="srow-main">${t('owner.title')}<span>${t('owner.rowSub')}</span></div>${icon('chev')}</button>`;
  else {
    const blocked = u.count >= u.max || quotaOut;
    body = `<button class="srow" data-action="owner-update" ${blocked || ownerUpdating ? 'disabled' : ''}><div class="srow-main" style="color:${blocked ? 'var(--text-3)' : 'var(--accent)'};font-weight:650">${t('owner.update')}
        <span>${quotaOut ? t('owner.quotaOut') : u.count >= u.max ? t('owner.limit', { max: u.max }) : t('owner.updateSub', { left: u.max - u.count, max: u.max })}</span></div>${icon(ownerUpdating ? 'clock' : 'download')}</button>
      ${last && !last.ok ? `<div class="srow"><div class="srow-main"><span>${esc(t('owner.lastFail', { t: tm(last.at), reason: errText(last.code) }))}</span></div></div>` : ''}
      <a class="srow" href="${workflowUrl(gh)}" target="_blank" rel="noopener"><div class="srow-main">${t('owner.openGh')}</div>${icon('open')}</a>
      <button class="srow" data-action="owner-signout"><div class="srow-main" style="color:var(--bad)">${t('owner.signOut')}</div></button>`;
  }
  return `<div class="group"><h2 class="group-title">${t('owner.title')}</h2><div class="group-body">${body}</div></div>`;
}
function ownerSheetHTML() {
  return () => {
    const gh = githubRepo();
    return `${sheetHead('', t('owner.title'))}
      <div class="notice">${icon('passport')}<div>${t('owner.intro', { max: usageToday().max })}<br>
        <a class="btn" style="margin-top:10px" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">${t('owner.create')} ${icon('open')}</a></div></div>
      <label class="search" style="margin-top:4px"><span class="sr">${t('owner.token')}</span>${icon('passport')}
        <input id="ownerToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(t('owner.token'))}"></label>
      <p class="fine">${t('owner.alt')}${gh ? ` <a href="${workflowUrl(gh)}" target="_blank" rel="noopener" style="color:var(--accent)">${t('owner.openGh')}</a>` : ''}</p>
      <div class="sheet-foot"><button class="btn" data-action="close-sheet">${t('owner.cancel')}</button><button class="btn primary" data-action="owner-save">${t('owner.save')}</button></div>`;
  };
}
async function ownerUpdate() {
  const gh = githubRepo(), token = ownerToken();
  if (!gh || !token || ownerUpdating) return;
  const u = usageToday();
  if (u.count >= u.max) { toast(t('owner.limit', { max: u.max })); return; }
  ownerUpdating = true; haptic(); renderActive();
  const since = Date.now();
  try {
    const res = await fetch(`https://api.github.com/repos/${gh.owner}/${gh.repo}/actions/workflows/${CONFIG.workflow}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: CONFIG.branch }),
    });
    if (res.status !== 204) { ownerUpdating = false; toast(t('t.tokenBad'), { ms: 6000 }); renderActive(); return; }
  } catch { ownerUpdating = false; toast(t('t.failed')); renderActive(); return; }
  toast(t('t.updating'), { ms: 6000 });
  // The workflow commits data/arrivals.json and redeploys Pages; poll until its attempt shows up.
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    await refresh();
    const last = state.snapshot?.lastAttempt;
    if (last && last.at >= since - 60000) {
      ownerUpdating = false;
      toast(last.ok ? t('t.updateDone') : t('t.updateFailed', { reason: errText(last.code) }), { ms: 6000 });
      renderActive();
      return;
    }
  }
  ownerUpdating = false; toast(t('t.updateSlow')); renderActive();
}

// ---------- toast ----------
let toastTimer;
function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('is-on'); onAction?.(); };
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('is-on'); setTimeout(() => (el.hidden = !el.classList.contains('is-on')), 300); }, ms);
}

// ---------- network + refresh ----------
let inflight = null, refreshTimer = null;
function renderNet(now = Date.now()) {
  const bar = $('#netbar'), livePill = $('#live'), label = livePill.querySelector('span');
  const s = state.snapshot;
  const offline = !navigator.onLine;
  if (offline) { livePill.classList.add('is-off'); label.textContent = t('offline'); }
  else if (settings.source === 'demo') { livePill.classList.add('is-off'); label.textContent = t('src.demoOpt'); }
  else if (s?.fetchedAt && now - s.fetchedAt < LIVE_FRESH_MS) { livePill.classList.remove('is-off'); label.textContent = t('live'); }
  else { livePill.classList.add('is-off'); label.textContent = s?.fetchedAt ? agoShort(s.fetchedAt, now) : t('offline'); }

  const err = state.error && state.error.code !== 'offline' ? state.error.code : null;
  const last = s?.fetchedAt ? t('net.lastUpdated', { ago: `<span data-ago="${s.fetchedAt}">${ago(s.fetchedAt, now)}</span>` }) : t('net.noData');
  if (offline) {
    bar.hidden = false;
    bar.innerHTML = `${icon('offline')}<div><b>${t('net.offline')}</b> · <span>${last}</span></div>`;
  } else if (err && settings.source === 'live') {
    bar.hidden = false;
    bar.innerHTML = `${icon('offline')}<div><b>${t('net.liveErr')}</b>: ${esc(errText(err))} · <span>${last}</span></div>`;
  } else bar.hidden = true;
}
function refresh({ manual = false } = {}) {
  if (inflight) return inflight;
  if (!navigator.onLine) {
    renderNet();
    if (manual) toast(t('t.offline'));
    return Promise.resolve();
  }
  const source = settings.source;
  inflight = fetchArrivals(source)
    .then((snap) => {
      if (source !== settings.source) return; // source switched mid-request
      state.snapshot = snap; state.error = null; state.fails = 0;
      store.set('snapshot.' + source, snap);
      if (manual) toast(t('t.updated'));
    })
    .catch((err) => {
      if (source !== settings.source) return;
      state.error = { code: err.code || 'generic' }; state.fails++;
      if (manual) toast(t('t.failed'));
    })
    .finally(() => {
      inflight = null;
      document.getElementById('app').classList.remove('is-loading');
      renderNet(); renderActive(); if (sheetOpen) renderSheet(); checkAlerts(); scheduleRefresh();
    });
  return inflight;
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const watching = Object.keys(state.watch).length > 0;
  if (document.hidden && !watching) return; // save battery: no polling in background unless watching
  const base = settings.interval * 1000;
  const delay = state.error ? Math.min(Math.max(base, 60000), 4000 * 2 ** Math.min(state.fails, 4)) : document.hidden ? Math.max(base, 120000) : base;
  refreshTimer = setTimeout(() => refresh(), delay);
}
function switchSource(src) {
  settings.source = src; saveSettings();
  state.snapshot = store.get('snapshot.' + src, null);
  state.error = null; state.fails = 0;
  inflight = null;
  renderNet(); renderActive();
  refresh();
}

// ---------- ticking (only while visible) ----------
let tickTimer = null, tickN = 0;
function tick() {
  const now = Date.now();
  $('#clock').textContent = tm(now);
  let crossed = false;
  const scope = sheetOpen ? [viewEl(state.tab), sheetBody] : [viewEl(state.tab)];
  for (const root of scope) {
    for (const el of $$('[data-cd]', root)) {
      const ms = +el.dataset.cd - now;
      el.textContent = cdText(ms);
      if (ms <= 0 && ms > -1500) crossed = true;
    }
    for (const el of $$('[data-rel]', root)) el.textContent = rel(+el.dataset.rel - now);
  }
  for (const el of $$('[data-ago]')) el.textContent = ago(+el.dataset.ago, now);
  tickN++;
  if (state.tab === 'map' && tickN % 2 === 0) updateMap(now, true);
  if (crossed || tickN % 30 === 0) { renderActive(now); if (sheetOpen) renderSheet(); renderNet(now); }
  if (tickN % 30 === 15) checkAlerts(now);
}
function startTicking() {
  if (tickTimer) return;
  tick();
  // Align to the second boundary so countdowns flip exactly once per second.
  tickTimer = setTimeout(function loop() { tick(); tickTimer = setTimeout(loop, 1000 - (Date.now() % 1000) + 5); }, 1000 - (Date.now() % 1000) + 5);
}
function stopTicking() { clearTimeout(tickTimer); tickTimer = null; }
let bgAlertTimer = null;

// ---------- install ----------
const installDismissed = () => Date.now() - (store.get('installLater', 0)) < 3 * 86400000;
function updateInstallUI() {
  const can = !isStandalone() && (deferredPrompt || isIOS());
  $('#installPill').hidden = !can || installDismissed();
  document.documentElement.classList.toggle('standalone', isStandalone());
}
async function install() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice.catch(() => ({}));
    deferredPrompt = null;
    if (outcome === 'accepted') toast(t('t.installing'));
    updateInstallUI();
  } else if (isIOS()) openSheet(installIOSHTML());
  else openSheet(installGenericHTML());
}

// ---------- wake lock ----------
async function setWake(on) {
  wantWake = on;
  try {
    if (on && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      toast(t('t.screenOn'));
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wantWake = false; toast(t('t.screenFail')); }
}

// ---------- event wiring ----------
const ACTIONS = {
  go: (el) => { haptic(); go(el.dataset.tab); },
  'open-flight': (el) => openDetails(el.dataset.id),
  'close-sheet': () => closeSheet(),
  refresh: () => refresh({ manual: true }),
  'owner-open': () => openSheet(ownerSheetHTML()),
  'owner-save': () => {
    const v = $('#ownerToken')?.value.trim();
    if (!v) return;
    store.set('ownerToken', v); haptic(); toast(t('t.ownerOn'));
    closeSheet(); renderActive();
  },
  'owner-signout': () => { store.set('ownerToken', null); toast(t('t.ownerOff')); renderActive(); },
  'owner-update': () => ownerUpdate(),
  filter: (el) => { state.filter = el.dataset.filter; updateArrivals(Date.now()); },
  watch: (el) => {
    const id = el.dataset.id;
    const f = byId(id);
    if (!f) return;
    if (!isWatched(id)) { addWatch(f); haptic(); toast(t('t.watching', { f: f.flightNo })); renderActive(); }
    openSheet(notifySheetHTML(id));
  },
  'notify-settings': (el) => openSheet(notifySheetHTML(el.dataset.id)),
  unwatch: (el) => {
    const id = el.dataset.id, no = state.watch[id]?.flightNo;
    removeWatch(id); haptic();
    if (sheetOpen) closeSheet();
    renderActive(); toast(t('t.stopped', { f: no || '' }));
  },
  route: (el) => {
    const f = byId(el.dataset.id);
    if (!f) return;
    if (f.ap.x == null && !f.pos) { toast(t('t.noPos', { f: f.flightNo })); return; }
    state.mapSel = f.id;
    const dist = f.pos ? f.pos.dist : f.ap.dist;
    const need = MAP_RANGES.find((r) => r >= dist * 1.08) || MAP_RANGES.at(-1);
    if (need > state.mapRange) state.mapRange = need;
    go('map');
    radar.setRange(state.mapRange);
    radar.select(f.id);
    updateMap(Date.now());
    if (f.phase === 'scheduled') toast(t('t.notDeparted', { f: f.flightNo, t: tm(f.dep) }));
    else if (isDone(f)) toast(t('t.alreadyLanded', { f: f.flightNo }));
  },
  wait: (el) => openSheet(waitHTML(el.dataset.id)),
  share: async (el) => {
    const f = byId(el.dataset.id);
    if (!f) return;
    const text = t('share.text', { f: f.flightNo, c: f.ap.city, s: statusText(f), when: isDone(f) ? t('share.landed') : t('share.expected'), t: tm(f.arr), exit: exitText(f) });
    const url = new URL(`#/flight/${encodeURIComponent(f.id)}`, location.href).href;
    try {
      if (navigator.share) await navigator.share({ title: `VNO Era · ${f.flightNo}`, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast(t('t.copied')); }
    } catch { /* user cancelled */ }
  },
  'map-select': (el) => { state.mapSel = el.dataset.id; radar.select(el.dataset.id); haptic(); updateMap(Date.now()); },
  'map-zoom': (el) => {
    const i = MAP_RANGES.indexOf(state.mapRange) + Number(el.dataset.dir);
    if (i < 0 || i >= MAP_RANGES.length) return;
    state.mapRange = MAP_RANGES[i]; haptic();
    radar.setRange(state.mapRange); updateMap(Date.now());
  },
  'map-3d': () => { state.map3d = !radar.host.classList.contains('is-3d'); haptic(); radar.set3D(state.map3d); updateMap(Date.now()); },
  install: () => install(),
  'install-ios': () => openSheet(installIOSHTML()),
  'install-later': () => { store.set('installLater', Date.now()); updateInstallUI(); closeSheet(); },
  'enable-notif': async () => {
    if (!('Notification' in window)) return;
    const res = await Notification.requestPermission();
    toast(res === 'granted' ? t('t.notifOn') : t('t.notifOff'));
    renderActive(); if (sheetOpen) renderSheet();
  },
  'test-notif': () => notify(t('nt.test'), t('nt.testBody'), 'test'),
  set: (el) => {
    const { key, value } = el.dataset;
    haptic();
    if (key === 'source') { if (value !== settings.source) switchSource(value); return; }
    settings[key] = key === 'interval' ? Number(value) : value;
    saveSettings();
    if (key === 'theme') applyTheme();
    if (key === 'fx') { state.map3d = null; applyFx(); }
    if (key === 'interval') scheduleRefresh();
    if (key === 'lang') { applyLang(); remountAll(); return; }
    updateSettings(Date.now());
  },
  reset: () => {
    if (!confirm(t('set.resetConfirm'))) return;
    state.watch = {}; state.fired = {};
    store.set('watch', {}); store.set('fired', {}); store.set('installLater', 0);
    updateBadge(); toast(t('t.cleared')); renderActive();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen) closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.pref) {
    const p = state.watch[el.dataset.id];
    if (!p) return;
    p[el.dataset.pref] = el.checked; saveWatch(); haptic();
    if (el.checked && 'Notification' in window && Notification.permission === 'default') ACTIONS['enable-notif']();
  } else if (el.dataset.setting) {
    settings[el.dataset.setting] = el.checked; saveSettings();
  } else if ('wake' in el.dataset) setWake(el.checked);
});

window.addEventListener('popstate', () => {
  if (sheetOpen && !history.state?.sheet) hideSheet();
  const { tab } = parseHash();
  if (tab !== state.tab && TABS.includes(tab)) show(tab);
});
window.addEventListener('scroll', () => document.documentElement.classList.toggle('is-scrolled', window.scrollY > 4), { passive: true });

// Pull to refresh (home / arrivals / watchlist)
(function pullToRefresh() {
  const ptr = $('#ptr');
  let y0 = null, d = 0;
  addEventListener('touchstart', (e) => {
    y0 = !sheetOpen && ['home', 'arrivals', 'watch'].includes(state.tab) && window.scrollY <= 0 ? e.touches[0].clientY : null; d = 0;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    d = Math.min(110, Math.max(0, (e.touches[0].clientY - y0) * 0.5));
    if (window.scrollY > 0) { y0 = null; d = 0; }
    ptr.style.transition = 'none';
    ptr.style.opacity = String(Math.min(1, d / 50));
    ptr.style.transform = `translateY(${d - 50}px) rotate(${d * 4}deg)`;
  }, { passive: true });
  addEventListener('touchend', () => {
    if (y0 == null) return;
    ptr.style.transition = '';
    if (d > 60) {
      haptic();
      ptr.classList.add('is-spinning'); ptr.style.transform = 'translateY(14px)'; ptr.style.opacity = '1';
      refresh({ manual: true }).finally(() => { ptr.classList.remove('is-spinning'); ptr.style.transform = ''; ptr.style.opacity = ''; });
    } else { ptr.style.transform = ''; ptr.style.opacity = ''; }
    y0 = null;
  });
})();

addEventListener('online', () => { renderNet(); toast(t('t.online')); refresh(); });
addEventListener('offline', () => { renderNet(); toast(t('t.offline')); });
navigator.connection?.addEventListener?.('change', () => { if (navigator.onLine) refresh(); }); // Wi-Fi ↔ cellular

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    clearInterval(bgAlertTimer); bgAlertTimer = null;
    startTicking();
    refresh();
    if (wantWake && !wakeLock) setWake(true);
  } else {
    stopTicking();
    scheduleRefresh();
    if (Object.keys(state.watch).length) bgAlertTimer = setInterval(() => checkAlerts(), 30000);
  }
});

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; updateInstallUI(); });
addEventListener('appinstalled', () => { deferredPrompt = null; updateInstallUI(); toast(t('t.installed')); });
reduceMotion.addEventListener?.('change', applyFx);

// ---------- service worker ----------
if ('serviceWorker' in navigator) {
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast(t('t.newVersion'), { action: t('t.reload'), ms: 10000, onAction: () => nw.postMessage({ type: 'SKIP_WAITING' }) });
          }
        });
      });
    } catch { /* SW unavailable (e.g. file://) */ }
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && navigator.serviceWorker.controller) { reloading = true; location.reload(); } });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open') {
      const m = String(e.data.url || '').match(/#\/flight\/(.+)$/);
      if (m) openDetails(decodeURIComponent(m[1]));
    }
  });
}

// ---------- boot ----------
applyLang();
applyTheme();
applyFx();
updateInstallUI();
{
  const { tab, arg } = parseHash();
  const start = TABS.includes(tab) ? tab : 'home';
  history.replaceState({ tab: start }, '', `#/${start}`);
  for (const tb of TABS) viewEl(tb).hidden = tb !== start;
  show(start);
  if (state.snapshot) document.getElementById('app').classList.remove('is-loading');
  renderNet();
  updateBadge();
  if (tab === 'flight' && arg) setTimeout(() => openDetails(arg), 50);
}
startTicking();
refresh();
setTimeout(probeFps, 1200);
