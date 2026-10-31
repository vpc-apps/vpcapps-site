/* Pop Pairs – browser demo. Plain JS + canvas, no external requests.
 * Rules are a straight port of the Android game (lib/game/board.dart,
 * game_state.dart, level.dart, solver.dart). levels.js is exported from the
 * real level data by p3_merge_puzzle/tool/export_web_demo.dart, including the
 * game's seeded new-tile spawns, so every level plays exactly as in the app. */
'use strict';

// ---------------------------------------------------------------- config
const CONFIG = {
  // Set to false to remove every Google Play link and mention (e.g. for
  // YouTube Playables, which may not allow external links). ?noplay=1 also works.
  SHOW_PLAY_LINKS: true,
  PLAY_URL: 'https://play.google.com/store/apps/details?id=in.vpconsulting.poppairs',
  FULL_GAME: '120 levels',
};
const Q = new URLSearchParams(location.search);
if (Q.get('noplay') === '1') CONFIG.SHOW_PLAY_LINKS = false;
const DEMO = Q.get('demo');
const SELFTEST = Q.get('selftest') === '1';

// ---------------------------------------------------------------- rules (port of board.dart)
const N = 5;
const DIRS = { U: 'up', D: 'down', L: 'left', R: 'right' };

/** Tiles slide as far as possible; two equal tiles meeting merge into their
 *  sum; a tile merges at most once per slide; merges resolve from the
 *  leading edge (2 2 2 → 4 2). */
function slide(tiles, dir) {
  const at = new Map(tiles.map((t) => [t.row * N + t.col, t]));
  const out = [], consumed = [], merged = new Set();
  let moved = false;
  for (let i = 0; i < N; i++) {
    const cells = [];
    for (let j = 0; j < N; j++) {
      cells.push(dir === 'L' ? [i, j] : dir === 'R' ? [i, N - 1 - j] : dir === 'U' ? [j, i] : [N - 1 - j, i]);
    }
    let next = 0, last = null;
    for (const [r, c] of cells) {
      const t = at.get(r * N + c);
      if (!t) continue;
      if (last && last.value === t.value && !merged.has(last.id)) {
        const grown = { ...last, value: last.value * 2 };
        out[out.length - 1] = grown;
        merged.add(last.id);
        consumed.push({ ...t, row: last.row, col: last.col });
        last = grown;
        moved = true;
      } else {
        const [tr, tc] = cells[next++];
        if (t.row !== tr || t.col !== tc) moved = true;
        last = { ...t, row: tr, col: tc };
        out.push(last);
      }
    }
  }
  return { tiles: out, consumed, merged, moved };
}

/** Level star thresholds (level.dart). */
const threeStarMovesLeft = (l) => Math.max(0, l.moves - l.par - 2);
const twoStarMovesLeft = (l) => Math.floor(threeStarMovesLeft(l) / 2);
const starsFor = (l, left) => (left >= threeStarMovesLeft(l) ? 3 : left >= twoStarMovesLeft(l) ? 2 : 1);

/** One play of a level (port of GameState, without the ad-only extras). */
class Game {
  constructor(level, history = true) {
    this.level = level;
    this.tiles = level.start.map(([r, c, v], i) => ({ id: i + 1, value: v, row: r, col: c }));
    this.movesLeft = level.moves;
    this.turn = 0;
    this.nextId = 1000;
    this.status = 'playing';
    this.loseReason = null;
    this.freeUndosLeft = 1;
    this.history = history ? [] : null;
  }
  copy() {
    const g = new Game(this.level, false);
    Object.assign(g, { tiles: this.tiles, movesLeft: this.movesLeft, turn: this.turn, nextId: this.nextId, status: this.status, loseReason: this.loseReason });
    return g;
  }
  get canUndo() { return !!this.history && this.history.length > 0; }
  get maxValue() { return this.tiles.reduce((m, t) => Math.max(m, t.value), 0); }
  get stars() { return this.status !== 'won' ? 0 : starsFor(this.level, this.movesLeft); }
  move(dir) {
    if (this.status !== 'playing') return null;
    const result = slide(this.tiles, dir);
    if (!result.moved) return null;
    if (this.history) this.history.push({ tiles: this.tiles, movesLeft: this.movesLeft, turn: this.turn, nextId: this.nextId });
    this.tiles = result.tiles;
    this.movesLeft--;
    this.turn++;
    const spawned = this.spawn();
    this.updateStatus();
    return { slide: result, spawned };
  }
  undo() {
    const s = this.history.pop();
    Object.assign(this, s);
    this.status = 'playing';
    this.loseReason = null;
    this.freeUndosLeft--;
  }
  /** New tile: a 2 (90%) or 4 on a random empty cell, seeded by level + turn
   *  in the app (Random(seed * 7919 + turn)); the exported table holds that
   *  exact choice for every turn and every count of empty cells. */
  spawn() {
    const used = new Set(this.tiles.map((t) => t.row * N + t.col)), empty = [];
    for (let i = 0; i < N * N; i++) if (!used.has(i)) empty.push(i);
    if (!empty.length) return null;
    const row = this.level.spawn[this.turn];
    const code = row ? row[empty.length - 1] : 0;
    const cell = empty[code % 100];
    const t = { id: this.nextId++, value: code >= 100 ? 4 : 2, row: Math.floor(cell / N), col: cell % N };
    this.tiles = this.tiles.concat([t]);
    return t;
  }
  updateStatus() {
    if (this.maxValue >= this.level.goal) this.status = 'won';
    else if (this.movesLeft <= 0) { this.status = 'lost'; this.loseReason = 'outOfMoves'; }
    else if (['U', 'D', 'L', 'R'].every((d) => !slide(this.tiles, d).moved)) { this.status = 'lost'; this.loseReason = 'stuck'; }
  }
}

// ---------------------------------------------------------------- solver (port of solver.dart; used for the tutorial arrow)
const score = (g) => g.tiles.reduce((s, t) => s + t.value * t.value, 0);
function signature(g) {
  const cells = new Array(N * N).fill(0);
  for (const t of g.tiles) cells[t.row * N + t.col] = t.value;
  return g.turn + ':' + cells.join(',');
}
function solve(from, beamWidth = 200) {
  if (from.status !== 'playing') return null;
  let beam = [[from.copy(), []]];
  for (let depth = 0; depth < from.movesLeft; depth++) {
    const next = [], seen = new Set();
    for (const [state, path] of beam) {
      for (const d of ['U', 'D', 'L', 'R']) {
        const s = state.copy();
        if (!s.move(d)) continue;
        const p = path.concat(d);
        if (s.status === 'won') return p;
        if (s.status === 'lost') continue;
        const sig = signature(s);
        if (!seen.has(sig)) { seen.add(sig); next.push([s, p]); }
      }
    }
    if (!next.length) return null;
    next.sort((a, b) => score(b[0]) - score(a[0]));
    beam = next.slice(0, beamWidth);
  }
  return null;
}
function bestMove(from) {
  const path = solve(from);
  if (path && path.length) return path[0];
  let best = null, bestScore = -1;
  for (const d of ['U', 'D', 'L', 'R']) {
    const s = from.copy();
    if (!s.move(d)) continue;
    const sc = score(s);
    if (sc > bestScore) { bestScore = sc; best = d; }
  }
  return best;
}

// ---------------------------------------------------------------- progress (localStorage, optional)
const KEY = 'poppairs.demo.v1';
const store = (() => {
  let s = { unlocked: 1, stars: [], tutorialDone: false, muted: false };
  const live = !DEMO && !SELFTEST;
  try { if (live) Object.assign(s, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
  return {
    get: () => s,
    save() { try { if (live) localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } },
  };
})();

// ---------------------------------------------------------------- sound (WebAudio, synthesised)
const Sfx = (() => {
  let ctx = null;
  const on = () => !store.get().muted;
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function note(f, t, dur, vol, type = 'sine', glide = 1) {
    const a = ctx, o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (glide !== 1) o.frequency.exponentialRampToValueAtTime(f * glide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  /** Merge "pop": pitch rises with the merged value (like merge_1..6.wav). */
  function merge(value) {
    if (!on() || !ac()) return;
    const step = Math.min(6, Math.max(1, Math.log2(value) - 1)), t = ctx.currentTime, f = 392 * Math.pow(2, (step - 1) * 2 / 12);
    note(f, t, 0.13, 0.32, 'sine', 1.5);
    note(f * 2, t, 0.07, 0.12, 'triangle', 1.2);
  }
  function bump() { if (on() && ac()) note(150, ctx.currentTime, 0.09, 0.18, 'sine', 0.6); }
  function win() {
    if (!on() || !ac()) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => note(f, ctx.currentTime + k * 0.09, k === 3 ? 0.5 : 0.18, 0.26, 'triangle'));
  }
  return { merge, bump, win, unlock: () => { if (on()) ac(); } };
})();

// ---------------------------------------------------------------- tiles (Sunny Pop day skin)
const TILE_COLORS = {
  2: ['#7FE3C4', '#0B4D3C'], 4: ['#6CC6FF', '#083B5C'], 8: ['#FFD84D', '#5C4500'], 16: ['#FF9A3D', '#4F2000'],
  32: ['#FF5D8F', '#FFFFFF'], 64: ['#A95CFF', '#FFFFFF'], 128: ['#22C55E', '#FFFFFF'],
};
const BIG_TILE = ['#FF3B3B', '#FFFFFF'];
const FONT = '"Fredoka",ui-rounded,"Arial Rounded MT Bold","Segoe UI",system-ui,sans-serif';
const TILE_RADIUS = 14, BOARD_RADIUS = 22;

function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (x, s) => (x >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** Glossy tile (TileFace): light top, coloured body, darker lip, drop shadow. */
function paintTile(ctx, x, y, size, value, scale = 1) {
  const [fill, ink] = TILE_COLORS[value] || BIG_TILE;
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2); ctx.scale(scale, scale); ctx.translate(-size / 2, -size / 2);
  const r = (TILE_RADIUS * size) / 60, lip = size * 0.07;
  rrect(ctx, 0, size * 0.05, size, size, r); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, mix(fill, '#FFFFFF', 0.32)); g.addColorStop(0.5, fill); g.addColorStop(1 - lip / size, fill);
  g.addColorStop(1 - lip / size, mix(fill, '#000000', 0.16)); g.addColorStop(1, mix(fill, '#000000', 0.16));
  rrect(ctx, 0, 0, size, size, r); ctx.fillStyle = g; ctx.fill();
  const digits = String(value).length, fs = size * (digits <= 2 ? 0.46 : digits === 3 ? 0.37 : 0.3);
  ctx.font = `700 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ty = size / 2 - size * 0.025 + fs * 0.04;
  ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillText(value, size / 2, ty + 2);
  ctx.fillStyle = ink; ctx.fillText(value, size / 2, ty);
  ctx.restore();
}

// ---------------------------------------------------------------- clock (manual in screenshot modes)
let clock = 0;
const waiters = [];
const wait = (ms) => new Promise((res) => waiters.push({ at: clock + ms, res }));
const MANUAL_CLOCK = !!DEMO && DEMO !== 'play';
function advance(dt) {
  clock += dt;
  for (let k = waiters.length - 1; k >= 0; k--) if (waiters[k].at <= clock) waiters.splice(k, 1)[0].res();
}
async function fastForward(ms) {
  const end = clock + ms;
  while (clock < end) { advance(Math.min(16, end - clock)); for (let j = 0; j < 8; j++) await 0; }
}

// ---------------------------------------------------------------- board view
const SLIDE_MS = 110, POP_MS = 200;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const board = {
  canvas: document.getElementById('board'), size: 300,
  items: [], // {id, value, r, c, fr, fc, t0, under, anim: 'slide'|'pop'|'spawn'|null, a0}
  hint: null, shake0: -1e9,
  set(tiles, anim = {}) {
    this.items = tiles.map((t) => ({ ...t, r: t.row, c: t.col, fr: t.row, fc: t.col, t0: clock, anim: anim[t.id] || null, a0: clock }));
  },
  layout() {
    const stage = document.getElementById('stage'), sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh) return;
    const size = Math.floor(Math.min(520, sw, sh - 12)), dpr = Math.min(3, window.devicePixelRatio || 1);
    this.size = size;
    this.canvas.style.width = this.canvas.style.height = size + 'px';
    this.canvas.width = this.canvas.height = Math.round((size + 24) * dpr);
    this.canvas.style.width = this.canvas.style.height = size + 24 + 'px';
    this.canvas.style.margin = '-12px';
  },
  draw() {
    const cv = this.canvas, ctx = cv.getContext('2d'), size = this.size, pad = 12, dpr = cv.width / (size + 24);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size + 24, size + 24);
    const sp = (clock - this.shake0) / 320, shake = sp >= 0 && sp < 1 ? Math.sin(sp * Math.PI * 4) * 7 * (1 - sp) : 0;
    ctx.translate(pad + shake, pad - 4);
    // board with its lip
    rrect(ctx, 0, 8, size, size, BOARD_RADIUS); ctx.fillStyle = '#5E2146'; ctx.fill();
    rrect(ctx, 0, 0, size, size, BOARD_RADIUS); ctx.fillStyle = '#7A2E5C'; ctx.fill();
    const gap = size * 0.022, cell = (size - gap * (N + 1)) / N, pos = (i) => gap + i * (cell + gap);
    ctx.fillStyle = '#8E3C6D';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { rrect(ctx, pos(c), pos(r), cell, cell, (TILE_RADIUS * cell) / 60); ctx.fill(); }
    const ordered = this.items.filter((t) => t.under).concat(this.items.filter((t) => !t.under));
    for (const t of ordered) {
      let p = 1, scale = 1;
      if (t.anim === 'slide') p = easeOut(Math.min(1, (clock - t.t0) / SLIDE_MS));
      const x = pos(t.fc) + (pos(t.c) - pos(t.fc)) * p, y = pos(t.fr) + (pos(t.r) - pos(t.fr)) * p;
      const k = Math.min(1, (clock - t.a0) / POP_MS);
      if (t.anim === 'pop') scale = 1 + 0.18 * Math.sin(Math.PI * k);
      if (t.anim === 'spawn') scale = 0.2 + 0.8 * easeOutBack(k);
      paintTile(ctx, x, y, cell, t.value, scale);
    }
    if (this.hint) { // bouncing arrow, like the game's hint
      const v = (Math.sin((clock / 650) * Math.PI) + 1) / 2, d = { U: [0, -1, 0], R: [1, 0, 0.5], D: [0, 1, 1], L: [-1, 0, 1.5] }[this.hint];
      ctx.save();
      ctx.translate(size / 2 + d[0] * v * size * 0.04, size / 2 + d[1] * v * size * 0.04);
      ctx.rotate(d[2] * Math.PI);
      const s = size * 0.42 / 24;
      ctx.scale(s, s); ctx.translate(-12, -12);
      ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#FF4F87';
      ctx.fill(new Path2D('M13 19V7.83l4.88 4.88a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.41l-6.59-6.59a1 1 0 0 0-1.41 0L4.71 11.3a1 1 0 0 0 1.41 1.41L11 7.83V19a1 1 0 0 0 2 0z'));
      ctx.restore();
    }
  },
};

/** Static tile for the HUD goal and the rules card. */
function drawTileCanvas(cv, value) {
  const ctx = cv.getContext('2d'), s = cv.width;
  ctx.clearRect(0, 0, s, s);
  paintTile(ctx, s * 0.04, s * 0.02, s * 0.9, value);
}

// ---------------------------------------------------------------- home backdrop: colour blobs + drifting tiles
const backdrop = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const floaters = Array.from({ length: 13 }, () => ({ x: rnd(), y: rnd(), size: 26 + rnd() * 30, laps: 1 + Math.floor(rnd() * 2), spin: rnd() < 0.5 ? 1 : -1, angle: rnd() * Math.PI, value: [2, 4, 8, 16, 32, 64][Math.floor(rnd() * 6)] }));
  const cv = document.getElementById('backdrop');
  return {
    draw() {
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const t = (clock / 40000) % 1;
      [[0.12, 0.12, 0.55, '255,154,192'], [0.95, 0.35, 0.5, '255,216,77'], [0.2, 0.85, 0.6, '127,227,196']].forEach(([bx, by, r, c], i) => {
        const wob = Math.sin(t * Math.PI * 2 * (i + 1)) * 0.03, x = (bx + wob) * w, y = (by - wob) * h, R = r * w;
        const g = ctx.createRadialGradient(x, y, 0, x, y, R * 1.3);
        g.addColorStop(0, `rgba(${c},0.35)`); g.addColorStop(0.6, `rgba(${c},0.25)`); g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g; ctx.fillRect(x - R * 1.3, y - R * 1.3, R * 2.6, R * 2.6);
      });
      ctx.globalAlpha = 0.55;
      for (const f of floaters) {
        const y = ((((f.y - t * f.laps) % 1) + 1) % 1) * (h + 120) - 60;
        ctx.save(); ctx.translate(f.x * w, y); ctx.rotate(f.angle + t * Math.PI * 2 * f.spin);
        paintTile(ctx, -f.size / 2, -f.size / 2, f.size, f.value); ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  };
})();

// ---------------------------------------------------------------- icons (inline SVG)
const ICON = {
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  help: 'M11 18h2v-2h-2v2zm1-14C9.8 4 8 5.8 8 8h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.2-1.8-4-4-4z',
  retry: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 12.5 10.5c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  play: 'M8 5v14l11-7z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  next: 'M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  flag: 'M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z',
  swipe: 'M18.89 6.83C17.07 4.69 14.6 3.5 12 3.5S6.93 4.69 5.11 6.83L3 4.72V10h5.28L6.53 8.25C7.98 6.53 9.92 5.5 12 5.5s4.02 1.03 5.47 2.75L15.72 10H21V4.72l-2.11 2.11zM14.5 12a1.5 1.5 0 0 0-3 0v4.67l-1.74-.87a1.3 1.3 0 0 0-1.53 2.06l3.26 3.26c.28.28.66.44 1.06.44h4.95c.75 0 1.38-.55 1.48-1.29l.56-3.95a1.5 1.5 0 0 0-1-1.62L14.5 13.4V12z',
  add: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
  soundOn: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z',
  soundOff: 'M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z',
};
const svg = (name, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
const PLAY_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#00D7FE" d="M3.6 2.2 13.5 12 3.6 21.8c-.3-.2-.5-.6-.5-1.1V3.3c0-.5.2-.9.5-1.1z"/><path fill="#FFCE00" d="m17 15.5-3.5-3.5L17 8.5l4 2.3c1.1.6 1.1 1.7 0 2.4z"/><path fill="#FF3A44" d="M17 15.5 13.5 12 3.6 21.8c.4.3 1 .3 1.6 0z"/><path fill="#00F076" d="M17 8.5 5.2 2.2c-.6-.3-1.2-.3-1.6 0L13.5 12z"/></svg>';
const gpInner = '<span><small>GET IT ON</small>Google Play</span>';

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const frame = $('frame'), overlay = $('overlay'), card = $('card');
let screen = 'home', game = null, levelIdx = 0, tutorial = false, cardOpen = false, busy = false, leaving = false;

function show(name) {
  screen = name;
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === name);
  if (name === 'game') { board.layout(); requestAnimationFrame(() => board.layout()); }
  if (name === 'levels') renderGrid();
  if (name === 'home') renderHome();
}

function renderHome() {
  const s = store.get(), allDone = s.stars.filter(Boolean).length >= LEVELS.length;
  $('playBtn').innerHTML = svg('play') + (allDone ? 'Play again' : `Play  ·  Level ${Math.min(s.unlocked, LEVELS.length)}`);
}

function renderGrid() {
  const s = store.get();
  $('grid').innerHTML = LEVELS.map((l, i) => {
    const st = s.stars[i] || 0, locked = i + 1 > s.unlocked, next = i + 1 === s.unlocked && !st;
    const stars = '★★★'.split('').map((c, k) => (k < st ? c : `<span class="off">${c}</span>`)).join('');
    return `<button class="lvl${locked ? ' locked' : ''}${next ? ' next' : ''}" data-level="${i}" aria-label="Level ${l.number}${locked ? ', locked' : ''}">${l.number}<i>${stars}</i></button>`;
  }).join('');
}

const WORD = { U: 'up ↑', D: 'down ↓', L: 'left ←', R: 'right →' };
// Computers (mouse, no touch) get arrow-key wording and on-screen arrow buttons.
const MOUSE = matchMedia('(hover: hover) and (pointer: fine)').matches;
if (MOUSE) document.body.classList.add('mouse');
function updateHud() {
  $('lvlNo').textContent = game.level.number;
  const mv = $('moves');
  mv.textContent = game.movesLeft;
  mv.classList.toggle('warn', game.movesLeft <= 3);
  const show = tutorial && board.hint;
  $('banner').classList.toggle('on', !!show);
  if (show) $('bannerText').textContent = MOUSE
    ? `Press the ${WORD[board.hint]} arrow key (or drag the board). Equal tiles merge.`
    : `Swipe ${WORD[board.hint]} anywhere on the board. Equal tiles merge.`;
  const u = $('undoBtn');
  u.disabled = !(game.canUndo && game.freeUndosLeft > 0) || busy;
  u.innerHTML = svg('undo') + 'Undo' + (game.canUndo && game.freeUndosLeft > 0 ? '<span class="badge">1 free</span>' : '');
}

function openLevel(idx, { rules } = {}) {
  levelIdx = idx; leaving = false; busy = false;
  game = new Game(LEVELS[idx]);
  board.set(game.tiles, Object.fromEntries(game.tiles.map((t) => [t.id, 'spawn'])));
  board.hint = null;
  tutorial = false;
  drawTileCanvas($('goalTile'), game.level.goal);
  show('game');
  closeCard();
  updateHud();
  const s = store.get();
  if (rules ?? (idx === 0 && !s.tutorialDone)) showRules(idx === 0 && !s.tutorialDone);
}

function openCard(html, cls = '') {
  card.className = 'card ' + cls;
  card.innerHTML = html;
  overlay.classList.add('on');
  cardOpen = true;
}
function closeCard() { overlay.classList.remove('on'); cardOpen = false; }

function showRules(firstTime) {
  const line = (icon, text) => `<div class="line">${svg(icon)}<span>${text}</span></div>`;
  openCard(`<h3>How to play</h3>
    <div class="line" style="align-items:center">${svg('flag')}<span>Make this tile</span><canvas id="rulesTile" width="76" height="76" style="width:34px;height:34px"></canvas></div>
    ${line('swipe', MOUSE ? 'Use the arrow keys ← ↑ → ↓ (or drag the board) to slide every tile. Two equal tiles that meet merge into one: 8 + 8 = 16.' : 'Swipe to slide every tile. Two equal tiles that meet merge into one: 8 + 8 = 16.')}
    ${line('add', 'A new small tile appears after each swipe.')}
    ${line('star', `You have ${game.level.moves} moves. Fewer moves = more stars.`)}
    <button class="chunky primary" data-act="${firstTime ? 'showme' : 'gotit'}">${svg(firstTime ? 'play' : 'check')}${firstTime ? 'Show me' : 'Got it'}</button>`);
  drawTileCanvas($('rulesTile'), game.level.goal);
}

function startTutorial() {
  closeCard();
  tutorial = true;
  board.hint = bestMove(game);
  updateHud();
}
function skipTutorial() {
  tutorial = false; board.hint = null;
  store.get().tutorialDone = true; store.save();
  updateHud();
}

async function move(d) {
  if (busy || cardOpen || screen !== 'game' || game.status !== 'playing') return;
  const before = new Map(game.tiles.map((t) => [t.id, t]));
  const outcome = game.move(d);
  if (!outcome) { board.shake0 = clock; Sfx.bump(); return; }
  busy = true;
  const g = game, s = outcome.slide;
  // Phase 1: slide. Merging tiles keep their old value; swallowed tiles slide onto them underneath.
  board.hint = null;
  board.items = [
    ...s.consumed.map((t) => { const o = before.get(t.id); return { ...t, r: t.row, c: t.col, fr: o.row, fc: o.col, t0: clock, anim: 'slide', under: true }; }),
    ...s.tiles.map((t) => { const o = before.get(t.id); return { ...t, value: s.merged.has(t.id) ? t.value / 2 : t.value, r: t.row, c: t.col, fr: o.row, fc: o.col, t0: clock, anim: 'slide' }; }),
  ];
  updateHud();
  await wait(SLIDE_MS + 10);
  if (g !== game) return;
  // Phase 2: merged values pop, swallowed tiles vanish, the new tile appears.
  const anim = {};
  for (const id of s.merged) anim[id] = 'pop';
  if (outcome.spawned) anim[outcome.spawned.id] = 'spawn';
  board.set(game.tiles, anim);
  if (tutorial && game.status === 'playing') board.hint = bestMove(game);
  if (s.merged.size) {
    Sfx.merge(s.tiles.filter((t) => s.merged.has(t.id)).reduce((m, t) => Math.max(m, t.value), 0));
    if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) { /* ignore */ }
  }
  busy = false;
  updateHud();
  if (game.status === 'playing') return;
  if (game.status === 'won') {
    const st = store.get();
    st.stars[levelIdx] = Math.max(st.stars[levelIdx] || 0, game.stars);
    st.unlocked = Math.max(st.unlocked, Math.min(LEVELS.length, levelIdx + 2));
    if (tutorial) { st.tutorialDone = true; tutorial = false; board.hint = null; updateHud(); }
    store.save();
    Sfx.win();
  }
  await wait(350);
  if (g === game) showResult();
}

function showResult() {
  const won = game.status === 'won', last = levelIdx === LEVELS.length - 1, l = game.level, m = game.movesLeft;
  if (won) {
    const stars = [0, 1, 2].map((k) => svg('star', k < game.stars ? 'on' : '')).join('');
    const spare = `${m} move${m === 1 ? '' : 's'} to spare.`;
    const body = game.stars === 3 ? `${spare} Perfect!` : `${spare} Finish with ${threeStarMovesLeft(l)} or more left for 3 stars.`;
    openCard(`<div class="stars">${stars}</div><h3>Level complete!</h3><p class="body">${body}</p>
      <div class="row"><button class="chunky" data-act="restart">${svg('retry')}Replay</button>
      <button class="chunky primary" data-act="${last ? 'end' : 'next'}">${svg('next')}${last ? 'Finish' : 'Next'}</button></div>`, 'center');
  } else if (game.loseReason === 'outOfMoves') {
    openCard(`<h3>Out of moves</h3><p class="body">So close! Try again: plan your merges toward one corner.</p>
      <div class="row"><button class="chunky" data-act="levels">${svg('grid')}Levels</button>
      <button class="chunky primary" data-act="restart">${svg('retry')}Retry</button></div>`, 'center');
  } else {
    const canUndo = game.canUndo && game.freeUndosLeft > 0;
    openCard(`<h3>No moves left</h3><p class="body">The board is full. ${canUndo ? 'Undo a move, or try again.' : 'Try again.'}</p>
      <div class="row"><button class="chunky${canUndo ? '' : ' primary'}" data-act="restart">${svg('retry')}Retry</button>
      ${canUndo ? `<button class="chunky primary" data-act="undo">${svg('undo')}Undo</button>` : ''}</div>`, 'center');
  }
}

function showEnd() {
  const s = store.get(), total = s.stars.reduce((a, b) => a + (b || 0), 0);
  const gp = CONFIG.SHOW_PLAY_LINKS
    ? `<p class="body">Get all ${CONFIG.FULL_GAME} free on Google Play, plus a Daily Challenge and a Night Arcade look.</p>
       <a class="gp big" href="${CONFIG.PLAY_URL}" target="_blank" rel="noopener">${PLAY_LOGO}${gpInner}</a>`
    : `<p class="body">You cleared all ${LEVELS.length} demo levels. The full game has ${CONFIG.FULL_GAME} and a Daily Challenge.</p>`;
  openCard(`<div class="stars">${[0, 1, 2].map(() => svg('star', 'on')).join('')}</div>
    <h3>You finished the demo!</h3><p class="body" style="margin-bottom:8px">${total} of ${LEVELS.length * 3} stars collected.</p>${gp}
    <div class="row" style="margin-top:14px"><button class="chunky" data-act="levels">${svg('grid')}Levels</button>
    <button class="chunky" data-act="again">${svg('retry')}Play again</button></div>`, 'center');
}

function undo() {
  if (busy || !game.canUndo || game.freeUndosLeft <= 0) return;
  game.undo();
  board.set(game.tiles);
  board.hint = tutorial ? bestMove(game) : null;
  closeCard();
  updateHud();
}

document.addEventListener('click', (ev) => {
  Sfx.unlock();
  const lv = ev.target.closest('[data-level]');
  if (lv) { openLevel(+lv.dataset.level); return; }
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  switch (b.dataset.act) {
    case 'home': show('home'); break;
    case 'levels': if (!busy) { closeCard(); show('levels'); } break;
    case 'rules': if (!busy && !cardOpen) showRules(false); break;
    case 'gotit': closeCard(); break;
    case 'showme': startTutorial(); break;
    case 'skip': skipTutorial(); break;
    case 'undo': undo(); break;
    case 'restart': if (!busy) { const t = tutorial; openLevel(levelIdx, { rules: false }); if (t) startTutorial(); } break;
    case 'next': if (!leaving) { leaving = true; openLevel(levelIdx + 1); } break;
    case 'end': showEnd(); break;
    case 'again': openLevel(0, { rules: false }); break;
  }
});
$('playBtn').addEventListener('click', () => {
  const s = store.get(), allDone = s.stars.filter(Boolean).length >= LEVELS.length;
  openLevel(allDone ? 0 : Math.min(s.unlocked, LEVELS.length) - 1);
});
$('levelsBtn').addEventListener('click', () => show('levels'));

// swipe anywhere on the game screen (touch, pen or mouse drag)
let drag = null;
const gameEl = $('game');
gameEl.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('button')) return;
  Sfx.unlock();
  drag = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
});
window.addEventListener('pointerup', (ev) => {
  if (!drag || ev.pointerId !== drag.id) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  drag = null;
  if (Math.hypot(dx, dy) < 32) return; // ignore small accidental drags
  move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U');
});
window.addEventListener('pointercancel', () => { drag = null; });
$('keys').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-dir]');
  if (b && screen === 'game' && !cardOpen) { Sfx.unlock(); move(b.dataset.dir); }
});
document.addEventListener('keydown', (ev) => {
  const k = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R', W: 'U', S: 'D', A: 'L', D: 'R' }[ev.key];
  if (k && screen === 'game' && !cardOpen) { ev.preventDefault(); Sfx.unlock(); move(k); return; }
  if (ev.key === 'Escape' && cardOpen && card.querySelector('[data-act="gotit"]')) closeCard();
  if ((ev.key === 'Enter' || ev.key === ' ') && cardOpen) { const p = card.querySelector('.chunky.primary'); if (p) { ev.preventDefault(); p.click(); } }
  if (ev.key === 'z' && (ev.ctrlKey || ev.metaKey) && screen === 'game') undo();
});
const muteBtn = $('mute');
function renderMute() { muteBtn.innerHTML = svg(store.get().muted ? 'soundOff' : 'soundOn'); }
muteBtn.addEventListener('click', () => { const s = store.get(); s.muted = !s.muted; store.save(); renderMute(); });
window.addEventListener('resize', () => { if (screen === 'game') board.layout(); });

for (const b of document.querySelectorAll('[data-act="home"],[data-act="levels"].icon')) b.innerHTML = svg('back');
for (const b of document.querySelectorAll('.hud [data-act="rules"]')) b.innerHTML = svg('help');
document.querySelector('.row [data-act="restart"]').innerHTML = svg('retry') + 'Restart';
$('levelsBtn').innerHTML = svg('grid') + 'Levels';
for (const a of document.querySelectorAll('a.gp')) { a.href = CONFIG.PLAY_URL; a.innerHTML = PLAY_LOGO + gpInner; }
if (!CONFIG.SHOW_PLAY_LINKS) { frame.classList.add('no-play'); for (const a of document.querySelectorAll('a.gp')) a.remove(); }
renderMute();
// redraw tile canvases once the web font is in
if (document.fonts) document.fonts.ready.then(() => { if (game) drawTileCanvas($('goalTile'), game.level.goal); });

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frameLoop(now) {
  const dt = Math.min(50, now - last); last = now;
  if (!MANUAL_CLOCK) advance(dt);
  if (screen === 'game') board.draw();
  else if (screen === 'home') backdrop.draw();
  requestAnimationFrame(frameLoop);
}

// ---------------------------------------------------------------- self-test and demo modes
function selfTest() {
  const out = [];
  let pass = 0;
  for (const l of LEVELS) {
    const g = new Game(l, false);
    let noop = 0;
    for (const d of l.solution) if (!g.move(d)) noop++;
    const found = solve(new Game(l, false));
    const ok = noop === 0 && g.status === 'won' && g.maxValue === l.solvedMax && g.tiles.length === l.solvedTiles && l.solution.length <= l.moves;
    if (ok) pass++;
    out.push(`L${l.number}: ${ok ? 'PASS' : 'FAIL'} goal=${l.goal} solution=${l.solution} status=${g.status} movesLeft=${g.movesLeft} max=${g.maxValue}/${l.solvedMax} tiles=${g.tiles.length}/${l.solvedTiles} stars=${g.stars} | JS solver: ${found ? found.join('') : 'none'}`);
  }
  const summary = `SELFTEST ${pass === LEVELS.length ? 'PASS' : 'FAIL'} ${pass}/${LEVELS.length}`;
  document.title = summary;
  const pre = document.createElement('pre');
  pre.id = 'selftest'; pre.textContent = summary + '\n' + out.join('\n');
  pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:12px;background:#fff;z-index:99;font:12px monospace;white-space:pre-wrap';
  document.body.appendChild(pre);
  console.log(pre.textContent);
}

async function runDemo() {
  const lvl = Math.max(1, Math.min(LEVELS.length, +(Q.get('level') || 1))) - 1;
  const s = store.get();
  if (DEMO === 'home') return show('home');
  if (DEMO === 'levels') { s.unlocked = 4; s.stars = [3, 3, 2]; return show('levels'); }
  if (DEMO === 'rules') { s.tutorialDone = false; openLevel(0); return fastForward(300); }
  if (DEMO === 'tutorial') { s.tutorialDone = false; openLevel(0); startTutorial(); return fastForward(300); }
  if (DEMO === 'end') { s.stars = LEVELS.map((_, i) => (i % 4 === 1 ? 2 : 3)); s.unlocked = LEVELS.length; openLevel(LEVELS.length - 1, { rules: false }); return showEnd(); }
  s.tutorialDone = true;
  if (DEMO === 'merge' || DEMO === 'win') { // ?demo=merge&level=N&step=k&freeze=ms : frame `ms` into move k of the solution
    const sol = LEVELS[lvl].solution, steps = DEMO === 'win' ? sol.length : Math.max(1, Math.min(sol.length, +(Q.get('step') || sol.length)));
    openLevel(lvl, { rules: false });
    await fastForward(300);
    for (let k = 0; k < steps; k++) {
      move(sol[k]);
      if (k < steps - 1) await fastForward(400);
    }
    return fastForward(DEMO === 'win' ? 2000 : +(Q.get('freeze') || 60));
  }
  if (DEMO === 'play') { // attract mode: plays every level's stored solution
    for (let k = lvl; ; k = (k + 1) % LEVELS.length) {
      openLevel(k, { rules: false });
      await wait(900);
      for (const d of LEVELS[k].solution) { move(d); await wait(650); }
      await wait(1600);
    }
  }
}

if (SELFTEST) selfTest();
show('home');
requestAnimationFrame(frameLoop);
if (DEMO) { document.documentElement.classList.add('shot'); runDemo(); }
