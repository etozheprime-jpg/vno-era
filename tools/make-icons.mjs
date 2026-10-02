// Generates PWA icons + iOS splash screens with zero dependencies.
// Usage: node tools/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------- PNG encoder ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- tiny rasterizer ----------
const hex = (s, a = 1) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), a];

// Plane silhouette (24-unit box, nose up)
const PLANE = [[12,1.4],[13.2,2.4],[13.4,9.2],[21.4,13.8],[21.4,15.8],[13.4,13.6],[13.4,18],[15.8,19.6],[15.8,21.2],[12,20.2],[8.2,21.2],[8.2,19.6],[10.6,18],[10.6,13.6],[2.6,15.8],[2.6,13.8],[10.6,9.2],[10.8,2.4]];

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Draw a logo into an RGBA buffer region. cx,cy,size in px. opts.bg draws the full-bleed background.
function drawLogo(buf, W, H, cx, cy, size, { rings = true, plane = '#FFFFFF', mono = false } = {}) {
  const s = size / 512;
  const angle = (45 * Math.PI) / 180;
  const planeScale = 9.2 * s; // 24 units -> ~220px at 512
  const poly = PLANE.map(([x, y]) => {
    const px = (x - 12) * planeScale, py = (y - 12) * planeScale;
    return [cx + px * Math.cos(angle) - py * Math.sin(angle), cy + px * Math.sin(angle) + py * Math.cos(angle)];
  });
  const shapes = [];
  if (rings) {
    shapes.push({ ring: [cx, cy, 196 * s, 7 * s], col: hex('#8AB4FF', 0.28) });
    shapes.push({ ring: [cx, cy, 140 * s, 6 * s], col: hex('#8AB4FF', 0.18) });
    // accent arc (top-right quadrant of outer ring)
    shapes.push({ arc: [cx, cy, 196 * s, 9 * s, -Math.PI * 0.62, -Math.PI * 0.08], col: hex('#8AB4FF', 1) });
    shapes.push({ circ: [cx + 196 * s * Math.cos(-Math.PI * 0.08), cy + 196 * s * Math.sin(-Math.PI * 0.08), 15 * s], col: hex('#34D399', 1) });
  }
  shapes.push({ poly, col: mono ? hex('#FFFFFF') : hex(plane) });

  const pad = 230 * s;
  const x0 = Math.max(0, Math.floor(cx - pad)), x1 = Math.min(W, Math.ceil(cx + pad));
  const y0 = Math.max(0, Math.floor(cy - pad)), y1 = Math.min(H, Math.ceil(cy + pad));
  const SS = 4;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    for (const sh of shapes) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
        let hit = false;
        if (sh.poly) hit = inPoly(px, py, sh.poly);
        else if (sh.circ) { const [a, b, r] = sh.circ; hit = (px - a) ** 2 + (py - b) ** 2 <= r * r; }
        else if (sh.ring) { const [a, b, r, w] = sh.ring; const d = Math.hypot(px - a, py - b); hit = Math.abs(d - r) <= w / 2; }
        else if (sh.arc) {
          const [a, b, r, w, t0, t1] = sh.arc; const d = Math.hypot(px - a, py - b);
          const t = Math.atan2(py - b, px - a); hit = Math.abs(d - r) <= w / 2 && t >= t0 && t <= t1;
        }
        if (hit) cov++;
      }
      if (!cov) continue;
      const al = (cov / (SS * SS)) * sh.col[3];
      const i = (y * W + x) * 4;
      const da = buf[i + 3] / 255;
      const oa = al + da * (1 - al);
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round((sh.col[c] * al + buf[i + c] * da * (1 - al)) / (oa || 1));
      buf[i + 3] = Math.round(oa * 255);
    }
  }
}

function fillBg(buf, W, H, top = '#0F1B36', bottom = '#05080F') {
  const a = hex(top), b = hex(bottom);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const r = Math.round(a[0] + (b[0] - a[0]) * t), g = Math.round(a[1] + (b[1] - a[1]) * t), bl = Math.round(a[2] + (b[2] - a[2]) * t);
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; buf[i] = r; buf[i + 1] = g; buf[i + 2] = bl; buf[i + 3] = 255; }
  }
}

function icon(file, size, { scale = 1, bg = true, rings = true, mono = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  if (bg) fillBg(buf, size, size);
  drawLogo(buf, size, size, size / 2, size / 2, size * scale, { rings, mono });
  writeFileSync(ROOT + file, png(size, size, buf));
  console.log('wrote', file);
}

mkdirSync(ROOT + 'icons', { recursive: true });
mkdirSync(ROOT + 'splash', { recursive: true });

icon('icons/icon-192.png', 192);
icon('icons/icon-512.png', 512);
icon('icons/maskable-512.png', 512, { scale: 0.78 });
icon('icons/maskable-192.png', 192, { scale: 0.78 });
icon('icons/apple-touch-icon.png', 180);
icon('icons/badge-96.png', 96, { bg: false, rings: false, mono: true, scale: 1.25 });

// iOS splash screens (portrait) — [cssW, cssH, dpr]
export const SPLASH = [
  [440, 956, 3], [402, 874, 3], [420, 912, 3], [430, 932, 3], [393, 852, 3],
  [428, 926, 3], [390, 844, 3], [375, 812, 3], [414, 896, 2], [375, 667, 2],
];
for (const [w, h, d] of SPLASH) {
  const W = w * d, H = h * d;
  const buf = Buffer.alloc(W * H * 4);
  fillBg(buf, W, H, '#0A1226', '#05080F');
  drawLogo(buf, W, H, W / 2, H * 0.46, 150 * d, {});
  const f = `splash/splash-${W}x${H}.png`;
  writeFileSync(ROOT + f, png(W, H, buf));
  console.log('wrote', f);
}
