// VNO Era — lightweight radar map (SVG, no tiles, no libraries).
// Azimuthal-equidistant projection centred on Vilnius: each inbound route is a straight line to the centre.
import { AIRPORTS } from './data.js';

const NS = 'http://www.w3.org/2000/svg';
export const PLANE_PATH = 'M12 1.4 13.2 2.4 13.4 9.2 21.4 13.8 21.4 15.8 13.4 13.6 13.4 18 15.8 19.6 15.8 21.2 12 20.2 8.2 21.2 8.2 19.6 10.6 18 10.6 13.6 2.6 15.8 2.6 13.8 10.6 9.2 10.8 2.4Z';
const RING_STEPS = [250, 500, 1000, 1500, 2000, 3000, 4000];

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

export class Radar {
  constructor(host, { mini = false, range = 1600, onSelect, labels = {} } = {}) {
    this.labels = { km: 'km', north: 'N', aria: 'Radar map', ...labels };
    this.host = host;
    this.mini = mini;
    this.range = range;
    this.onSelect = onSelect;
    this.selected = null;
    this.flights = [];
    host.classList.add('radar-stage');
    if (mini) host.classList.add('is-mini');
    host.innerHTML = '<div class="radar-disc"><div class="radar-sweep" aria-hidden="true"></div></div>';
    this.disc = host.firstChild;
    this.svg = el('svg', { class: 'radar-svg', role: 'img', 'aria-label': this.labels.aria }, this.disc);
    this.gStatic = el('g', {}, this.svg);
    this.gRoutes = el('g', { class: 'r-routes' }, this.svg);
    this.gPlanes = el('g', { class: 'r-planes' }, this.svg);
    this.gCenter = el('g', { class: 'r-center' }, this.svg);
    this.px = 1;
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this.disc);
    if (!mini) {
      this.svg.addEventListener('click', (e) => {
        const g = e.target.closest('[data-id]');
        this.select(g ? g.dataset.id : null);
        this.onSelect?.(g ? g.dataset.id : null);
      });
    }
    this.drawStatic();
  }

  measure() {
    const w = this.disc.clientWidth || 300;
    const px = (2 * this.range) / w; // km per CSS px
    if (Math.abs(px - this.px) / this.px > 0.02) { this.px = px; this.drawStatic(); this.update(this.flights, this.now); }
  }

  set3D(on) { this.host.classList.toggle('is-3d', !!on); }
  setRange(km) { this.range = km; this.measure(); this.px = (2 * this.range) / (this.disc.clientWidth || 300); this.drawStatic(); this.update(this.flights, this.now); }

  drawStatic() {
    const R = this.range, p = this.px;
    this.svg.setAttribute('viewBox', `${-R} ${-R} ${2 * R} ${2 * R}`);
    const g = this.gStatic;
    g.textContent = '';
    el('circle', { cx: 0, cy: 0, r: R, class: 'r-bg' }, g);
    const rings = RING_STEPS.filter((s) => s < R * 0.98);
    const show = rings.length > 3 ? rings.filter((_, i) => i % 2 === rings.length % 2) : rings;
    for (const r of show) {
      el('circle', { cx: 0, cy: 0, r, class: 'r-ring' }, g);
      if (!this.mini) {
        const t = el('text', { x: r * Math.SQRT1_2 + 4 * p, y: -r * Math.SQRT1_2 - 4 * p, class: 'r-ring-label', 'font-size': 10 * p }, g);
        t.textContent = `${r} ${this.labels.km}`;
      }
    }
    el('circle', { cx: 0, cy: 0, r: R - p, class: 'r-edge' }, g);
    el('line', { x1: -R, y1: 0, x2: R, y2: 0, class: 'r-axis' }, g);
    el('line', { x1: 0, y1: -R, x2: 0, y2: R, class: 'r-axis' }, g);
    if (!this.mini) {
      const n = el('text', { x: 0, y: -R + 16 * p, class: 'r-north', 'font-size': 11 * p, 'text-anchor': 'middle' }, g);
      n.textContent = this.labels.north;
    }
    // Network airports
    // Labels: greedy placement, nearest airports first, skipping any that would collide.
    const seen = new Set();
    const fs = (this.mini ? 9 : 11) * p;
    const boxes = [[-20 * p, -8 * p, 20 * p, 26 * p]]; // keep clear of the VNO marker
    const hit = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    for (const ap of Object.values(AIRPORTS).sort((a, b) => a.dist - b.dist)) {
      if (ap.dist > R * 0.96) continue;
      el('circle', { cx: ap.x, cy: ap.y, r: (this.mini ? 2 : 2.6) * p, class: 'r-ap' }, g);
      const label = this.mini ? ap.iata : ap.city;
      if (seen.has(label)) continue;
      const left = Math.abs(ap.x) > R * 0.5 ? ap.x > 0 : ap.x < 0; // near the rim, label points inward
      const w = label.length * fs * 0.6, x = ap.x + (left ? -6 : 6) * p;
      const box = [left ? x - w : x, ap.y - fs * 0.6, left ? x : x + w, ap.y + fs * 0.6];
      if (hit(box)) continue;
      boxes.push(box); seen.add(label);
      const t = el('text', { x, y: ap.y + fs * 0.35, 'font-size': fs, 'text-anchor': left ? 'end' : 'start', class: 'r-ap-label' }, g);
      t.textContent = label;
    }
    // Centre
    const c = this.gCenter;
    c.textContent = '';
    el('circle', { cx: 0, cy: 0, r: 14 * p, class: 'r-pulse' }, c);
    el('circle', { cx: 0, cy: 0, r: 5 * p, class: 'r-vno' }, c);
    const t = el('text', { x: 0, y: 20 * p, 'font-size': (this.mini ? 10 : 12) * p, 'text-anchor': 'middle', class: 'r-vno-label' }, c);
    t.textContent = 'VNO';
  }

  select(id) {
    this.selected = id;
    this.update(this.flights, this.now);
  }

  update(flights = [], now = Date.now()) {
    this.flights = flights;
    this.now = now;
    const p = this.px, R = this.range;
    const air = flights.filter((f) => f.pos);
    const noPos = flights.filter((f) => (f.phase === 'enroute' || f.phase === 'approach') && !f.pos).length;
    this.gRoutes.textContent = '';
    this.gPlanes.textContent = '';
    let hidden = 0;
    for (const f of air) {
      const { x, y } = f.pos;
      if (Math.hypot(x, y) > R * 0.97) { hidden++; continue; }
      const sel = f.id === this.selected;
      if (f.ap.x != null) {
        el('line', { x1: f.ap.x, y1: f.ap.y, x2: 0, y2: 0, class: 'r-route' + (sel ? ' is-sel' : '') }, this.gRoutes);
        el('line', { x1: f.ap.x, y1: f.ap.y, x2: x, y2: y, class: 'r-flown' + (sel ? ' is-sel' : '') }, this.gRoutes);
      } else el('line', { x1: x, y1: y, x2: 0, y2: 0, class: 'r-route' + (sel ? ' is-sel' : '') }, this.gRoutes);
      const deg = (Math.atan2(-x, y) * 180) / Math.PI; // nose toward VNO
      const g = el('g', { class: 'r-plane' + (sel ? ' is-sel' : '') + (f.tone !== 'ok' ? ` tone-${f.tone}` : ''), 'data-id': f.id, transform: `translate(${x} ${y})` }, this.gPlanes);
      if (!this.mini) el('circle', { r: 22 * p, class: 'r-hit' }, g);
      if (sel) el('circle', { r: 16 * p, class: 'r-halo' }, g);
      const s = ((this.mini ? 16 : 22) / 24) * p;
      el('path', { d: PLANE_PATH, transform: `rotate(${deg}) scale(${s}) translate(-12 -12)` }, g);
      if (!this.mini) {
        const t = el('text', { x: 14 * p, y: -10 * p, 'font-size': 11 * p, class: 'r-plane-label' }, g);
        t.textContent = f.flightNo;
      }
    }
    // A selected flight that isn't airborne yet: show its route and origin.
    const selF = flights.find((f) => f.id === this.selected);
    if (selF && !air.includes(selF) && selF.ap.x != null && selF.ap.dist <= R * 0.97) {
      el('line', { x1: selF.ap.x, y1: selF.ap.y, x2: 0, y2: 0, class: 'r-route is-sel' }, this.gRoutes);
      el('circle', { cx: selF.ap.x, cy: selF.ap.y, r: 9 * p, class: 'r-halo' }, this.gRoutes);
    }
    this.hiddenCount = hidden;
    return { airborne: air.length + noPos, hidden, noPos };
  }

  destroy() { this.ro.disconnect(); }
}
