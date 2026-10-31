'use strict';
var VPC = window.VPC || (window.VPC = {});
VPC.build = Object.assign({
game: 'game',
title: 'Game',
portal: 'none',
savePrefix: 'vpc',
demoLevels: 0,
fullGameUrl: '',
version: 'dev',
}, window.VPC_BUILD || {});
/** Local test page (127.0.0.1 / localhost): ?fakeAd=1|fail etc. allowed. */
VPC.local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
VPC.query = function (name) {
var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
return m ? decodeURIComponent(m[1]) : null;
};
VPC.log = function () {
if (VPC.local || VPC.query('debug')) console.log.apply(console, ['[vpc]'].concat([].slice.call(arguments)));
};
VPC.dpr = function () { return Math.min(2, Math.max(1, window.devicePixelRatio || 1)); };
/** The current view: w/h in game px, s = px per CSS px, portrait or wide. */
VPC.view = function (scene) {
var sc = scene.scale, s = VPC.dpr();
var w = sc.width, h = sc.height;
var cssW = w / s, cssH = h / s;
return {
w: w, h: h, s: s, cx: w / 2, cy: h / 2,
cssW: cssW, cssH: cssH,
wide: cssW / cssH > 1.05 && cssW >= 640,
portrait: cssH >= cssW,
};
};
/** Scenes call this in create(): layout() now and on every resize. */
VPC.onResize = function (scene, layout) {
var run = function () { if (scene.sys.isActive() || scene.sys.isPaused()) layout(VPC.view(scene)); };
scene.scale.on('resize', run);
scene.events.once('shutdown', function () { scene.scale.off('resize', run); });
layout(VPC.view(scene));
};
function fitCanvas(game) {
var s = VPC.dpr(), el = document.getElementById('game');
var w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
game.scale.setZoom(1 / s);
game.scale.resize(Math.round(w * s), Math.round(h * s));
}
/**
* localStorage under "<savePrefix>." so games sharing an origin (itch,
* our website, GameDistribution) never read each other's progress. Portal
* backends with cloud storage mirror every key under the prefix (see
* VPC.Save.snapshot / restore).
*/
VPC.Save = (function () {
var mem = {}, listeners = [];
function key(k) { return VPC.build.savePrefix + '.' + k; }
function raw(k) {
try { return localStorage.getItem(key(k)); } catch (e) { return mem[key(k)] === undefined ? null : mem[key(k)]; }
}
function write(k, v) {
try { localStorage.setItem(key(k), v); } catch (e) { mem[key(k)] = v; }
listeners.forEach(function (f) { f(); });
}
return {
get: function (k, fallback) {
var v = raw(k);
if (v === null) return fallback;
try { return JSON.parse(v); } catch (e) { return fallback; }
},
set: function (k, v) { write(k, JSON.stringify(v)); },
remove: function (k) {
try { localStorage.removeItem(key(k)); } catch (e) { delete mem[key(k)]; }
listeners.forEach(function (f) { f(); });
},
/** Every key of this game, for cloud saves. */
snapshot: function () {
var o = {}, p = VPC.build.savePrefix + '.';
try {
for (var i = 0; i < localStorage.length; i++) {
var k = localStorage.key(i);
if (k.indexOf(p) === 0) o[k] = localStorage.getItem(k);
}
} catch (e) { Object.keys(mem).forEach(function (k) { if (k.indexOf(p) === 0) o[k] = mem[k]; }); }
return o;
},
/** Restores a snapshot (before the first scene reads anything). */
restore: function (o) {
if (!o || typeof o !== 'object') return 0;
var p = VPC.build.savePrefix + '.', n = 0;
Object.keys(o).forEach(function (k) {
if (k.indexOf(p) !== 0) return;
try { localStorage.setItem(k, o[k]); } catch (e) { mem[k] = o[k]; }
n++;
});
return n;
},
onChange: function (f) { listeners.push(f); },
};
})();
/**
* Fades the HTML loader. A window function (same name as in the Flutter
* builds) so tools/quality_gate.py can see the moment the game is ready.
*/
window.vpcLoaderDone = function () {
var l = document.getElementById('vpc-loader');
if (l) {
l.classList.add('done');
setTimeout(function () { l.remove(); }, 450);
}
};
/**
* Called once, when the first playable screen is up: fades the loader,
* tells the portal (loading finished, then any queued gameplayStart, in the
* same frame) and marks 'vpc-ready' (tools/phaser_pack.py --measure).
*/
VPC.ready = function () {
if (VPC._ready) return;
VPC._ready = true;
try { performance.mark('vpc-ready'); } catch (e) {}
window.vpcLoaderDone();
if (window.vpcQAEvent) window.vpcQAEvent('ready');
VPC.Portal.loadingDone();
VPC.log('ready', Math.round(performance.now()), 'ms');
};
/**
* QA hooks for tools/quality_gate.py (docs/quality_gate.md, template
* contract 4): visible buttons in CSS px (tap-target check) and the game's
* state. Games set VPC.qaState = function () { return 'play' | 'win' | 'fail' | 'menu'; }.
*/
window.vpcQA = {
buttons: function () { return VPC.UI.visibleButtons(); },
state: function () { return VPC.qaState ? VPC.qaState() : 'menu'; },
};
/**
* Starts the game. opts: { scenes: [classes], background: '#hex',
* fonts: ['700 20px Fredoka'], textures: function (scene) {} (draw all
* generated textures), first: function () { return 'SceneKey'; },
* beforeStart: function () {} (after the cloud save, before any scene) }.
* Phaser (renderer, shaders) starts at once; in parallel the portal SDK
* (bounded), the cloud save and the font load, and the boot scene waits
* for them before drawing textures and opening the first scene.
*/
VPC.boot = function (opts) {
try { performance.mark('vpc-boot'); } catch (e) {}
var fonts = (opts.fonts || []).map(function (f) {
return document.fonts && document.fonts.load ? document.fonts.load(f).catch(function () {}) : null;
});
var timeout = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var portal = VPC.Portal.init().then(function () { return VPC.Portal.loadSave(); }).then(function (o) {
var n = VPC.Save.restore(o);
if (n) VPC.log('restored', n, 'keys from the portal');
});
var waitFonts = Promise.race([Promise.all(fonts), timeout(1500)]);
var gate = Promise.all([Promise.race([portal, timeout(6000)]), waitFonts]);
start(opts, gate);
};
function start(opts, gate) {
var Boot = new Phaser.Class({
Extends: Phaser.Scene,
initialize: function Boot() { Phaser.Scene.call(this, { key: 'VPCBoot' }); },
create: function () {
var self = this;
gate.then(function () {
try { performance.mark('vpc-start'); } catch (e) {}
if (opts.beforeStart) opts.beforeStart();
VPC.Audio.attach(self.game);
if (opts.textures) opts.textures(self);
VPC.Juice.textures(self);
VPC.UI.textures(self);
try { performance.mark('vpc-scene'); } catch (e) {}
self.scene.start(opts.first());
});
},
});
var el = document.getElementById('game');
var s = VPC.dpr();
var game = new Phaser.Game({
type: Phaser.AUTO,
parent: 'game',
backgroundColor: opts.background || '#000000',
banner: false,
disableContextMenu: true,
audio: { noAudio: true }, // VPC.Audio owns WebAudio (mute, ducking, blur)
input: { activePointers: 2, keyboard: { target: window } },
render: { antialias: true, powerPreference: 'default', disablePreFX: true, disablePostFX: true },
scale: {
mode: Phaser.Scale.NONE,
width: Math.round(Math.max(1, el.clientWidth) * s),
height: Math.round(Math.max(1, el.clientHeight) * s),
zoom: 1 / s,
},
scene: [Boot].concat(opts.scenes),
});
VPC.game = game;
var pending = null;
window.addEventListener('resize', function () {
clearTimeout(pending);
pending = setTimeout(function () { fitCanvas(game); }, 60);
});
VPC.Keys.install();
}
'use strict';
VPC.Audio = (function () {
var ctx = null, master = null, sfxBus = null, musicBus = null;
var buffers = {}, pending = {}, urls = {};
var ducks = {}, blurred = false, unlocked = false;
var muted = false, musicOn = true;
var music = null, musicBuffer = null, lastVoice = {};
function ac() {
if (ctx) return ctx;
var C = window.AudioContext || window.webkitAudioContext;
if (!C) return null;
try { ctx = new C(); } catch (e) { return null; }
master = ctx.createGain();
master.connect(ctx.destination);
sfxBus = ctx.createGain();
sfxBus.connect(master);
musicBus = ctx.createGain();
musicBus.gain.value = musicOn ? 1 : 0;
musicBus.connect(master);
apply();
Object.keys(urls).forEach(fetchBuffer);
return ctx;
}
function silent() {
return muted || blurred || Object.keys(ducks).some(function (k) { return ducks[k]; });
}
function apply() {
if (!ctx) return;
var t = ctx.currentTime;
master.gain.cancelScheduledValues(t);
master.gain.setTargetAtTime(silent() ? 0 : 1, t, 0.04);
if (blurred && ctx.state === 'running') ctx.suspend().catch(function () {});
else if (!blurred && ctx.state === 'suspended' && unlocked) ctx.resume().catch(function () {});
}
function unlock() {
var a = ac();
if (!a) return;
unlocked = true;
if (a.state === 'suspended' && !blurred) a.resume().catch(function () {});
if (musicOn) startMusic();
}
function fetchBuffer(name) {
if (buffers[name] || pending[name] || !ctx) return;
pending[name] = true;
fetch(urls[name]).then(function (r) { return r.arrayBuffer(); }).then(function (data) {
return new Promise(function (ok, fail) { ctx.decodeAudioData(data, ok, fail); });
}).then(function (b) { buffers[name] = b; }).catch(function (e) { VPC.log('sound', name, 'failed', String(e)); });
}
function tone(a, out, freq, o) {
var t = (o.at === undefined ? a.currentTime : o.at) + (o.delay || 0);
var osc = a.createOscillator(), g = a.createGain(), atk = o.attack || 0.005, dec = o.decay || 0.2;
osc.type = o.type || 'triangle';
osc.frequency.setValueAtTime(freq, t);
if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || dec));
g.gain.setValueAtTime(0.0001, t);
g.gain.exponentialRampToValueAtTime(o.volume || 0.2, t + atk);
g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
osc.connect(g);
g.connect(out);
osc.start(t);
osc.stop(t + atk + dec + 0.05);
}
function noise(dur, freq, volume, delay) {
var a = ctx, t = a.currentTime + (delay || 0), len = Math.floor(a.sampleRate * dur);
var buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
var n = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
n.buffer = buf;
f.type = 'bandpass';
f.frequency.value = freq;
f.Q.value = 1.2;
g.gain.value = volume;
n.connect(f);
f.connect(g);
g.connect(sfxBus);
n.start(t);
}
function sfx(freq, o) { tone(ctx, sfxBus, freq, o); }
var VOICES = {
click: function (v) { sfx(880, { type: 'sine', volume: 0.12 * v, decay: 0.06, to: 660 }); noise(0.02, 3000, 0.08 * v); },
tick: function (v) { sfx(1320, { type: 'square', volume: 0.04 * v, decay: 0.03 }); noise(0.015, 4000, 0.05 * v); },
pop: function (v) { sfx(560, { volume: 0.4 * v, decay: 0.1, to: 200 }); noise(0.05, 2200, 0.3 * v); },
crack: function (v) { noise(0.06, 3800, 0.35 * v); sfx(1900, { type: 'square', volume: 0.05 * v, decay: 0.05, to: 1200 }); },
whoosh: function (v) { noise(0.25, 900, 0.18 * v); },
lose: function (v) {
[392, 330, 262].forEach(function (f, k) { sfx(f, { delay: k * 0.12, volume: 0.13 * v, decay: 0.22 }); });
noise(0.03, 600, 0.05 * v);
},
star: function (v, rate) {
sfx(1046.5 * (rate || 1), { type: 'sine', volume: 0.16 * v, decay: 0.35 });
sfx(2093 * (rate || 1), { type: 'sine', volume: 0.05 * v, decay: 0.25 });
noise(0.02, 6000, 0.04 * v);
},
chime: function (v) {
[784, 988, 1175, 1568].forEach(function (f, k) { sfx(f, { delay: k * 0.07, type: 'sine', volume: 0.1 * v, decay: 0.3 }); });
noise(0.02, 6000, 0.04 * v);
},
unlock: function (v) {
[523, 659, 784, 1046, 1318].forEach(function (f, k) { sfx(f, { delay: k * 0.06, volume: 0.12 * v, decay: 0.28 }); });
noise(0.02, 6000, 0.04 * v);
},
};
var CHORDS = [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]];
var MELODY = [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 5, 4, 2, 1, -1];
var SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
function renderMusic() {
var beat = 60 / 96 / 2, steps = 32, rate = 22050, dur = beat * steps;
var O = window.OfflineAudioContext || window.webkitOfflineAudioContext;
if (!O) return Promise.reject(new Error('no OfflineAudioContext'));
var off = new O(1, Math.ceil(rate * dur), rate), out = off.destination;
for (var step = 0; step < steps; step++) {
var chord = CHORDS[Math.floor(step / 8) % CHORDS.length], at = step * beat;
if (step % 8 === 0) {
chord.forEach(function (f) { tone(off, out, f / 2, { at: at, type: 'sine', volume: 0.035, attack: 0.08, decay: beat * 7 }); });
tone(off, out, chord[0] / 4, { at: at, volume: 0.05, attack: 0.02, decay: beat * 3 });
}
var n = MELODY[step % MELODY.length];
if (n >= 0 && (step < 24 || step % 2 === 0)) tone(off, out, SCALE[n], { at: at, type: 'sine', volume: 0.03, attack: 0.01, decay: beat * 1.6 });
}
return new Promise(function (ok, fail) {
var p = off.startRendering(ok, fail); // old Safari: callbacks; others: a promise
if (p && p.then) p.then(ok, fail);
});
}
function startMusic() {
if (!ctx || music) return;
music = true;
var go = function (buf) {
musicBuffer = buf;
var src = ctx.createBufferSource();
src.buffer = buf;
src.loop = true;
src.connect(musicBus);
src.start();
music = src;
};
if (musicBuffer) go(musicBuffer);
else renderMusic().then(go).catch(function (e) { music = null; VPC.log('music failed', String(e)); });
}
return {
/** Registers a sample: fetched and decoded at boot. */
load: function (name, url) { urls[name] = url; if (ctx) fetchBuffer(name); },
/** Plays a sample, else a synth voice of that name. opts: { volume, rate, minGap (s) }. */
play: function (name, opts) {
opts = opts || {};
if (!ctx || ctx.state !== 'running' || muted) return;
var now = ctx.currentTime, gap = opts.minGap || 0;
if (gap && lastVoice[name] && now - lastVoice[name] < gap) return;
lastVoice[name] = now;
var v = opts.volume === undefined ? 1 : opts.volume;
if (buffers[name]) {
var src = ctx.createBufferSource(), g = ctx.createGain();
src.buffer = buffers[name];
src.playbackRate.value = opts.rate || 1;
g.gain.value = v;
src.connect(g);
g.connect(sfxBus);
src.start();
} else if (VOICES[name]) {
VOICES[name](v, opts.rate);
}
},
get muted() { return muted; },
setMuted: function (on) { muted = !!on; VPC.Save.set('muted', muted); apply(); },
get musicOn() { return musicOn; },
setMusic: function (on) {
musicOn = !!on;
VPC.Save.set('music', musicOn);
if (musicBus) musicBus.gain.setTargetAtTime(musicOn ? 1 : 0, ctx.currentTime, 0.1);
if (musicOn && unlocked) startMusic();
},
/** Silences everything for [reason] (ads, portal audio switch, pause). */
duck: function (reason, on) { ducks[reason] = !!on; apply(); },
get silent() { return silent(); },
/** Boot (after the cloud save): settings, context, sample decoding, listeners. */
attach: function (game) {
muted = VPC.Save.get('muted', false);
musicOn = VPC.Save.get('music', true);
ac();
var unlockOnce = function () { unlock(); };
window.addEventListener('pointerdown', unlockOnce, true);
window.addEventListener('keydown', unlockOnce, true);
window.addEventListener('touchend', unlockOnce, true);
var hide = function (on) { blurred = on; apply(); };
document.addEventListener('visibilitychange', function () { hide(document.hidden); });
window.addEventListener('blur', function () { hide(true); });
window.addEventListener('focus', function () { hide(false); });
game.events.on('hidden', function () { hide(true); });
game.events.on('visible', function () { hide(document.hidden); });
},
};
})();
'use strict';
VPC.Keys = (function () {
var handlers = null;
var SCROLL = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'PageUp', 'PageDown'];
function name(e) {
if (e.key === 'Enter' || e.code === 'NumpadEnter') return 'Enter';
if (e.key === ' ' || e.code === 'Space') return 'Space';
if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
if (/^Arrow/.test(e.key)) return e.key;
return null;
}
return {
install: function () {
window.addEventListener('keydown', function (e) {
if (SCROLL.indexOf(e.key) >= 0) e.preventDefault();
if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
if (VPC.Portal.busy) return;
var k = name(e);
if (k && handlers && handlers[k]) {
e.preventDefault();
handlers[k]();
}
});
window.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
},
/** Binds { R: fn, Enter: fn, Space: fn, ArrowLeft: fn, 1: fn } while [scene] runs. */
bind: function (scene, map) {
handlers = map;
scene.events.once('shutdown', function () { if (handlers === map) handlers = null; });
},
};
})();
'use strict';
VPC.Juice = (function () {
function canvasTexture(scene, key, w, h, draw) {
if (scene.textures.exists(key)) return;
var t = scene.textures.createCanvas(key, w, h);
draw(t.context, w, h);
t.refresh();
}
function emitter(scene, key, color, size, speed, gravity) {
var cache = scene.__vpcEmitters || (scene.__vpcEmitters = {});
var id = [key, color, size, speed, gravity].join(':');
if (cache[id] && cache[id].scene) return cache[id];
var e = scene.add.particles(0, 0, key, {
emitting: false,
lifespan: { min: 450, max: 800 },
speed: { min: 140 * speed, max: 420 * speed },
angle: { min: 0, max: 360 },
scale: { start: size, end: size * 0.2 },
alpha: { start: 1, end: 0 },
rotate: { min: 0, max: 360 },
gravityY: gravity,
tint: color,
});
e.setDepth(50);
cache[id] = e;
return e;
}
return {
/** Boot: shared particle textures. */
textures: function (scene) {
canvasTexture(scene, 'vpc-px', 12, 12, function (c, w, h) { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); });
canvasTexture(scene, 'vpc-dot', 32, 32, function (c) {
var g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
g.addColorStop(0, 'rgba(255,255,255,1)');
g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
g.addColorStop(1, 'rgba(255,255,255,0)');
c.fillStyle = g;
c.fillRect(0, 0, 32, 32);
});
canvasTexture(scene, 'vpc-confetti', 10, 16, function (c, w, h) { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); });
},
/** A burst of [count] particles at x, y. opts: color, count, size (scale), speed, key, gravity. */
burst: function (scene, x, y, opts) {
opts = opts || {};
var d = VPC.dpr();
var e = emitter(scene, opts.key || 'vpc-px', opts.color === undefined ? 0xffffff : opts.color,
(opts.size || 1) * d, (opts.speed || 1) * d, (opts.gravity === undefined ? 700 : opts.gravity) * d);
e.explode(opts.count || 14, x, y);
return e;
},
/** Confetti falling over the whole view (wins). */
confetti: function (scene, colors, count) {
var v = VPC.view(scene);
(colors || [0xff2e7e, 0x1fa8ff, 0xffc800, 0x14d99a, 0xff7a1a, 0x9b4dff]).forEach(function (c) {
var e = scene.add.particles(0, 0, 'vpc-confetti', {
emitting: false,
x: { min: 0, max: v.w },
y: { min: -40 * v.s, max: -10 * v.s },
lifespan: 2600,
speedY: { min: 160 * v.s, max: 360 * v.s },
speedX: { min: -80 * v.s, max: 80 * v.s },
rotate: { start: 0, end: 540 },
scaleX: { min: 0.6 * v.s, max: 1.1 * v.s },
scaleY: { min: 0.6 * v.s, max: 1.1 * v.s },
alpha: { start: 1, end: 0.6 },
tint: c,
});
e.setDepth(900);
e.explode(Math.round((count || 90) / 6));
scene.time.delayedCall(3000, function () { e.destroy(); });
});
},
/** Camera shake; amount 0-1 (0.3 = a solid hit). */
shake: function (scene, amount, ms) {
scene.cameras.main.shake(ms || 160, 0.012 * Math.min(1, amount));
},
/** Quick scale punch (buttons, counters). */
punch: function (scene, target, amount) {
var sx = target.__baseScale || target.scaleX;
target.__baseScale = sx;
scene.tweens.killTweensOf(target);
target.setScale(sx * (1 + (amount || 0.18)));
scene.tweens.add({ targets: target, scaleX: sx, scaleY: sx, duration: 220, ease: 'Back.easeOut' });
},
/** Grows [target] in from nothing (cards, stars). */
popIn: function (scene, target, delay, scale) {
var s = scale || target.scaleX || 1;
target.setScale(0);
return scene.tweens.add({ targets: target, scaleX: s, scaleY: s, duration: 380, delay: delay || 0, ease: 'Back.easeOut' });
},
/** Text that rises and fades ("+1", "MEGA CHAIN!"). */
floatText: function (scene, x, y, text, style) {
var t = scene.add.text(x, y, text, style).setOrigin(0.5).setDepth(800);
scene.tweens.add({ targets: t, y: y - 60 * VPC.dpr(), alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: function () { t.destroy(); } });
return t;
},
/** A ring that grows and fades (missed taps, hits). */
ripple: function (scene, x, y, radius, color) {
var g = scene.add.circle(x, y, radius, 0, 0).setStrokeStyle(3 * VPC.dpr(), color === undefined ? 0xffffff : color, 0.9).setDepth(60);
g.setScale(0.3);
scene.tweens.add({ targets: g, scale: 1, alpha: 0, duration: 400, ease: 'Cubic.easeOut', onComplete: function () { g.destroy(); } });
},
canvasTexture: canvasTexture,
};
})();
'use strict';
VPC.UI = (function () {
var theme = {
font: 'system-ui, sans-serif',
ink: '#222222', muted: '#666666', panel: '#ffffff', page: '#eeeeee',
primary: '#ff4f87', primaryLip: '#c92e62', primaryInk: '#ffffff',
button: '#ffffff', buttonLip: '#d9c2ae', buttonInk: '#333333',
star: '#ffc23d', starInk: '#4a2a00', badge: '#3a1230', badgeInk: '#ffd84d',
free: '#14b886', dim: 'rgba(0,0,0,0.45)',
};
function hex(c) { return Phaser.Display.Color.HexStringToColor(c).color; }
function s() { return VPC.dpr(); }
var ICONS = {
back: function (c) { c.lineWidth = 9; arrow(c, 46, 32, 18, 32, 14); },
next: function (c) { c.lineWidth = 9; arrow(c, 18, 32, 46, 32, 14); },
play: function (c) { poly(c, [[22, 14], [50, 32], [22, 50]]); c.fill(); },
help: function (c) {
c.lineWidth = 8; c.beginPath(); c.arc(32, 24, 11, Math.PI * 1.05, Math.PI * 2.35); c.stroke();
c.beginPath(); c.moveTo(34, 35); c.lineTo(32, 42); c.stroke(); dot(c, 32, 52, 5);
},
restart: function (c) {
c.lineWidth = 8; c.beginPath(); c.arc(32, 34, 16, Math.PI * 1.25, Math.PI * 2.9); c.stroke();
poly(c, [[10, 12], [28, 18], [12, 30]]); c.fill();
},
bulb: function (c) {
c.beginPath(); c.arc(32, 26, 16, Math.PI * 0.8, Math.PI * 2.2); c.lineTo(38, 44); c.lineTo(26, 44); c.closePath(); c.fill();
c.fillRect(25, 47, 14, 5); c.fillRect(27, 54, 10, 4);
},
tap: function (c) {
c.lineWidth = 6; c.beginPath(); c.arc(32, 18, 9, Math.PI, Math.PI * 2); c.stroke();
roundRect(c, 26, 16, 12, 30, 6); c.fill(); roundRect(c, 20, 34, 28, 22, 9); c.fill();
},
sound: function (c) {
poly(c, [[10, 24], [22, 24], [34, 12], [34, 52], [22, 40], [10, 40]]); c.fill();
c.lineWidth = 6; c.beginPath(); c.arc(34, 32, 12, -0.8, 0.8); c.stroke(); c.beginPath(); c.arc(34, 32, 22, -0.8, 0.8); c.stroke();
},
mute: function (c) {
poly(c, [[10, 24], [22, 24], [34, 12], [34, 52], [22, 40], [10, 40]]); c.fill();
c.lineWidth = 6; c.beginPath(); c.moveTo(42, 24); c.lineTo(56, 40); c.moveTo(56, 24); c.lineTo(42, 40); c.stroke();
},
music: function (c) {
c.fillRect(24, 12, 6, 34); c.fillRect(44, 8, 6, 34); poly(c, [[24, 12], [50, 6], [50, 16], [24, 22]]); c.fill();
ellipse(c, 20, 47, 9, 7); ellipse(c, 40, 43, 9, 7);
},
lock: function (c) {
c.lineWidth = 7; c.beginPath(); c.arc(32, 26, 11, Math.PI, 0); c.lineTo(43, 32); c.moveTo(21, 32); c.lineTo(21, 26); c.stroke();
roundRect(c, 14, 30, 36, 26, 6); c.fill();
},
star: function (c) {
c.beginPath();
for (var k = 0; k < 10; k++) {
var a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 12 : 28;
c.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r);
}
c.closePath(); c.fill();
},
grid: function (c) { [14, 34].forEach(function (x) { [14, 34].forEach(function (y) { roundRect(c, x, y, 16, 16, 4); c.fill(); }); }); },
calendar: function (c) {
roundRect(c, 10, 14, 44, 40, 7); c.fill(); c.clearRect(15, 26, 34, 23);
c.fillRect(19, 8, 6, 12); c.fillRect(39, 8, 6, 12); c.fillRect(20, 31, 8, 7); c.fillRect(36, 31, 8, 7); c.fillRect(20, 41, 8, 6);
},
check: function (c) { c.lineWidth = 10; c.lineJoin = 'round'; c.beginPath(); c.moveTo(14, 34); c.lineTo(27, 47); c.lineTo(51, 19); c.stroke(); },
home: function (c) { poly(c, [[32, 10], [56, 32], [48, 32], [48, 54], [16, 54], [16, 32], [8, 32]]); c.fill(); },
flame: function (c) {
c.beginPath(); c.moveTo(32, 6); c.bezierCurveTo(48, 22, 54, 34, 50, 44); c.bezierCurveTo(46, 56, 18, 58, 14, 44);
c.bezierCurveTo(10, 32, 22, 26, 24, 14); c.bezierCurveTo(28, 22, 30, 24, 32, 6); c.fill();
},
};
function poly(c, pts) { c.beginPath(); pts.forEach(function (p, i) { i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.closePath(); }
function dot(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, -0.3, 0, Math.PI * 2); c.fill(); }
function roundRect(c, x, y, w, h, r) {
c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function arrow(c, x0, y0, x1, y1, head) {
c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
var a = Math.atan2(y1 - y0, x1 - x0);
c.moveTo(x1 + Math.cos(a + 2.4) * head, y1 + Math.sin(a + 2.4) * head); c.lineTo(x1, y1);
c.lineTo(x1 + Math.cos(a - 2.4) * head, y1 + Math.sin(a - 2.4) * head); c.stroke();
}
function drawHand(c) {
c.save(); c.translate(10, 6); c.lineJoin = 'round'; c.lineWidth = 5; c.strokeStyle = '#3a1230'; c.fillStyle = '#ffffff';
c.beginPath();
c.moveTo(22, 8); c.quadraticCurveTo(22, 0, 30, 0); c.quadraticCurveTo(38, 0, 38, 8); c.lineTo(38, 44);
c.quadraticCurveTo(46, 38, 52, 44); c.quadraticCurveTo(60, 40, 64, 48); c.quadraticCurveTo(72, 46, 74, 56);
c.lineTo(74, 82); c.quadraticCurveTo(74, 104, 52, 106); c.lineTo(40, 106); c.quadraticCurveTo(26, 106, 18, 92);
c.lineTo(4, 66); c.quadraticCurveTo(0, 56, 10, 56); c.quadraticCurveTo(16, 56, 22, 66); c.closePath();
c.fill(); c.stroke();
c.lineWidth = 3; c.beginPath(); c.moveTo(38, 48); c.lineTo(38, 62); c.moveTo(52, 46); c.lineTo(52, 62); c.moveTo(64, 50); c.lineTo(64, 64); c.stroke();
c.restore();
}
var metricsCache = {};
function metrics(weight, px) {
var key = weight + '|' + theme.font, m = metricsCache[key];
if (m === undefined) {
var c = document.createElement('canvas').getContext('2d');
c.font = weight + ' 100px ' + theme.font;
var t = c.measureText('|MHqgy');
m = metricsCache[key] = t.fontBoundingBoxAscent === undefined ? null
: { a: t.fontBoundingBoxAscent / 100, d: t.fontBoundingBoxDescent / 100 };
}
if (!m) return null; // old browser: let Phaser measure
var asc = Math.ceil(m.a * px), desc = Math.ceil(m.d * px);
return { ascent: asc, descent: desc, fontSize: asc + desc };
}
function text(scene, x, y, str, size, color, opts) {
opts = opts || {};
var px = Math.round(size * s()), weight = opts.weight || '700';
var st = {
fontFamily: theme.font, fontSize: px + 'px', fontStyle: weight,
color: color || theme.ink, align: opts.align || 'center',
};
var m = metrics(weight, px);
if (m) st.metrics = m;
if (opts.wrap) st.wordWrap = { width: opts.wrap * s(), useAdvancedWrap: true };
if (opts.stroke) { st.stroke = opts.stroke; st.strokeThickness = (opts.strokeWidth || 6) * s(); }
if (opts.shadow) st.shadow = { offsetX: 0, offsetY: (opts.shadowY === undefined ? 3 : opts.shadowY) * s(), color: opts.shadow, blur: (opts.blur || 0) * s(), fill: true, stroke: !!opts.stroke };
if (opts.lineSpacing) st.lineSpacing = opts.lineSpacing * s();
return scene.add.text(x, y, str, st).setOrigin(opts.ox === undefined ? 0.5 : opts.ox, opts.oy === undefined ? 0.5 : opts.oy);
}
/**
* opts: label, icon, primary, w, h (CSS px), fontSize, badge, onPress,
* enabled (default true), color/lip/ink overrides.
* Returns a Container with setEnabled, setBadge, setLabel, setPrimary,
* setSize2(w, h), press().
*/
var live = [];
function button(scene, opts) {
var u = s(), c = scene.add.container(0, 0);
c.__name = opts.label || opts.icon || 'button';
live.push(c);
c.once('destroy', function () { live = live.filter(function (b) { return b !== c; }); });
var g = scene.add.graphics(), label = null, icon = null, badgeBg = scene.add.graphics(), badge = null;
c.add(g);
var st = { w: opts.w || 200, h: opts.h || 56, enabled: opts.enabled !== false, primary: !!opts.primary, down: false, badge: opts.badge || '' };
if (opts.label) { label = text(scene, 0, 0, opts.label, opts.fontSize || 20, '#fff'); c.add(label); }
if (opts.icon) { icon = scene.add.image(0, 0, 'vpc-icon-' + opts.icon); c.add(icon); }
c.add(badgeBg);
function colors() {
if (opts.color) return [opts.color, opts.lip || opts.color, opts.ink || '#fff'];
return st.primary ? [theme.primary, theme.primaryLip, theme.primaryInk] : [theme.button, theme.buttonLip, theme.buttonInk];
}
function draw() {
var w = st.w * u, h = st.h * u, lip = 5 * u, r = Math.min(h / 2, 18 * u), off = st.down ? lip * 0.7 : 0;
var col = colors();
g.clear();
g.fillStyle(0x000000, 0.12).fillRoundedRect(-w / 2, -h / 2 + lip + 3 * u, w, h, r);
g.fillStyle(hex(col[1]), 1).fillRoundedRect(-w / 2, -h / 2 + lip, w, h, r);
g.fillStyle(hex(col[0]), 1).fillRoundedRect(-w / 2, -h / 2 + off, w, h, r);
g.fillStyle(0xffffff, st.primary ? 0.18 : 0.6).fillRoundedRect(-w / 2 + 6 * u, -h / 2 + off + 4 * u, w - 12 * u, h * 0.32, Math.min(r, h * 0.16));
var iconSize = Math.min(h * 0.5, 30 * u), gap = 8 * u;
var hasLabel = label && label.text, lw = hasLabel ? label.width : 0, iw = icon ? iconSize : 0, total = lw + iw + (hasLabel && icon ? gap : 0);
var x = -total / 2;
if (icon) {
icon.setDisplaySize(iconSize, iconSize).setTint(hex(col[2]));
icon.setPosition(x + iw / 2, off);
x += iw + gap;
}
if (label) {
if (label.style.color !== col[2]) label.setColor(col[2]); // setColor re-renders the text
label.setPosition(x + lw / 2, off - 1 * u);
var room = w - 20 * u - iw - (icon && hasLabel ? gap : 0);
label.setScale(lw > room ? room / lw : 1);
}
badgeBg.clear();
if (st.badge && !badge) { badge = text(scene, 0, 0, '', 13, theme.badgeInk, { weight: '800' }); c.add(badge); }
if (badge) badge.setText(st.badge);
if (st.badge) {
var bw = badge.width + 14 * u, bh = 22 * u, bx = w / 2 - bw * 0.65, by = -h / 2 - bh * 0.35 + off;
var free = /free|^×[1-9]/i.test(st.badge);
badgeBg.fillStyle(free ? hex(theme.free) : hex(theme.badge), 1).fillRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, bh / 2);
badgeBg.lineStyle(2 * u, 0xffffff, 1).strokeRoundedRect(bx - bw / 2, by - bh / 2, bw, bh, bh / 2);
var bc = free ? '#ffffff' : theme.badgeInk;
if (badge.style.color !== bc) badge.setColor(bc);
badge.setPosition(bx, by);
}
c.setAlpha(st.enabled ? 1 : 0.45);
c.setSize(w, h + lip);
if (c.input) c.input.hitArea.setTo(0, 0, w, h + lip);
}
c.setSize(st.w * u, st.h * u + 5 * u);
c.setInteractive({ useHandCursor: true });
c.on('pointerdown', function () {
if (!st.enabled || VPC.Portal.busy) return;
st.down = true; draw();
});
var release = function (fire) {
if (!st.down) return;
st.down = false; draw();
if (fire && st.enabled && !VPC.Portal.busy && opts.onPress) {
VPC.Audio.play('click', { volume: 0.9 });
opts.onPress();
}
};
c.on('pointerup', function () { release(true); });
c.on('pointerout', function () { release(false); });
c.setEnabled = function (on) { st.enabled = !!on; c.input.cursor = on ? 'pointer' : 'default'; draw(); return c; };
c.setBadge = function (b) { if (st.badge !== (b || '')) { st.badge = b || ''; draw(); } return c; };
c.setLabel = function (l) { if (label) { label.setScale(1).setText(l); if (l) c.__name = l; draw(); } return c; };
c.setPrimary = function (p) { if (st.primary !== !!p) { st.primary = !!p; draw(); } return c; };
c.setIcon = function (name) { if (icon) { icon.setTexture('vpc-icon-' + name); draw(); } return c; };
c.setSize2 = function (w, h) { st.w = w; st.h = h; draw(); return c; };
c.press = function () { if (st.enabled && opts.onPress) { VPC.Audio.play('click', { volume: 0.9 }); VPC.Juice.punch(scene, c, 0.1); opts.onPress(); } };
c.isEnabled = function () { return st.enabled; };
draw();
return c;
}
/**
* A modal card: a dim layer that eats input + a panel of [w] CSS px.
* build(card, u) adds children to card.panel (origin = panel top-centre)
* and returns the content height in game px. card.fit(view) re-centres
* (called on resize); card.close() animates out.
*/
function card(scene, w, build, opts) {
opts = opts || {};
var u = s(), v = VPC.view(scene);
var root = scene.add.container(0, 0).setDepth(opts.depth || 1000);
var dim = scene.add.rectangle(0, 0, v.w, v.h, hex(opts.dimColor || theme.page), opts.dimAlpha === undefined ? 0.65 : opts.dimAlpha).setOrigin(0);
dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, 100000, 100000), Phaser.Geom.Rectangle.Contains);
var panel = scene.add.container(0, 0), bg = scene.add.graphics();
panel.add(bg);
root.add([dim, panel]);
var api = { root: root, panel: panel, closed: false };
var h = build(api, u) + 24 * u;
var pw = w * u;
bg.fillStyle(0x000000, 0.18).fillRoundedRect(-pw / 2, 10 * u, pw, h, 26 * u);
bg.fillStyle(hex(opts.panel || theme.panel), 1).fillRoundedRect(-pw / 2, 0, pw, h, 26 * u);
if (opts.border) bg.lineStyle(3 * u, hex(opts.border), 1).strokeRoundedRect(-pw / 2, 0, pw, h, 26 * u);
api.fit = function (view) {
dim.setSize(view.w, view.h);
var k = Math.min(1, (view.w - 24 * u) / pw, (view.h - 24 * u) / (h + 10 * u));
panel.setScale(k);
panel.setPosition(view.w / 2, (view.h - h * k) / 2);
panel.__baseScale = k;
};
api.fit(v);
var k0 = panel.scaleX;
panel.setScale(k0 * 0.6).setAlpha(0);
dim.setAlpha(0);
scene.tweens.add({ targets: panel, scaleX: k0, scaleY: k0, alpha: 1, duration: 260, ease: 'Back.easeOut' });
scene.tweens.add({ targets: dim, alpha: 1, duration: 200 });
var onResize = function () { if (!api.closed) api.fit(VPC.view(scene)); };
scene.scale.on('resize', onResize);
api.close = function (then) {
if (api.closed) return;
api.closed = true;
scene.scale.off('resize', onResize);
scene.tweens.add({
targets: root, alpha: 0, duration: 160,
onComplete: function () { root.destroy(); if (then) then(); },
});
};
scene.events.once('shutdown', function () { scene.scale.off('resize', onResize); });
return api;
}
function toast(scene, msg, ms) {
var v = VPC.view(scene), u = v.s;
if (scene.__vpcToast) scene.__vpcToast.destroy();
var t = text(scene, 0, 0, msg, 16, '#ffffff', { wrap: Math.min(420, v.cssW - 40) });
var bg = scene.add.graphics();
var w = t.width + 36 * u, h = t.height + 22 * u;
bg.fillStyle(0x2a0f24, 0.92).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
var c = scene.add.container(v.w / 2, v.h - 70 * u, [bg, t]).setDepth(2000).setAlpha(0);
scene.__vpcToast = c;
scene.tweens.add({ targets: c, alpha: 1, y: v.h - 80 * u, duration: 180 });
scene.time.delayedCall(ms || 2000, function () {
if (!c.scene) return;
scene.tweens.add({ targets: c, alpha: 0, duration: 250, onComplete: function () { c.destroy(); } });
});
return c;
}
/**
* The wordless tapping hand, fingertip at (x, y). flip: point down from
* above (targets near the bottom edge, where the hand would be cut off).
*/
function hand(scene, x, y, scale, flip) {
var u = s() * (scale || 1), dy = flip ? -1 : 1;
var ring = scene.add.circle(0, 0, 26 * u, 0, 0).setStrokeStyle(5 * u, 0xffffff, 0.95);
var img = scene.add.image(0, 0, 'vpc-hand').setOrigin(0.36, flip ? 0.94 : 0.06).setScale(0.62 * u).setFlipY(!!flip);
var c = scene.add.container(x, y, [ring, img]).setDepth(700);
ring.setScale(0.2).setAlpha(0);
scene.tweens.chain({
targets: img, loop: -1,
tweens: [
{ x: 18 * u, y: 22 * u * dy, duration: 0 },
{ x: 0, y: 0, duration: 420, ease: 'Sine.easeOut' },
{ scaleX: 0.56 * u, scaleY: 0.56 * u, duration: 110, yoyo: true, onStart: function () {
ring.setScale(0.2).setAlpha(1);
scene.tweens.add({ targets: ring, scale: 1.4, alpha: 0, duration: 520, ease: 'Cubic.easeOut' });
} },
{ x: 18 * u, y: 22 * u * dy, duration: 420, delay: 380, ease: 'Sine.easeIn' },
],
});
c.setAlpha(0);
scene.tweens.add({ targets: c, alpha: 1, duration: 300, delay: 250 });
return c;
}
/** Buttons on screen now, in CSS px (window.vpcQA.buttons for the quality gate). */
function visibleButtons() {
var d = s();
return live.filter(function (c) {
if (!c.scene || !c.scene.sys.isActive()) return false;
for (var o = c; o; o = o.parentContainer) if (!o.visible || o.alpha === 0) return false;
return true;
}).map(function (c) {
var m = c.getWorldTransformMatrix(), w = c.width * Math.abs(m.scaleX), h = c.height * Math.abs(m.scaleY);
return { name: c.__name, x: Math.round((m.tx - w / 2) / d), y: Math.round((m.ty - h / 2) / d), w: Math.round(w / d), h: Math.round(h / d) };
});
}
return {
theme: theme,
visibleButtons: visibleButtons,
setTheme: function (t) { Object.assign(theme, t); },
hex: hex,
text: text,
button: button,
card: card,
toast: toast,
hand: hand,
textures: function (scene) {
Object.keys(ICONS).forEach(function (k) {
VPC.Juice.canvasTexture(scene, 'vpc-icon-' + k, 64, 64, function (c) {
c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineCap = 'round'; ICONS[k](c);
});
});
VPC.Juice.canvasTexture(scene, 'vpc-hand', 100, 120, drawHand);
},
roundRect: roundRect,
};
})();
'use strict';
VPC.PortalBackends = VPC.PortalBackends || {};
VPC.Portal = (function () {
var DEFAULT_CADENCE = { freeWins: 10, every: 3, gapSec: 180, preroll: false };
var b = null, playing = false, prerollDone = false, lastAd = 0, started = Date.now();
var loaded = false, sentPlaying = false;
var winsSinceAd = 0, cooldownUntil = 0, listeners = [];
var api;
function backend() {
if (b) return b;
var id = VPC.build.portal || 'none';
b = VPC.PortalBackends[id] || VPC.PortalBackends.none;
if (!VPC.PortalBackends[id]) console.warn('[vpc] no portal backend "' + id + '", using none');
return b;
}
function cadence() { return Object.assign({}, DEFAULT_CADENCE, backend().cadence || {}, VPC.build.adRules || {}); }
function notify() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
var fake = VPC.local ? VPC.query('fakeAd') : null;
function simulate(kind, onStart) {
return new Promise(function (done) {
if (fake === 'fail') { done([false, 'unfilled']); return; }
var d = document.createElement('div');
d.textContent = 'SIMULATED ' + kind.toUpperCase() + ' AD';
d.id = 'vpc-fake-ad';
d.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
'background:#000d;color:#fff;font:700 22px system-ui';
document.body.appendChild(d);
onStart();
setTimeout(function () { d.remove(); done([true, '']); }, 2000);
});
}
function blocker() {
var d = document.createElement('div');
d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:transparent';
d.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
document.body.appendChild(d);
return d;
}
function send(on, resume) {
if (!loaded || on === sentPlaying) return;
sentPlaying = on;
try {
if (on) backend().gameplayStart && backend().gameplayStart(!!resume);
else backend().gameplayStop && backend().gameplayStop();
} catch (e) { VPC.log('gameplay event failed', String(e)); }
if (on && !resume && window.vpcQAEvent) window.vpcQAEvent('gameplay');
}
function setPlaying(on, resume) {
if (on === playing) return;
playing = on;
send(on, resume);
if (on && !resume && !prerollDone && cadence().preroll && api.hasAds) {
prerollDone = true;
show('interstitial');
}
}
/** Requests one ad with everything paused. Resolves [ok, reason]. */
function show(kind) {
if (api.busy) return Promise.resolve([false, 'busy']);
api.busy = true;
var block = blocker(), wasPlaying = playing, began = false;
var onStart = function () {
if (began) return;
began = true;
lastAd = Date.now();
VPC.Audio.duck('ad', true);
setPlaying(false);
if (VPC.game) VPC.game.loop.sleep();
};
var request = fake ? simulate(kind, onStart) : Promise.resolve().then(function () { return backend().requestAd(kind, onStart); });
var timeout = new Promise(function (r) { setTimeout(function () { r([false, 'timeout']); }, 90000); });
return Promise.race([request, timeout]).catch(function (e) { return [false, 'exception: ' + e]; }).then(function (res) {
if (began) {
lastAd = Date.now();
if (VPC.game) VPC.game.loop.wake();
VPC.Audio.duck('ad', false);
}
block.remove();
api.busy = false;
if (wasPlaying) setPlaying(true, true);
VPC.log(kind, 'ad', res[0] ? 'done' : 'failed: ' + res[1]);
return res;
});
}
api = {
busy: false,
get id() { return backend().id || VPC.build.portal; },
/** The build shows ads at all (interstitials). */
get hasAds() { return !!fake || !!(backend().hasAds && backend().hasAds()); },
/** The build has rewarded ads (else the game gives a free allowance). */
get rewardedSupported() { return !!fake || !!(backend().hasRewarded && backend().hasRewarded()); },
/** A rewarded button may be enabled now. */
rewardedReady: function () { return api.rewardedSupported && !api.busy && Date.now() >= cooldownUntil; },
onChange: function (f) { listeners.push(f); return function () { listeners = listeners.filter(function (g) { return g !== f; }); }; },
init: function () {
var be = backend();
if (be.onQuiet) be.onQuiet(function (quiet) { VPC.Audio.duck('platform', quiet); });
return Promise.resolve().then(function () { return be.init ? be.init() : null; }).catch(function (e) {
VPC.log('portal init failed', String(e));
});
},
loadSave: function () {
var be = backend();
if (!be.load) return Promise.resolve(null);
return Promise.resolve().then(be.load).catch(function () { return null; }).then(function (o) {
if (be.save) VPC.Save.onChange(debounce(function () { be.save(VPC.Save.snapshot()); }, 1000));
return o;
});
},
loadingDone: function () {
if (loaded) return;
loaded = true;
try { backend().loadingDone && backend().loadingDone(); } catch (e) {}
if (playing) send(true, false);
},
gameplayStart: function () { setPlaying(true, false); },
gameplayStop: function () { setPlaying(false); },
/** A level was won: happytime, then maybe an interstitial (cadence). */
levelWon: function () {
try { backend().happytime && backend().happytime(); } catch (e) {}
},
/** Leaving the win screen: shows a between-level ad when due. */
afterLevel: function () {
if (!api.hasAds) return Promise.resolve(false);
var c = cadence(), wins = VPC.Save.get('portal_wins', 0) + 1;
VPC.Save.set('portal_wins', wins);
winsSinceAd++;
if (wins <= c.freeWins || winsSinceAd < c.every) return Promise.resolve(false);
if (Date.now() - (lastAd || started) < c.gapSec * 1000) return Promise.resolve(false);
return api.showInterstitial();
},
showInterstitial: function () {
if (!api.hasAds) return Promise.resolve(false);
return show('interstitial').then(function (r) { if (r[0]) winsSinceAd = 0; return r[0]; });
},
showRewarded: function () {
if (!api.rewardedReady()) return Promise.resolve(false);
return show('rewarded').then(function (r) {
if (!r[0]) {
cooldownUntil = Date.now() + 30000;
setTimeout(notify, 30100);
notify();
}
return r[0];
});
},
};
function debounce(f, ms) {
var t = null;
return function () { clearTimeout(t); t = setTimeout(f, ms); };
}
return api;
})();
VPC.PortalBackends.none = {
id: 'none',
hasAds: function () { return false; },
hasRewarded: function () { return false; },
};
var BD = window.BD || (window.BD = {});
BD.SECTIONS = [['breeze', 'Breeze', 'Clear the sky with one tap'], ['gusty', 'Gusty', 'Bigger skies, fewer right answers'], ['storm', 'Storm', 'Armoured and bomb balloons'], ['double', 'Double', 'Two chains, two taps'], ['thunder', 'Thunder', 'Big skies, tough armour'], ['cyclone', 'Cyclone', 'Two chains, more traps'], ['hurricane', 'Hurricane', 'One right balloon. Find it'], ['tornado', 'Tornado', 'Arrows everywhere, most of them lie'], ['monsoon', 'Monsoon', 'Two chains in a crowded sky'], ['eclipse', 'Eclipse', 'The final skies']];
BD.WEB_LEVEL1 = [1,0,'7,2,0;4,2,26;4,5,04;4,0,04;1,5,7;7,5,;1,0,1;7,0,;0,4,;0,1,',[0]];
BD.LEVELS = [
[1,0,'5,4,04;3,4,7;2,3,;6,4,5',[0]],
[1,0,'5,2,34;3,4,567;6,2,5;3,3,;7,1,',[1]],
[1,0,'1,2,24;4,2,4;3,4,47;7,2,;5,4,7;1,4,',[2]],
[1,0,'4,5,4;4,4,;0,5,;2,5,47;2,3,;1,4,145',[3]],
[1,0,'2,5,4;5,5,25;1,4,23;4,2,;4,4,06;6,4,;1,5,',[4]],
[1,0,'6,4,6;5,0,7;1,2,045;4,1,5;0,2,;3,0,;4,2,36',[2]],
[1,0,'1,3,6;7,2,17;4,0,1;6,3,;5,2,35;7,0,02;7,1,12;6,2,1',[4]],
[1,0,'3,2,3;2,4,56;3,4,;2,3,36;4,2,3;2,2,47;6,5,5;0,0,27',[1]],
[1,0,'4,4,47;2,0,246;5,3,7;3,2,6;2,1,;3,1,;6,4,;3,3,456;3,0,2',[0]],
[1,0,'4,2,7;5,1,14;2,0,;5,0,045;5,2,;3,0,023;7,1,37;7,0,;3,1,34',[3]],
[1,0,'6,5,7;2,1,47;1,0,2;4,1,;5,4,457;6,3,13;6,4,;1,3,45',[0]],
[1,0,'5,3,6;2,2,357;0,5,5;3,5,06;5,5,;1,1,;2,3,145;3,2,0',[3]],
[1,0,'3,4,14;2,5,037;4,5,;6,5,;4,3,124;7,4,;0,5,;6,4,24;6,3,5',[4]],
[1,0,'7,5,;3,4,7;1,0,;6,5,045;2,5,;4,4,025;1,2,56;5,5,07;4,5,02;5,3,',[3]],
[1,0,'2,0,;5,3,4;1,4,346;4,4,257;4,5,;7,3,25;2,5,;2,2,6;1,2,',[2]],
[1,0,'1,3,3;6,4,46;3,2,;2,3,06;4,5,036;4,3,06;2,4,;2,1,;4,1,;4,2,036;6,2,5',[4]],
[1,0,'2,2,024;3,5,;2,3,17;5,0,;5,2,4;3,3,37;3,0,2;4,4,1;7,2,57',[6]],
[1,0,'5,5,;1,5,;3,4,5;1,1,0;2,4,124;2,5,;0,2,7;4,4,034;4,3,26;1,3,367',[9]],
[1,0,'5,3,1;2,1,;6,5,05;2,2,356;3,3,02;4,0,;0,3,6;2,5,06;3,5,05;7,4,',[2]],
[1,0,'1,2,;6,0,;3,0,;5,3,2;3,4,467;4,4,47;1,4,45;5,4,47;5,0,4;2,0,34;1,1,2;2,3,56',[6]],
[1,1,'4,0,267;2,4,46;4,2,124;7,0,2;3,4,1;1,4,;7,2,16;4,5,;2,3,1;4,3,27;5,4,1',[0]],
[1,1,'6,1,;5,3,236;5,0,6;6,4,012;4,4,0;3,4,;5,2,;6,2,016;5,5,0;5,4,03;6,5,35',[7]],
[1,1,'1,4,456;5,1,2;2,1,04;1,2,5;1,3,;3,3,47;2,4,256;2,3,7;6,3,;0,0,0;1,1,',[0]],
[1,1,'2,4,056;0,2,;0,4,6;2,2,013;0,3,;2,5,05;4,3,6;1,4,;1,5,025;3,3,36',[5]],
[1,1,'5,3,;2,0,;6,0,6;4,4,47;1,4,46;4,3,014;5,0,47;2,5,;1,1,;7,4,56;2,4,05;3,3,013;2,3,56',[5]],
[1,1,'4,2,01;2,1,07;6,3,2;7,3,12;5,5,0;3,5,6;2,3,5;5,1,013;2,2,1;0,4,4;3,3,023;4,1,03;3,4,',[7]],
[1,1,'6,3,267;7,1,;2,5,3;5,1,2;5,2,;3,1,2;6,0,03;2,2,245;3,0,02;4,2,;3,3,456;0,0,',[7]],
[1,1,'2,3,24;3,5,;6,0,;2,5,07;3,0,;3,3,567;0,0,24;1,4,56;3,4,367;3,2,4;0,2,03;6,1,;5,2,5',[8]],
[1,1,'3,4,045;2,5,6;5,4,;4,5,047;2,1,;4,3,26;1,4,45;5,0,145;3,2,7;7,0,1;5,5,',[7]],
[1,1,'0,1,47;1,2,27;2,1,014;2,4,156;4,2,05;3,4,;1,3,12;3,2,;1,4,;1,5,6;4,1,;2,3,036',[3]],
[1,1,'5,3,136;2,2,467;0,0,;6,0,;2,0,;4,5,67;5,0,0;4,1,45;5,4,56;7,5,2;6,3,6;5,2,;4,4,267',[8]],
[1,1,'2,2,13;0,0,25;1,3,2;7,4,0;3,2,16;2,3,46;3,1,;5,2,03;1,1,147;4,3,7;3,0,3;5,5,;2,1,235;0,3,',[8]],
[1,1,'7,3,246;3,5,026;4,4,15;7,0,6;4,2,;2,4,5;0,3,3;2,5,;6,2,25;3,3,037;0,0,;5,3,457;3,4,',[5]],
[1,1,'5,5,147;3,1,;4,5,;4,4,25;3,4,26;3,2,13;6,2,07;3,3,6;0,5,;6,5,;3,5,0;5,1,013;6,4,016',[12]],
[1,1,'5,1,034;2,4,;6,0,0;5,3,067;6,1,;2,3,5;2,5,;2,1,;6,2,467;4,2,1;3,5,057;5,0,3',[10]],
[1,1,'4,0,0;7,5,;1,2,;4,5,07;1,5,04;3,2,3;0,5,;3,5,136;2,2,345;2,5,456;7,4,;5,5,;1,4,23;6,5,45',[12]],
[1,1,'7,1,34;4,3,0;5,1,045;2,1,01;4,4,06;4,1,5;1,2,0;2,2,4;6,4,017;3,2,3;3,1,01;4,2,56;1,1,;2,4,',[8]],
[1,1,'2,3,67;1,4,34;1,2,;4,4,;6,0,2;4,3,27;6,2,4;5,1,256;4,1,024;5,0,;5,2,47;2,4,567;2,5,;2,1,',[1]],
[1,1,'3,4,5;5,2,0;3,2,;4,2,4;5,4,347;6,0,123;6,5,;7,3,;7,4,2;6,3,14;6,1,125;7,0,1',[5]],
[1,1,'2,2,;4,4,057;6,0,;4,0,;1,4,135;1,3,256;2,5,45;6,2,367;7,3,4;4,5,;4,1,5;1,1,3;5,0,',[5]],
[1,1,'0,2,;3,2,3;3,3,;2,0,24;5,1,46;1,3,567;5,0,04;3,1,3;2,3,035;5,3,016;6,0,7;5,4,;4,4,7;4,2,0',[9]],
[1,1,'5,5,3;6,2,024;4,4,06;7,4,01;1,2,347;6,5,;2,4,0;3,3,;6,3,3;7,2,3;5,2,2;4,2,0;3,4,06',[1]],
[1,1,'2,2,07;0,0,;6,5,0;3,3,047;4,2,137;0,2,2;0,4,6;2,4,567;1,3,3;4,3,2;4,5,6;6,3,2;0,3,4',[7]],
[1,1,'1,1,4;3,3,156;5,5,;6,5,;4,0,13;6,0,;2,2,37;2,4,5;3,2,13;2,3,6;5,0,012;5,2,2;3,1,5',[10]],
[1,1,'4,2,06;3,4,1;0,1,5;4,3,034;6,2,5;1,2,7;4,0,;3,3,27;2,5,4;7,2,5;5,4,056;6,3,56;7,1,6;5,3,7',[3]],
[1,1,'3,4,;1,5,4;4,3,35;2,5,;2,1,;1,3,246;6,5,;2,0,3;7,3,26;4,0,123;1,1,35;2,3,6;5,2,0;3,3,02;3,1,17',[9]],
[1,1,'4,1,;1,0,4;1,5,;3,3,34;2,4,156;4,3,7;7,1,;2,3,06;1,3,46;1,2,4;2,5,1;4,2,6;4,5,06;4,4,256',[4]],
[1,1,'2,4,0;5,2,5;6,1,7;7,5,5;6,5,467;5,1,126;6,0,4;0,4,;7,1,17;5,0,124;6,2,457;3,2,6;4,4,;7,2,;5,4,0',[4]],
[1,1,'3,1,;2,2,035;5,4,56;5,5,;6,0,01;7,2,126;1,1,7;6,1,367;1,2,6;7,0,;0,5,;3,2,01;4,2,04;7,4,',[7]],
[1,1,'3,5,4;0,0,3;2,0,0;6,4,;3,4,246;2,5,457;1,0,;7,2,;1,4,56;7,5,6;4,5,47;0,2,56;2,3,2;2,4,7',[5]],
[1,2,'4,3,07,a;3,3,235,b;0,1,1;4,5,;1,3,;1,0,17;3,4,3;4,2,045,a;6,1,;4,1,024;1,2,2;1,1,36',[9]],
[1,2,'4,4,147,a;3,5,0;1,1,1;4,3,246;5,4,;3,2,;0,5,;3,4,5;4,2,,b;5,0,17;5,3,16,a',[7]],
[1,2,'3,4,03;7,3,26;2,4,,a;1,3,45,b;4,1,1;4,5,15;4,4,067;1,4,4;5,5,257;1,1,26;2,3,4,a;7,1,;7,4,',[8]],
[1,2,'2,4,5,a;5,4,3,a;2,2,27;2,3,;3,4,47;4,4,14,b;2,5,456;6,4,;7,4,3;6,5,5;1,1,;4,5,67;4,2,03',[6]],
[1,2,'3,2,;3,4,356;6,3,067;5,4,5;0,1,,a;5,3,06;3,0,2,a;3,5,7;4,5,0;0,2,6,b;3,3,26',[3]],
[1,2,'6,4,47,a;5,2,1;6,5,046;2,5,;5,5,5;7,1,7;7,4,67;5,3,567;7,5,4;6,2,0;6,3,7,b;4,2,3,a',[2]],
[1,2,'1,3,;3,3,34;2,5,;6,2,3,a;5,5,017;1,1,27;3,0,034;5,3,4,b;6,1,;4,4,356,a;6,0,1;4,1,24,a;0,2,;0,0,237',[6]],
[1,2,'3,4,147;5,3,06;5,1,;3,2,234;2,1,3,a;6,5,0,b;4,5,,a;2,5,46;5,5,7;5,4,,a;0,1,6;4,2,235;1,2,57',[3]],
[1,2,'1,0,,a;5,3,,b;3,1,01,a;5,0,246;5,2,23;2,0,034;6,3,3,a;1,1,;6,0,014;4,2,27;4,4,;7,0,6',[5]],
[1,2,'3,2,,a;5,4,56,a;2,1,1,b;5,5,567;4,2,0;6,4,067;4,1,0,b;2,2,2,a;3,1,02;6,3,;5,2,57;6,1,0',[3]],
[1,2,'2,2,5;0,0,3;3,3,6,b;1,3,12;3,4,,a;2,0,023;0,5,6,b;1,5,,a;3,2,;2,3,013,a;0,4,4;3,1,124',[5]],
[1,2,'1,3,14;1,4,46;6,2,;5,2,04;2,3,,b;5,3,,a;2,4,2,a;4,1,134;3,4,567;3,3,45,a;4,3,4;3,2,3;1,2,2,b;5,1,1',[7]],
[1,2,'4,4,2;4,5,2;0,5,,a;1,3,,a;0,4,4;0,2,;2,4,456;0,3,256;3,3,5,a;2,5,067;4,2,05,b;2,3,013,b',[9]],
[1,2,'5,5,,a;1,5,56,b;4,2,1;6,5,456;3,3,036;1,3,;6,4,7,a;3,2,;4,3,23;3,5,4;2,4,,a;7,4,3,b;2,5,045;4,4,04',[12]],
[1,2,'2,5,;2,1,,a;2,3,025;0,0,4;3,1,06;2,0,13;0,2,,b;1,3,,a;2,4,5;3,2,057,b;1,0,,a;4,2,145;3,4,07;2,2,567',[12]],
[1,2,'2,3,0,a;7,1,;5,4,47,b;7,4,01;0,2,2;3,5,47;4,4,567,a;6,4,0;3,2,6,b;4,2,7,a;2,4,6;4,5,56;1,1,17',[5]],
[1,2,'5,1,136;3,1,024,b;5,3,057;7,4,;3,3,14;0,2,3;3,0,,b;4,3,;2,3,7;4,1,347,a;6,2,,a;3,2,01,a;1,1,1;1,2,',[2]],
[1,2,'4,3,;0,4,4;5,0,3,a;1,3,012;1,0,0,a;3,3,6;2,2,013;0,0,2;0,3,6,b;4,0,012;1,4,456,a;3,2,357;5,4,,a;4,4,,b',[9]],
[1,2,'6,4,;4,2,6;1,2,,a;5,3,3,b;4,1,3;4,4,056,a;2,2,;5,5,056;6,2,0;2,5,56,a;3,4,147;5,4,16,a;3,5,5,b',[7]],
[1,2,'3,1,145;5,2,3,b;6,1,2;1,3,236;1,4,1;5,1,4;0,5,,a;4,3,5,a;4,0,7,b;3,4,6;4,1,124,a;3,2,6;3,0,5,a;1,0,34',[9]],
[1,2,'1,3,25,b;4,4,;5,4,27;3,5,047;1,4,147,a;5,2,1;2,5,5,a;5,5,6;4,3,2;3,2,013,a;2,3,2;2,2,,b;0,3,,a;1,2,25',[3]],
[1,2,'4,0,04,b;5,1,037,a;6,2,;2,5,,a;3,4,015;5,0,26,a;1,5,6;6,1,,b;4,1,3;3,5,;1,0,,a;3,2,125;1,4,3;2,4,13',[11]],
[1,2,'2,0,4,a;3,1,024;4,4,5;5,4,,a;7,1,1,b;1,1,37;5,3,1,b;4,2,2,a;3,3,4;5,1,15;6,0,7;6,3,12;6,4,067,a;0,0,4',[1]],
[1,2,'5,1,4;0,2,,b;6,5,56;2,4,34;5,5,467;7,5,;6,1,,a;3,5,0;5,3,367,b;4,3,45,a;6,4,0;3,4,,a;4,2,012,a;2,2,0',[4]],
[1,2,'7,3,,a;5,2,13,a;5,3,2;3,4,5;7,1,;6,2,34;4,3,7;2,0,4;1,2,,a;3,0,014;6,3,3,b;3,2,5;4,2,023,b;6,0,124,a;7,0,12',[9]],
[1,2,'5,1,135,a;7,0,5;7,1,05;5,2,5,b;4,5,;7,2,26;6,3,15;6,5,567;3,2,,a;3,4,,b;7,3,4;2,4,5,a;6,0,,a;2,1,34;4,3,157;7,4,05',[7]],
[1,2,'3,1,23,a;1,1,3;2,3,134,b;3,3,5,b;1,4,16;6,3,4,a;5,3,37;4,5,5,a;3,4,267;6,0,;2,5,46;6,4,6;3,5,4,a;3,2,1,b',[10]],
[1,2,'7,2,237,a;7,3,14,a;5,2,03,a;3,4,47;4,4,167,b;0,1,;6,3,,b;3,3,6;3,0,02;6,1,14,b;4,2,457;4,3,;4,5,57;3,5,0,a;3,1,',[12]],
[1,2,'3,1,126,a;1,1,2;3,3,,a;1,2,014,b;1,4,5;2,0,023;3,0,36,a;4,4,;2,3,,b;4,1,023,b;0,0,23;0,2,;0,3,2,a;0,4,4',[5]],
[1,2,'4,0,,a;3,4,;5,0,0,a;5,5,,a;4,1,137,b;6,0,3,a;6,3,127,a;3,3,245;3,5,;3,0,46;7,1,1;6,5,,b;5,2,25;3,2,;5,3,7,b;5,4,067',[7]],
[1,2,'5,2,;3,3,346;3,2,056,a;6,4,26;7,2,0,b;6,5,7,a;3,1,15;2,2,,a;5,3,167;5,1,7,b;5,4,7;5,0,,a;4,4,3;4,2,4;6,1,1,a;5,5,356,b',[1]],
[1,2,'4,0,014,a;1,0,03,a;2,1,,b;4,2,;3,2,017;3,1,13,a;6,0,,a;7,4,;0,0,13;1,3,15;7,3,026;1,2,23;4,3,1,b;0,4,6,a;6,2,37;1,4,;7,0,06,b',[14]],
[1,2,'4,2,27,b;1,5,056;2,5,;1,3,05;0,5,6;2,1,13,a;0,3,346,a;3,2,5;2,2,15;4,3,01,a;1,2,146,b;3,1,,a;2,3,,b;1,4,5;0,1,26;0,2,,a;1,1,4',[1]],
[1,2,'6,5,,b;3,5,27,a;2,4,01;3,2,234;4,2,37,a;6,2,02,a;1,0,1;4,4,4,b;3,3,3;4,3,;1,2,046,a;7,4,5;2,1,23;5,3,06;2,3,,a;5,2,,b;2,2,023',[12]],
[1,2,'2,0,3;5,2,1,b;0,1,,a;3,2,023;4,2,5;6,5,27,b;3,0,01;0,2,356;1,3,2,a;1,2,034,b;1,1,;2,2,23,a;1,4,;2,5,7;3,4,5,a;5,5,1,a',[6]],
[2,3,'4,3,57;5,5,,b;3,5,1;6,1,;2,4,3,a;6,0,1;2,1,24;4,1,7;3,0,024;7,5,;3,3,126;5,3,236;2,0,',[0,11]],
[2,3,'3,0,0,b;4,2,7;3,1,46;5,5,;2,5,47;4,1,6;4,3,13;0,3,;7,1,5;6,3,067;5,0,01;6,1,13;5,2,6,a;7,2,26',[1,9]],
[2,3,'4,3,04;3,4,5,a;1,4,45;4,4,5;4,1,;4,5,027;5,3,17;3,2,56;1,5,7;0,4,6;4,2,06,b;3,3,',[2,5]],
[2,3,'5,2,12;4,2,;5,4,457;2,5,;6,5,4;5,1,02;3,2,027;6,4,127,b;3,1,,a;2,1,25;4,0,12;3,4,;2,2,;3,0,3',[5,10]],
[2,3,'4,2,0,b;2,2,03;5,0,4;4,0,123;5,5,25;2,4,,a;6,0,1;6,2,6;6,3,016;4,3,;5,2,6;5,4,06',[3,8]],
[2,3,'3,4,06;1,4,;6,3,156;7,2,;5,4,37;2,2,357;6,5,6;4,4,0;4,0,0;4,3,3,b;0,0,0;6,1,,a;4,1,34',[5,12]],
[2,3,'3,3,7;7,0,,b;5,1,125;0,3,4;7,1,6;6,1,024;2,5,24;5,3,;2,3,;4,0,5;5,0,023;0,0,24;6,3,07;2,0,;6,0,1,a',[6,10]],
[2,3,'0,1,5;7,3,;3,2,24,a;6,3,247;5,5,;6,2,;3,4,7;4,4,235;4,2,;4,5,37;1,0,;5,4,457;4,1,,b',[7,11]],
[2,3,'6,4,5;1,4,;3,2,,b;2,1,;4,0,13;1,5,245;3,1,2,a;2,4,045;7,3,04;5,3,;7,2,0;3,0,134;5,4,45',[5,11]],
[2,3,'2,2,027;2,5,56;4,5,,b;1,2,2,a;1,1,06;1,0,6;0,0,47;4,3,2;1,3,2;3,4,;2,0,,a;3,0,1;2,1,035',[12,0]],
[2,3,'6,3,4,b;7,5,,a;0,4,7;6,2,47;6,5,056;4,5,4,a;4,0,247;6,0,;7,2,127;7,3,;1,2,3;1,3,146;7,4,;4,3,;5,0,',[4,11]],
[2,3,'2,0,2;4,2,3,b;5,0,0;3,2,034;1,0,46;4,1,2;4,3,016,a;6,4,;3,0,3;2,3,;5,2,037,a;6,1,;2,5,2;6,3,6',[2,4]],
[2,3,'5,2,4;5,3,346;0,1,2;6,4,4;4,0,1;6,3,;7,2,,a;0,2,4;3,2,045;2,1,0;7,4,4;2,2,47;2,0,134;4,1,25,a;4,2,,b',[12,9]],
[2,3,'3,2,36;1,5,0;0,0,13;1,1,7,a;1,4,;2,1,3,b;4,0,;3,1,045;0,2,5;2,4,037;3,5,56;6,2,47;4,3,17,a;5,1,',[1,9]],
[2,3,'7,3,2;3,3,46,a;5,2,3;3,1,4;5,3,1,a;1,2,3;2,2,347;6,4,;5,1,1;4,4,245;4,2,,b;2,3,;6,2,16;0,4,3;6,3,4;1,4,046',[6,15]],
[2,3,'1,5,56;1,4,5;2,3,34,b;6,2,0;1,3,3;5,1,36,a;4,5,34;3,4,5,a;5,3,456;2,4,05;5,4,016;5,0,;3,5,;7,3,',[0,10]],
[2,3,'0,2,6;1,2,046,a;0,1,4,b;4,5,6;2,2,5;4,0,04;0,0,;3,1,04;4,1,3;5,2,12;1,0,;5,0,12,a;1,3,5;3,0,12;3,2,57',[12,3]],
[2,3,'6,3,347,b;4,1,;3,0,;6,2,0;2,2,0,a;5,5,7;5,4,047;7,4,6;3,2,05;5,3,56,a;7,3,;1,2,;2,4,,b;6,5,67;7,1,014',[5,13]],
[2,3,'3,0,2;1,2,;1,0,35;4,0,34;2,4,4;4,4,7,b;6,2,156,b;1,1,123;6,1,,a;2,5,3;2,0,;3,5,07,a;2,1,;3,1,057',[0,2]],
[2,3,'4,1,4,b;6,3,1;4,5,047,b;1,3,3;4,3,257;2,4,047;4,4,34;5,5,;2,1,04;5,2,,a;5,1,01;1,4,;7,4,0;1,1,,a',[1,4]],
[2,3,'4,3,05;5,4,6,a;6,0,;2,2,4;6,4,01;1,3,7;6,5,056;6,3,1;2,4,347;2,5,,a;4,4,57;3,5,0;4,2,02;7,4,0,b;5,1,;7,1,07,b',[8,6]],
[2,3,'6,4,6;5,3,0;0,3,3;4,1,0,a;6,2,;1,1,23;3,1,35,b;4,0,,a;5,0,12;1,2,;5,1,23;1,3,156;3,3,26,b;0,4,6',[8,11]],
[2,3,'5,2,267;4,1,,b;1,2,0;1,0,4;4,2,,a;6,0,,b;5,3,5,a;2,3,245;3,0,15;4,4,;2,5,05;2,0,2;5,1,02;3,2,246;0,5,;6,2,36',[3,9]],
[2,3,'6,3,,a;3,0,3;3,3,467,b;0,4,7,a;1,3,04;6,4,07;0,3,2;4,0,05;5,1,1;3,4,,b;4,2,0;5,5,045;2,2,45;3,5,6;4,3,4;5,3,6',[4,11]],
[2,3,'6,3,067;4,5,06;6,1,;5,1,;6,0,04,a;4,0,1,a;6,4,6;6,2,16;3,5,2;4,3,14;3,1,;3,0,,b;7,0,2;7,1,0,b;4,4,135',[6,1]],
[2,3,'4,4,36;6,2,;6,5,;6,3,,b;3,2,,a;2,2,05,a;3,4,246;3,5,05;5,3,4;0,2,;2,3,356;4,0,27;2,5,;6,4,367;5,5,37;3,3,;4,2,26,b',[2,10]],
[2,3,'4,1,02,b;5,0,,a;1,0,;4,3,17,a;2,4,237;3,2,45,b;1,1,;2,5,5;6,5,4;5,2,16;4,4,;0,2,46;0,0,34;3,5,45;1,4,5;3,4,2,a',[4,14]],
[2,3,'4,4,;7,3,7;5,1,1,a;6,0,2;7,1,;6,2,67;6,1,,b;5,3,456,b;3,3,124;1,5,;5,0,24,a;1,2,04;3,4,7;2,4,0,a;4,5,036;6,3,24',[8,14]],
[2,3,'2,3,7;5,1,23;1,4,126;3,1,,a;2,5,6,b;7,3,06;1,5,,b;4,4,07;3,2,26;2,2,245;5,3,6;4,3,124;4,1,0;0,5,,a;1,2,;1,3,,a',[11,12]],
[2,3,'2,2,5;6,2,267;5,4,;2,5,;3,0,;2,1,7,a;3,1,036,b;5,2,046;6,3,12,a;5,3,,a;7,2,3,b;1,0,;5,1,27;4,0,05;6,1,03',[3,7]],
[2,3,'6,2,17;2,0,24;3,0,,a;2,4,5;2,5,24,a;2,2,;3,5,35,a;3,3,7;3,2,4;4,3,26;4,4,;2,1,3,b;3,4,17;5,2,45,b;1,2,34;4,1,;2,3,46',[3,12]],
[2,3,'4,2,357,b;6,3,4;4,3,;6,2,,b;7,0,;4,0,124;4,4,5,a;6,5,026;3,3,345,a;5,2,356;3,0,03;0,0,3;5,1,07;4,5,;5,3,,a;5,0,;2,1,',[7,10]],
[2,3,'2,5,6,a;3,5,57,a;1,2,125;0,2,;5,5,;6,5,07;0,3,,a;3,2,127;1,5,4;2,4,3;1,0,2,b;6,3,,b;3,0,13;7,1,;0,5,4;1,4,13;6,2,15;6,1,34',[5,17]],
[2,3,'3,1,034;6,4,6,a;5,0,27,b;4,1,135;2,0,3;0,4,34;4,2,;0,1,;6,3,127;1,5,047,b;5,1,1;6,1,237;4,5,0;5,2,5,a;3,2,;7,2,;1,4,,a;1,2,1',[4,17]],
[2,3,'1,0,3,a;6,1,;1,1,5;6,4,267;1,3,,a;1,2,046,b;4,2,267;0,4,5;0,2,2;2,1,1,a;6,5,5;2,0,1,b;4,1,47;6,3,;3,4,67;4,4,',[3,14]],
[1,4,'3,2,0,a;4,3,,b;4,0,15;6,1,;3,0,24;4,5,067;3,3,,b;5,2,567;4,1,7;1,1,;5,0,045,a;7,0,;1,2,6;2,5,057;2,3,45,a',[5]],
[1,4,'5,5,5,b;4,4,567,a;2,0,6,a;3,0,0,b;5,2,02;3,5,457;0,2,5;6,3,;5,1,;2,1,6;4,1,034,a;3,3,146;5,3,6;2,2,',[5]],
[1,4,'0,2,2;4,3,156;1,4,26;6,2,;0,4,6,a;1,3,,b;2,1,34,a;7,5,;3,4,2;4,2,34,b;2,2,147,a;1,1,4;7,0,02;2,5,567;7,2,;4,0,',[13]],
[1,4,'7,3,06,a;6,3,;4,0,013;1,4,17;1,3,26;1,0,1;0,5,;2,0,037,b;1,1,36,a;0,3,;7,2,26,b;4,2,45;0,1,235,a;5,1,0',[2]],
[1,4,'7,0,06;1,3,0;5,5,567,a;4,0,,a;2,4,;5,0,16,a;5,1,237;5,4,0;3,1,36;3,4,,b;7,3,17;0,3,5;2,2,012;6,4,57,b;5,2,5',[6]],
[1,4,'2,3,02;1,3,5;6,2,3,a;5,4,57;2,4,034;3,4,6,a;7,5,;5,1,123;7,3,12;3,2,14;0,4,,b;2,2,27;6,4,01,a;5,3,,b;3,5,0;4,3,047',[7]],
[1,4,'7,1,123,a;0,2,1;7,0,2;3,2,014,b;6,1,26;3,3,3,a;0,0,03;5,0,145;6,3,,a;6,2,,b;3,0,034;4,4,4;1,4,3;7,4,;2,2,0;5,2,5',[10]],
[1,4,'7,3,6;6,1,1;4,3,467;0,5,2;6,2,6;4,1,17,b;3,2,46;7,1,37;5,4,,a;5,2,,a;3,4,47;3,0,26,a;2,1,34;2,3,135;3,1,,b',[2]],
[1,4,'3,5,57,a;5,1,4;4,2,4;4,3,6,b;4,1,126,b;5,5,036;7,3,;6,1,5;3,2,2,a;2,4,45;5,0,;6,2,6,a;4,4,;7,0,012;5,2,357',[5]],
[1,4,'7,1,06;1,4,245;3,4,7,a;1,1,36;6,2,;7,2,16,b;5,1,13;3,2,257,a;2,3,2;4,2,,a;2,5,5;0,1,4;3,3,0,b;5,0,3;1,5,4;3,5,07',[1]],
[1,4,'1,3,257;1,1,247;1,2,;3,4,07,b;6,2,7;0,2,4;2,1,;1,5,,a;3,1,04;3,3,6,b;2,2,237;4,4,156;5,1,1,a;3,5,05,a;2,4,34,a',[0]],
[1,4,'1,4,03,b;0,4,7;6,2,7;4,5,07,a;4,2,026;4,0,;1,2,023;4,1,15;1,5,1,a;3,5,5,a;2,4,16,a;4,4,01,b;2,3,;6,4,67;1,3,23',[13]],
[1,4,'3,0,234;5,2,3,a;1,0,345;6,3,6;2,3,12;2,0,1,a;5,0,12;3,4,4,a;5,4,;2,5,27,b;2,2,;3,1,124,b;1,2,56;2,1,05,a;4,1,34',[12]],
[1,4,'4,5,;4,1,56,a;2,2,2;5,1,047;3,3,67;5,0,,a;5,3,67;6,1,06,a;4,2,5;2,5,4;3,1,234,a;1,5,456;1,2,;3,2,7,b;6,0,,b',[11]],
[1,4,'5,4,34,a;6,2,245,b;3,2,;6,5,05,a;6,4,,b;2,3,7;1,3,;5,3,257;4,0,;7,4,017;3,5,257;7,1,,a;6,3,57;2,0,2;5,0,012;3,0,13,a;7,2,',[14]],
[1,4,'3,4,034;2,1,34;1,2,235;5,2,5;6,5,36,a;6,4,,a;2,4,15;1,5,45;6,1,16,a;6,0,05;5,1,,b;1,4,1;4,2,24;5,4,,b;4,5,34,a',[2]],
[1,4,'5,5,046;2,4,;4,3,,a;2,3,03;0,3,14;7,5,,a;3,4,017,b;7,0,;4,5,46,a;5,2,015;2,2,;3,5,7,b;5,4,016,a;6,4,01;1,4,07',[13]],
[1,4,'3,0,12,a;4,5,456;5,3,02;2,3,,b;6,4,;3,4,7;1,4,26;1,1,46,b;4,4,057;5,4,3;1,3,2,a;2,0,4;1,0,45,a;3,1,2,a;6,5,0;5,5,5',[1]],
[1,4,'4,4,25,b;2,5,17;5,3,03;6,4,6,a;7,4,;7,2,4;4,5,45,a;7,3,125;4,3,35;7,1,126;6,2,1,a;7,0,47,b;6,5,34,a;1,4,4;7,5,7',[1]],
[1,4,'5,1,;1,1,3;6,0,,a;4,4,047,a;3,4,7,a;6,2,167;7,2,,b;6,5,016;4,5,015,b;1,2,;6,3,056;6,4,5;7,3,,a;4,3,56;3,5,2',[7]],
[1,4,'7,2,0;1,0,4,a;0,0,;3,1,2;4,3,07;0,4,;1,5,457;3,5,,b;4,2,037,b;3,2,2;1,2,567;2,1,,b;3,0,04,a;4,5,567,a;0,1,57;2,3,13;1,1,7,a',[6]],
[1,4,'5,1,17,a;6,1,01;0,1,6,a;4,1,,a;1,2,357;5,4,156;4,3,2;2,4,35;2,0,,b;6,2,,b;6,3,6,b;4,2,6,a;4,5,57;3,4,045;3,0,0;4,0,3',[4]],
[1,4,'2,4,346;4,3,035,a;4,4,456,b;3,4,345;3,5,,a;7,4,6;6,2,;3,3,;4,5,2;5,3,3;4,0,13;4,2,356;7,1,,b;6,0,;2,2,,a;5,4,247,a;7,0,,b',[0]],
[1,4,'1,0,;3,5,;4,3,7;4,5,5,a;7,0,;1,1,36;3,2,235,b;1,3,,b;3,3,023,a;4,4,27,a;7,2,5;3,0,123;1,2,6,b;3,4,024,a;5,4,12;5,0,34',[11]],
[1,4,'6,3,4,a;5,0,2;1,1,4;3,3,025,b;4,3,046,a;5,1,236;3,2,,b;3,1,1;2,2,026;0,0,;1,0,23;5,4,25;6,2,,b;0,3,46;2,4,,a;4,1,1,a',[10]],
[1,4,'5,2,,a;1,3,0;2,5,45,b;3,3,047;5,5,457;7,4,67;7,1,;2,2,02,b;6,3,5;0,3,56;1,2,46,a;7,2,6;7,5,,b;3,5,67,a;7,3,1,a;6,4,04',[4]],
[1,4,'4,1,134;5,3,067;6,1,24,a;6,4,,a;0,3,;5,1,134,b;5,0,145;2,1,1,b;2,0,3,a;2,3,7,a;4,2,;3,2,457;6,2,;7,0,;3,1,,b;2,4,5',[1]],
[1,4,'6,3,23,b;3,2,4;4,0,,b;4,5,045;7,5,06;0,5,2,a;2,3,5;3,4,6,a;5,2,,a;5,3,036;4,4,025;7,3,02;7,2,;2,5,0,b;5,0,3,a;4,2,167',[10]],
[1,4,'7,2,;3,0,134;4,3,1;4,1,0;7,3,26;5,2,135;7,4,,a;6,2,06,b;3,1,,b;6,0,07,a;6,4,567;7,1,0;4,0,04;2,1,4,a;7,0,26,a;6,1,;5,0,5,b',[10]],
[1,4,'2,4,1,a;5,1,02;5,0,023;2,1,237,b;2,2,37,a;7,2,1,a;6,0,124;5,5,;6,1,36;4,3,1,a;1,1,34;2,5,3;5,2,;7,4,4;7,5,6,b;4,2,134,b;2,0,',[2]],
[1,4,'6,4,27,a;3,1,04;6,1,06,a;6,5,,a;6,2,6;7,4,7,b;6,3,236;3,5,,a;3,2,256,b;5,0,5,a;4,1,;1,1,357;4,4,0,b;2,0,3;5,2,036;2,4,2',[14]],
[1,4,'1,0,123;2,2,;0,1,0;6,4,16;1,5,57,a;4,2,35;2,4,37,a;3,5,4;4,3,046,b;6,2,,a;3,3,17,b;5,5,;7,3,2,a;0,2,7;0,4,1;2,3,34;5,1,36,a;1,2,234,b',[0]],
[1,4,'1,4,,a;0,3,5;4,5,5;1,5,056;2,2,,b;2,5,047;3,3,6;4,2,02;0,5,;1,3,034,a;3,5,5,a;2,4,35,a;7,5,;4,4,35,a;2,3,36,b;7,2,25,b;4,3,016',[16]],
[1,4,'2,1,04,b;1,1,2;7,3,047;7,4,06,b;1,4,345;2,3,37;1,3,3,b;4,4,034,a;7,2,26;4,1,023;5,1,,a;1,2,5,a;2,4,67,a;3,4,;5,4,,a;2,5,;0,1,3',[9]],
[1,4,'2,3,4;4,2,04,b;0,4,236,a;6,2,;5,0,;2,4,05;4,5,4,a;1,4,015;4,3,5,a;1,1,0;3,5,457;4,1,;0,1,134;1,5,2,a;3,2,056;6,1,7,b;5,3,4,a;0,5,2,b',[10]],
[1,4,'2,3,,b;4,1,123;1,3,5;5,4,26,a;2,1,024;2,4,034,a;4,0,1;0,4,24,a;5,1,127;3,5,7;2,2,;6,3,;5,5,7,a;4,4,7,b;5,3,3,a;0,1,12;0,2,0,b;4,2,2',[4]],
[1,4,'0,5,24,a;1,5,467;6,5,;4,3,34;3,0,0;7,2,,a;5,0,3;1,1,;3,2,127,b;7,3,,b;5,2,067;1,3,;5,1,16;4,1,147,a;0,0,3;4,2,0,a;4,5,06,a;3,5,5,b',[10]],
[1,4,'4,0,014;5,0,0;1,1,,a;4,2,024;2,2,05;6,2,127;5,4,,a;4,4,47;7,3,;3,0,13,b;1,2,014,b;3,1,,a;4,1,,a;3,2,15,a;7,5,3;6,4,035,b;2,1,06',[3]],
[1,4,'0,1,;4,1,02;5,2,026,a;1,4,0;5,3,0,a;4,3,5,b;3,1,4;6,0,346,b;5,1,5,a;5,5,;6,3,04,a;2,3,17;3,2,,a;7,0,67;3,0,237;6,1,02;3,3,034,b',[14]],
[1,4,'3,2,,b;3,4,5;0,0,46,a;2,1,37,a;3,1,4;0,1,67,b;6,1,;3,3,367,b;1,2,367;3,0,012;3,5,;5,5,06,a;1,5,456;1,0,,a;4,3,,a;1,1,037;5,2,3;4,5,',[12]],
[2,5,'7,3,016,b;5,1,23;7,4,6;7,2,6;3,4,;2,3,3,a;4,3,346;4,1,17;4,2,;5,0,012;2,0,;6,1,1;5,2,013,a;6,2,0;5,4,,b',[9,11]],
[2,5,'3,5,67,b;4,2,016;1,3,5;1,5,2,a;6,1,;4,0,01;5,2,126;3,4,017;2,4,;6,4,6;3,1,;6,5,;5,4,034;2,5,4,b;5,1,;1,4,,a;3,2,1',[1,6]],
[2,5,'1,3,;3,3,0;6,2,125;2,5,67;3,5,167;0,3,4;4,2,237;5,5,;1,4,45,a;2,3,03,b;6,4,16,a;2,2,3;4,3,3;4,5,,b;3,1,6',[3,6]],
[2,5,'3,5,045;1,0,4;1,3,6;4,3,357;2,4,047;4,5,1;5,4,26,a;3,0,1;2,3,,b;4,4,4;0,1,3;1,4,25;1,5,5;5,2,;2,1,1,b;1,2,7,a;3,4,67',[0,3]],
[2,5,'4,1,0;3,1,;5,2,347;5,0,1;0,2,,a;2,4,,b;2,1,;7,1,5,a;6,3,01;7,2,6,b;4,5,6;2,2,025;2,0,145;1,1,345;3,3,4',[2,13]],
[2,5,'5,3,0,b;2,0,3;3,1,,b;4,1,03;6,0,13;5,0,012;2,3,67;1,2,26;3,0,02;7,4,67;5,1,247;7,1,012;2,1,,a;4,0,,a;4,2,;4,3,57;3,3,',[4,5]],
[2,5,'2,0,01,b;2,1,56;4,5,,a;1,1,46,a;0,0,36;0,2,2;4,1,125;3,2,03;2,3,056;5,1,,b;1,3,3;6,3,1;5,0,27;3,0,7;4,3,',[8,11]],
[2,5,'3,3,147;2,3,1;1,0,02;0,0,0;3,5,,a;6,0,;4,5,0,b;6,5,05,a;1,3,456;6,2,256;3,2,7,b;6,1,6;1,5,4;0,2,;4,3,5;1,2,034;3,1,46',[8,9]],
[2,5,'5,3,356,b;5,2,;1,1,234;1,4,12;5,4,;4,2,13;6,4,;3,1,5,b;4,0,03,a;3,0,1;7,1,0;3,4,4;4,5,567;7,5,,a;4,4,56',[12,2]],
[2,5,'1,5,057;3,4,;7,4,0;5,3,137;4,2,37;4,4,01,b;2,0,6;0,5,,a;4,1,345;6,4,1;0,4,246;0,3,3,b;5,1,;5,5,,a;3,3,4',[0,8]],
[2,5,'6,3,26;6,0,34;0,3,1;3,3,247;1,2,47,a;0,0,,a;0,1,6,b;4,3,23;3,4,37;4,5,,b;7,0,1;4,1,34;1,1,4;1,4,167;6,5,0;7,1,0;5,4,,a',[3,13]],
[2,5,'5,5,7;7,2,;1,4,4;3,4,56,a;4,2,16;4,3,6;3,0,035,a;4,1,15;5,1,45,a;2,0,;6,0,;6,3,;5,2,367;5,0,03,b;3,3,0,b;2,3,;6,1,235;2,5,15',[0,17]],
[2,5,'2,1,134;1,4,4;4,4,57,b;1,3,235;7,1,15;2,2,;3,1,,a;5,3,45;3,3,;3,2,26;6,5,4;0,3,03;5,1,456,a;6,2,,b;7,3,2,a;6,3,4;2,4,45;3,5,4',[0,3]],
[2,5,'5,0,;2,0,46,b;6,1,6,a;1,3,56;3,1,4,a;2,2,67;2,5,5;3,3,146;4,1,;1,5,0,b;2,3,02;6,3,7;1,1,,a;5,2,67;1,2,45;6,0,357',[7,10]],
[2,5,'1,0,;5,4,,b;3,5,017,b;3,2,123;0,5,6,a;1,3,015;0,2,3,a;7,4,1;0,4,0;2,5,;6,5,056;2,4,467;4,1,07,a;3,4,;6,4,;0,3,;4,5,567;6,3,7',[0,3]],
[2,5,'6,4,0;1,0,;5,5,;5,1,4;6,5,15;5,0,,b;6,0,5,a;7,4,4,a;3,2,457;4,4,347,b;1,1,3,a;3,3,57;2,3,245;7,1,1;2,5,5;6,2,;5,4,36',[7,12]],
[2,5,'7,4,6;5,3,456;1,0,;6,2,,a;3,4,3;7,0,,a;6,3,05,b;2,2,2;5,1,45;6,5,,a;5,2,1;7,2,;7,1,026,b;7,5,0;7,3,7;5,5,467',[2,15]],
[2,5,'2,0,;5,2,;6,2,1,a;4,0,34;6,5,6;3,3,027,a;0,4,2;3,2,1,a;3,4,04;5,0,2;1,4,023;4,3,037,b;2,4,;0,3,;5,1,04;4,1,023;3,1,;6,1,12,b',[0,3]],
[2,5,'4,3,,a;6,1,;2,3,4;3,1,5;1,4,;1,3,4,b;5,1,7,a;7,5,67;0,3,2;2,4,04;0,5,0;6,2,067;4,0,17;2,0,,a;4,2,137,b;2,1,167',[11,15]],
[2,5,'5,5,2;6,0,2;5,4,45;1,3,;1,2,035;3,3,35;2,3,23;3,5,4;4,3,,a;2,1,;5,2,27;3,4,256,b;6,1,;2,4,45,a;4,1,2;6,3,5,a;6,4,16,b',[3,4]],
[2,5,'7,4,7,a;6,1,02;7,2,01,b;6,5,6,b;2,5,;5,1,;3,2,4;4,5,14;6,4,4,a;1,3,045;4,2,34;4,0,245;7,0,0,a;4,1,;4,3,125;6,3,2,b',[6,9]],
[2,5,'0,4,,a;2,5,7;1,0,4,b;2,1,,a;5,1,0,b;6,0,14;2,4,016,a;1,4,07,b;2,3,156;4,0,;4,5,24;1,5,6;5,4,0;5,0,14;2,2,;4,3,127',[12,15]],
[2,5,'7,4,13;7,2,,a;6,4,03;5,4,,a;1,5,,b;7,5,02;1,4,,a;3,3,124;3,4,013,b;3,2,24;6,5,07;4,4,4;6,0,1;0,4,,b;3,1,1;6,3,235',[12,14]],
[2,5,'5,4,17;5,2,26;6,1,02;3,2,4;3,5,0,a;4,2,24;3,4,7,b;0,4,;0,1,;3,3,7,a;4,1,017,b;6,0,1;6,3,1;1,4,045,a;4,4,017;5,1,;3,1,0;0,5,,b',[2,11]],
[2,5,'1,4,3,b;2,2,27;4,4,1;0,3,3,b;2,4,01,a;3,0,;7,1,;6,0,,a;4,1,267,a;6,3,27;6,4,0;4,0,;3,3,067;1,1,7;5,1,145,b;5,3,6',[9,15]],
[2,5,'5,1,4;7,1,6,a;3,5,056;7,0,,b;1,0,,a;1,3,;3,2,1,b;5,4,07;4,4,26;3,0,017;3,3,056,a;1,2,16;7,2,16,b;4,3,7;1,5,;5,0,34',[2,15]],
[2,5,'6,0,013;6,1,3;6,4,1;6,2,2;2,2,;4,1,47,a;7,1,26,b;4,3,457;3,2,123;1,4,24;5,3,3;2,3,;7,2,;4,2,024,a;1,2,3;4,0,012,b;3,4,,a;3,0,,b',[14,0]],
[2,5,'4,4,27;4,0,04,a;3,1,0,b;5,4,;2,0,3;6,4,15,a;2,5,5,b;3,4,145;2,2,6;5,0,246,b;6,1,;7,0,0;5,5,6,a;5,3,237;7,3,57;3,0,1',[13,6]],
[2,5,'2,3,36;6,4,016;2,4,1;4,3,137;5,1,04,b;3,5,;4,5,035,b;5,5,4;6,5,,a;7,3,036;7,2,;3,1,;2,5,;2,0,2;6,1,6,a;5,4,06,a;6,2,013,b',[0,1]],
[2,5,'3,3,14;1,3,,a;1,4,017,a;4,1,67;0,4,;2,3,056,b;6,4,,a;4,3,15,b;6,0,02;0,5,0,b;4,4,;5,1,12;5,0,13;3,2,5;5,5,4;7,2,;5,3,234;2,4,046',[8,11]],
[2,5,'1,1,1;5,4,7;6,0,1;4,4,457;6,3,67;5,0,34;5,1,1;4,1,247;7,4,06,b;7,3,,a;7,1,2,a;3,2,,a;0,2,,a;5,3,2,b;6,1,26;6,2,013;3,3,6,b',[0,5]],
[2,5,'0,1,,b;2,2,147,b;0,3,,a;1,1,024;4,1,367;2,0,2;0,2,26;3,5,7;4,0,0;1,3,4,a;0,5,;2,1,2;0,4,24;1,4,01;3,1,4,a;3,0,1,a;3,2,,b;1,2,24',[5,7]],
[2,5,'3,3,,b;2,5,,a;1,5,,b;6,5,;7,1,2,b;4,3,15;2,4,16,a;2,1,5;6,0,14,a;1,4,4;6,4,12;5,0,04;3,5,36;4,1,245;6,1,2;1,1,34;5,1,7,a;2,3,3;4,4,056',[12,15]],
[2,5,'1,3,16,a;3,2,45,b;1,0,3,a;5,4,47,b;1,5,;7,4,345;1,4,5;3,5,4;2,2,,a;2,4,047;4,1,04,a;3,3,7;3,1,;4,4,14;5,5,,b;6,4,0;7,1,02;5,3,34;4,3,04',[4,9]],
[2,5,'0,4,5;3,3,267;0,2,,a;1,5,6,a;2,0,03;3,1,4;6,1,;6,3,,a;7,5,4;2,5,0,b;1,3,04,a;0,0,27,b;5,5,47;1,0,2;0,3,2;4,3,147;1,1,157,b',[7,12]],
[2,5,'5,5,;1,5,4,a;1,3,1,b;3,1,0,a;2,3,045;2,0,23;2,1,2;2,5,45,a;4,0,25,b;4,1,03;3,3,,b;4,2,167;3,4,,a;3,2,2;0,4,34;1,0,34;0,3,24;6,0,04',[15,17]],
[2,5,'1,2,346;5,0,03;0,3,36,a;2,5,0;4,5,;6,0,06,b;1,3,025;7,2,1,b;1,1,0,b;1,0,3;1,5,15;3,2,57,a;0,2,2;0,1,0;4,2,5;2,3,1;2,1,27,a;3,0,;4,0,,a',[6,0]],
[2,5,'0,2,,a;5,3,27,b;3,3,046;5,4,,a;1,5,14;4,2,,a;4,3,4;2,4,056;2,1,;4,4,5;5,5,;1,4,236;0,3,016,b;3,1,13,a;3,4,2;1,1,7,b;4,5,46',[7,14]],
[2,5,'7,5,67,b;0,1,,b;6,4,4,a;0,3,6;1,2,567,a;2,5,457;0,0,,b;1,0,4;5,2,7;4,3,;2,0,3;4,2,47;3,0,;4,5,467;7,2,,a;5,0,012;4,1,01,a',[15,5]],
[2,5,'3,5,1;0,5,,b;4,5,67;1,2,6;6,3,1;0,2,45,a;2,1,136,a;2,0,13;1,1,;5,2,,a;3,0,256;2,3,,b;4,3,5;4,1,07,a;2,5,367;1,4,156;3,2,,b;1,3,37',[4,14]],
[1,6,'6,5,0,b;3,5,,a;1,0,07,b;3,2,247;7,5,4,a;5,1,;7,2,27;5,5,4,a;4,1,23;0,0,02;4,3,;3,3,034,b;6,1,2;4,4,1;6,3,6,a;5,2,047;6,2,17',[15]],
[1,6,'3,4,034,a;2,3,6;2,0,034;3,1,024;4,0,347;3,2,257,a;4,5,4;7,3,;5,5,5,a;1,0,1,a;5,1,;5,3,57;1,3,47;7,1,6,b;2,1,,b;4,4,6,b',[12]],
[1,6,'3,3,045;2,3,37;7,2,6;4,2,34,a;4,5,;0,1,7,a;6,3,24,a;5,3,25,b;1,2,,b;6,5,567;4,4,7;3,5,456;5,5,6;7,3,7,b;6,4,7;2,2,0,a',[11]],
[1,6,'5,5,06;6,1,03;5,4,35,b;2,5,46,a;2,0,2,b;6,3,56,a;4,2,3,a;3,5,5;4,1,02;4,3,136,a;6,5,;4,0,012;3,0,2;2,1,46;2,4,1;6,4,4;2,2,;4,4,4,b',[11]],
[1,6,'0,5,46,b;1,1,234;5,5,,a;2,3,14,b;2,1,13;2,0,012;5,4,2;4,4,;1,2,0,b;1,5,14;6,1,02,a;1,4,06,a;6,4,0;0,4,;4,3,5,a;0,0,5',[5]],
[1,6,'0,3,;1,3,06,a;3,1,125,b;2,2,267;5,5,067;4,1,0;1,1,45,b;3,2,1;2,5,5;5,2,;0,5,46;3,5,7,a;4,0,67,a;1,0,5,b;5,4,7;2,0,0,a;0,2,2',[4]],
[1,6,'3,4,;0,2,34,a;0,3,,b;2,5,6,a;3,3,2;2,2,06;4,3,126,b;1,3,24;2,4,035,b;1,0,34;3,0,13;1,5,7;1,4,237,a;3,5,,a;4,2,2;3,2,014',[9]],
[1,6,'2,0,0,a;3,2,6;2,2,136,a;2,5,,b;5,2,5;6,1,047;4,1,;1,3,26;1,1,567;4,4,,b;3,1,146,b;0,5,3;2,1,346;2,3,56;1,4,123;0,0,2,a;4,3,15;5,1,7,a',[13]],
[1,6,'4,2,1,b;1,1,7;1,2,6;6,2,012,b;3,4,057;3,1,,a;0,5,06;4,3,24;5,3,47;1,4,,b;2,3,156,a;2,1,1,a;0,4,;3,2,467;7,3,0,a;4,5,',[4]],
[1,6,'2,0,046,a;4,5,5,a;4,2,35;7,2,67;3,0,27;5,3,5,a;2,3,236;0,0,4,b;4,4,56;6,0,0;5,0,0,b;6,2,24;5,4,12,b;2,4,04;1,4,45;6,4,,a;5,5,',[6]],
[1,6,'0,3,,a;2,4,26,a;1,4,17,b;6,1,;1,1,12;2,0,17;6,0,02,b;3,5,;3,1,247;4,0,34,a;5,3,2,a;3,4,045,b;7,3,07;0,2,,a;5,1,15;6,4,5;6,2,016',[8]],
[1,6,'6,3,03,a;3,0,57;5,2,,b;1,1,26,a;2,1,345;5,0,,b;7,5,5;5,4,,a;4,5,045;4,1,6;4,3,24,b;1,0,2;6,2,467;5,1,02;6,0,7;1,3,6,a;4,0,034,a;1,5,16',[4]],
[1,6,'3,1,236;2,4,34,b;5,0,,b;4,1,;5,4,6;5,2,16,a;3,3,024,a;6,3,,b;3,2,15;3,4,,a;2,1,34;4,3,034,a;5,3,46;0,3,3,a;3,0,6;1,4,47;4,2,247',[10]],
[1,6,'5,1,02,a;5,3,067;2,1,35,a;6,4,467;7,3,;4,3,,b;3,1,05;5,2,137,b;7,1,012,a;3,2,7;4,0,0;3,5,25;3,3,26,a;3,0,15;6,2,;7,4,6;4,2,05,b;6,1,4,a',[3]],
[1,6,'3,1,02,b;7,5,0;5,1,127;1,1,3;4,5,56;5,4,;4,4,34,a;7,3,26,a;2,4,,a;4,0,4,a;4,3,02;5,3,047;6,4,5,a;5,5,,b;3,4,;1,3,236;1,4,,b',[2]],
[1,6,'2,3,247;1,5,46;7,4,46,a;2,2,0,b;2,5,5;1,3,456,a;3,5,467,a;4,5,57,a;5,4,47,b;0,1,6;0,2,5;3,2,2;5,3,,a;7,3,0,b;3,4,24;1,1,6;1,0,7',[1]],
[1,6,'6,1,17,a;6,2,27,a;0,2,2;5,1,,b;7,0,1,b;5,0,01;5,2,05;6,0,03,a;4,5,05;4,0,0;3,3,15;7,1,1,a;3,5,27;4,1,6;2,0,45,a;7,3,6;6,3,046;1,5,7,b',[8]],
[1,6,'5,4,6,a;4,0,1;7,2,145,a;5,2,157;4,2,;7,4,67;3,1,;6,5,56;4,1,15,a;3,2,0;6,3,1,a;6,1,0,b;5,1,126;7,3,067;5,3,,b;2,2,35,b;6,4,6,a',[7]],
[1,6,'3,4,02;4,3,24;2,5,45;3,3,7;1,4,6,a;5,0,013;1,2,4;5,2,126;1,3,36;3,0,,a;1,1,14,b;3,5,167,a;0,2,1,a;6,1,,b;5,3,0,a;5,1,;4,1,5,b',[2]],
[1,6,'3,0,;1,1,;3,4,0;0,3,15,a;2,1,256,b;3,2,367;3,1,,a;4,4,67,a;1,2,;1,5,67;0,2,27,a;6,5,,b;2,4,047,a;1,4,57;4,1,;1,3,237,b;3,5,056',[16]],
[1,6,'5,4,6;0,1,2,b;5,1,1;4,2,,a;6,3,7;0,2,03;3,0,12,a;5,0,014;1,3,45,b;3,4,16;0,3,6;3,2,234,a;4,1,3;3,3,;1,2,357,a;2,1,27,b;2,3,,a',[7]],
[1,6,'1,5,347,a;3,1,2;6,2,,a;5,0,;3,2,4,b;1,4,467;1,3,046;2,0,234,b;2,2,2;0,4,3,a;2,1,36;1,1,4,a;1,2,47,b;1,0,2;0,2,;0,3,256;0,1,12,a',[5]],
[1,6,'5,5,0,a;0,0,23,b;0,2,236,a;2,4,0;5,0,013;7,1,0,a;2,5,07;0,5,45,b;4,3,;1,2,,b;4,0,01;2,1,,a;1,0,2;0,1,3;4,5,7,a;6,1,4;2,2,035;3,2,037;1,1,4',[4]],
[1,6,'6,4,,a;3,2,23,b;7,2,25;5,4,045;7,5,7;7,4,1;2,2,1;4,2,247,a;3,4,2,a;2,3,25;4,4,17,b;5,1,012;4,5,4;1,3,36,b;1,0,7,a;2,0,26;4,3,6,a;3,5,7;2,1,37',[11]],
[1,6,'3,4,17;3,1,0,a;4,3,13,a;2,5,1;0,0,0,b;3,3,027;0,3,245,b;4,1,,a;6,2,26;6,5,;4,4,567;4,2,7,b;0,2,02;6,4,127;1,2,,a;0,1,124,a;6,1,0;0,4,26;1,3,',[10]],
[1,6,'1,2,345,a;5,0,,a;5,4,246,b;3,2,067;3,0,;3,3,234,b;1,0,;3,4,3;5,1,46;0,0,;2,2,57,a;1,5,356;2,3,2;4,4,04,b;5,3,67,a;5,5,,a;3,1,36;6,1,5',[11]],
[1,6,'4,2,34,a;2,2,3,a;1,1,47,a;2,0,2;3,0,;0,3,67;3,2,045,b;2,3,567,a;3,3,;6,2,6,b;1,3,467;3,1,6;0,2,2;6,0,02;2,1,57,b;0,0,47;1,2,5;5,0,2,a',[10]],
[1,6,'5,5,6;2,2,023;3,5,6,b;5,4,0,a;3,1,;3,2,3,a;0,4,25;1,1,46;6,3,4;0,5,47;0,2,23;2,5,7,b;1,4,56,a;5,3,24,b;3,4,;1,3,3,a;3,3,024;1,0,05;2,4,03,a',[1]],
[1,6,'6,5,,b;4,2,137,a;2,5,267;3,2,47;1,3,,b;0,1,2;3,5,256,a;1,5,146;5,2,012;6,4,5,b;2,3,0;5,3,17;5,5,14;6,2,1,a;7,0,;0,3,6,a;2,0,;7,3,67,a;1,0,',[8]],
[1,6,'4,4,05;0,3,;7,3,1,b;2,2,123;2,5,03;6,0,5;3,4,03;5,2,023;0,4,46,b;6,3,056,a;4,5,,a;1,4,34;4,3,014;2,3,,a;5,4,4,b;7,2,5,a;7,4,16,a;5,3,',[7]],
[1,6,'4,4,05,b;5,1,017;4,5,0,a;2,5,4,b;6,1,456,b;6,4,1;4,0,,a;4,1,,a;6,3,045;4,3,125;4,2,56;6,0,0,a;7,0,35,a;7,2,3;1,4,;7,1,15;5,5,5;7,3,17;6,2,7,a',[8]],
[1,6,'5,3,37;1,3,,b;6,4,13,a;3,4,467,a;6,5,5;7,5,047;7,2,0;2,2,01;1,5,467;5,5,6;3,3,5;1,2,3,a;5,0,035,a;0,4,056;0,1,,a;4,2,5,b;4,5,47;3,1,,a;2,3,5,b',[8]],
[1,6,'7,2,26,b;3,0,24,a;3,2,256,a;5,0,3;4,0,6,a;0,2,,a;5,3,126;4,4,026;1,1,14,b;4,5,5,a;6,2,167;7,3,;3,3,7;3,1,3,b;6,5,067;4,2,,a;1,4,5;7,0,1',[14]],
[1,6,'1,5,;0,3,23;1,1,,b;3,2,013;2,2,036,a;4,5,;0,2,14;1,0,7,a;3,4,3;1,2,156,a;3,3,027;2,5,,b;2,1,03;3,5,0,a;3,1,02;0,1,245;1,4,36,b;0,4,,a;6,5,01,a',[14]],
[1,6,'1,0,0;6,3,,a;0,0,14;0,2,23,b;0,3,7,a;2,2,027;0,4,,a;4,2,124;2,3,;5,4,567,b;2,4,045;5,2,134,a;4,5,15;1,3,0,a;4,3,,a;5,3,7;1,4,15,b;3,3,35',[5]],
[1,6,'7,1,;2,1,04,b;3,2,057,a;1,4,;0,2,;5,2,,b;1,0,123;0,0,;3,1,346,a;0,4,26;5,0,6;4,1,4;3,5,567;5,3,2,b;3,0,07,a;2,2,16,a;1,1,127,a;6,2,0,a',[12]],
[1,6,'2,2,,a;3,3,4,b;2,1,56,b;5,1,14;6,5,6,a;1,0,03,b;1,2,3;3,2,037,a;4,4,67,a;7,1,6,a;2,4,6;6,4,034;3,4,2;5,3,1,a;7,5,17;7,4,;6,2,057;3,0,',[16]],
[1,6,'4,1,16,b;6,0,1,a;5,0,02,a;5,2,6;5,3,,b;1,5,06,a;3,0,34;2,2,34;1,3,4;3,1,136,b;3,2,,a;6,1,037;4,0,01,a;7,1,5;3,3,;4,2,134,a;5,1,05;7,2,6',[11]],
[1,6,'5,1,045,a;2,5,0,a;1,2,56;2,2,4,a;0,0,1;1,5,,b;0,5,46;3,1,3,b;5,2,26;4,2,2;1,3,236;1,4,1,b;4,4,2;7,5,,a;2,4,256,a;2,1,4;5,5,4,a;1,0,05',[10]],
[1,6,'4,3,357;2,0,145,b;4,0,04;4,4,;3,3,146,a;7,4,6;6,2,1,a;4,1,3,a;3,1,7,a;6,4,067;5,1,,b;6,0,13;4,2,125;5,2,0,a;3,4,3,a;3,0,2;2,4,,b;6,3,367',[9]],
[1,7,'5,5,;6,1,4,a;7,2,67;4,1,67;7,4,7;3,0,,a;6,0,4,a;3,1,15,b;5,0,014;4,0,137;5,1,,a;6,3,03,a;7,1,02,b;4,4,345;6,2,247',[13]],
[1,7,'7,4,6,a;6,2,0,b;7,2,047;5,3,6;1,3,2;4,3,123,a;7,5,67;6,1,,a;6,5,047;5,5,567;2,2,14,a;2,5,5;5,4,1,a;7,1,23;1,4,4;5,2,0,b',[8]],
[1,7,'2,0,1;0,2,356;4,4,156,a;1,2,,b;5,4,7,a;5,3,257,b;3,2,2,a;4,5,,a;3,1,1;0,1,56;3,5,14;4,1,23;2,4,467;1,5,256;2,3,456;6,3,;6,2,01,a',[13]],
[1,7,'6,0,,a;6,1,057,b;3,2,37;4,3,056;7,4,03;2,1,1;4,4,,a;1,3,2;7,0,1,a;5,3,0;4,1,345,a;5,1,4,a;5,0,024;1,4,247,b;1,2,7',[2]],
[1,7,'6,2,;0,5,,a;2,4,07;1,5,157;3,1,03;2,3,,b;1,1,,b;0,2,246,a;0,1,01,a;3,2,15;0,0,24;0,4,025,a;4,2,4;5,0,,a;2,0,25',[3]],
[1,7,'2,2,023;4,0,35,a;5,3,6;5,5,1,a;6,5,056;0,2,7;4,1,6;6,4,027,b;5,4,7,a;3,1,1,b;5,2,036;4,5,;5,0,14,a;6,0,7,a;6,3,023',[10]],
[1,7,'3,5,345;5,0,134;6,0,7,a;7,3,7,a;3,2,15,a;6,2,36;6,4,05;5,3,346,b;7,2,0;2,2,3,a;4,3,,b;5,5,,a;4,0,01;2,3,013;1,3,57;3,4,6;4,4,67',[0]],
[1,7,'7,2,;2,2,,a;3,1,147;3,5,7;2,3,47;6,5,4;3,4,456;7,5,67;6,4,267;5,1,0,b;3,3,037,a;4,2,057,b;6,2,17,a;0,1,4;1,1,03;5,5,0,a;4,1,,a',[6]],
[1,7,'2,0,034,a;2,2,026;1,0,0;0,3,34,b;6,4,147,a;5,3,36;2,5,67,b;5,0,01;0,5,47;7,4,0;2,3,2;5,5,,a;4,0,;1,2,,a;1,4,1,a',[1]],
[1,7,'3,2,014;0,1,,b;2,2,;1,5,345,a;2,4,017;2,0,;1,4,57,b;3,1,27;0,5,567,a;2,5,0,a;3,3,,a;2,1,124;1,3,6;4,2,145;0,4,,a;6,0,45;0,3,6',[11]],
[1,7,'6,5,6;6,1,456;4,0,234;4,1,045;6,2,,b;5,2,4,a;6,4,,a;7,3,036,b;3,1,;3,2,5;4,3,357;7,1,3,a;5,3,2,a;7,2,03,a;7,0,5;6,0,156',[2]],
[1,7,'4,3,017,a;1,4,04,a;1,3,7,a;6,2,2;2,3,14;3,3,;6,3,015;4,4,057;2,4,47;3,4,12,a;4,5,07,b;6,5,;0,2,7;5,4,137;2,5,6,b;4,1,134;3,5,,a',[15]],
[1,7,'2,4,346,a;1,4,456;2,0,0;4,4,,a;5,1,12,a;4,1,245;3,0,04,a;1,1,4;2,1,056;4,0,4,b;4,3,56,b;3,5,;6,0,7;0,0,47,a;5,3,',[1]],
[1,7,'3,4,046;3,1,134,a;1,5,06,a;2,0,;1,2,5;4,2,01;2,3,56;1,4,,a;4,1,346,b;5,1,0,b;0,5,5;0,4,345,a;6,4,;3,5,067;0,2,2;7,4,;2,4,067,a',[13]],
[1,7,'2,3,5;2,4,256,b;2,5,46,a;3,3,236;4,5,7,b;5,1,,a;6,5,4;4,4,24;7,4,012;1,3,5;3,1,016,a;2,1,,a;3,4,3,a;7,5,4;4,2,15',[14]],
[1,7,'5,3,03;4,1,145,a;4,4,2,a;3,0,23;3,2,3;6,4,0;3,3,245;3,5,;5,1,16,a;7,1,2,a;6,0,13;4,2,035,a;5,4,01,a;6,1,02;5,0,57,b;4,3,3,b',[3]],
[1,7,'1,5,0,a;4,4,0,b;0,1,2,a;0,4,356;2,2,27;1,4,0,a;5,5,07;1,1,06;3,5,45,a;3,1,127;2,3,1,b;1,3,2,a;4,5,6;2,0,;3,0,027;3,3,137;2,4,6,a',[14]],
[1,7,'7,1,67;5,2,16;0,0,013;4,0,1;3,2,0,a;3,3,467;5,3,1;4,4,02,a;2,1,6,b;1,2,,a;2,2,6,a;3,1,5,b;4,1,14,a;3,0,134,a;4,3,7;5,0,02',[5]],
[1,7,'6,4,457,b;1,3,56;6,2,57,a;1,5,16;6,3,,b;1,2,236,a;4,5,04;3,1,2,a;7,3,05;3,5,,a;3,3,1;7,2,124,a;4,2,034;4,0,;6,5,6;7,1,14,a;5,3,045',[12]],
[1,7,'3,5,25,b;5,1,3;2,2,67,a;2,3,156;1,4,,a;1,1,;0,3,24;1,3,13,a;6,2,07;3,3,06;2,4,05,a;3,0,15,a;0,5,456;2,1,0,a;0,1,5;3,1,5,b;4,1,07',[3]],
[1,7,'7,1,6;1,3,2,b;7,0,;5,4,345;2,5,567;0,5,2,a;6,4,,a;2,4,47;7,2,2;1,4,015,a;0,4,07,a;3,3,25,a;4,3,026,b;6,0,3;4,5,04;7,5,35,a',[4]],
[1,7,'6,3,15,a;2,2,,a;7,5,4;3,4,;7,1,012;2,0,2;4,4,247,b;6,4,45,b;7,2,012,a;6,0,123;7,4,02,a;5,3,6,a;4,2,267;4,5,67;5,2,6;5,0,;4,1,4,a',[9]],
[1,7,'3,3,026;4,2,6;1,2,,a;5,2,6;1,1,0,a;5,0,0;3,2,67;4,0,5;1,4,56;1,0,34,a;0,1,234,a;0,3,5;1,3,2,b;3,5,1,a;3,0,023,b;2,0,157;3,1,013,a',[0]],
[1,7,'6,2,235;3,3,;6,1,046;4,1,0,a;6,0,045;7,1,,a;1,2,37;1,5,05,a;5,1,013,a;6,3,5,a;4,3,013;4,0,2,b;7,2,,a;3,1,125;1,3,26;7,3,,b',[2]],
[1,7,'3,4,;1,5,567;4,1,236;5,1,4;2,3,457;5,3,,a;4,0,027;7,1,14,a;4,3,047,a;2,4,456,a;0,4,;0,3,1,a;1,3,05,b;6,3,1;2,1,4,a;3,1,6,b',[1]],
[1,7,'3,0,045;3,4,67,a;3,3,4,b;2,2,,a;5,2,2,a;0,3,6,a;0,1,2,a;4,3,015,b;4,1,036;2,1,;1,2,346;5,0,;1,1,05;1,5,56;3,2,56;0,0,2;2,3,36,a',[13]],
[1,7,'3,4,6,a;2,4,35;3,5,,b;6,0,,a;2,1,015;1,5,04;4,3,157;1,2,23;4,5,0,a;2,5,2;1,1,234;0,3,1,a;3,3,014;3,0,4,b;4,2,4;6,1,0,a;3,1,34,a',[10]],
[1,7,'1,3,03;2,1,,b;3,0,07,a;7,5,01;6,2,56;0,0,,a;6,1,6;5,3,03,b;4,3,5,a;5,1,012;3,1,12;4,2,247,a;2,3,06;2,0,02,a;2,4,6;4,5,016;4,1,7,a',[9]],
[1,7,'0,0,3;4,1,023,a;4,0,012;3,0,01;3,2,1;5,5,,a;6,3,167,a;0,1,3;3,1,5,a;2,0,16;3,4,056,b;7,4,7;2,1,0;0,4,,a;4,3,7,a;5,2,24,b;2,2,567',[16]],
[1,7,'4,5,167;2,3,3,a;2,0,1;3,4,27;5,0,013,b;4,1,7,a;5,5,0;4,0,,a;4,4,;3,5,;5,1,1,a;3,0,034,a;5,2,26,a;3,2,145,b;1,1,3;1,0,34',[15]],
[1,7,'5,4,27,a;1,2,123;4,3,6,a;1,5,7;5,0,7;0,3,456;6,3,5,a;1,4,;3,3,16,b;3,0,25,a;6,5,346;0,0,4;4,5,456,a;3,1,03;5,5,,a;4,4,35,b;7,2,7;0,4,6,b',[1]],
[1,7,'4,2,0;2,2,4,a;6,2,;3,0,12;2,0,,a;5,5,4;3,1,124;0,3,356,a;6,0,0,b;4,0,01,a;4,4,3,a;5,4,,b;0,0,4;3,3,046;5,1,357,b;7,3,15;3,2,47,a;4,3,234',[6]],
[1,7,'3,0,023;4,2,126;1,4,7;4,0,01;1,1,5,a;1,0,;4,4,5,a;0,4,,a;6,2,7,a;1,3,,b;0,0,134,a;3,1,01,a;3,3,027;5,2,04,b;0,3,6;3,4,0,b',[0]],
[1,7,'4,5,4,a;7,2,0,a;3,4,34;7,4,,a;7,3,245;5,3,37,a;3,1,;4,2,237;2,3,035;0,3,35,b;7,5,36;4,3,,a;5,4,16;6,2,26,a;6,3,,b;4,1,3;5,2,014,b;6,4,15',[8]],
[1,7,'2,3,247;3,2,5;2,5,5,b;3,1,12,a;4,1,014;3,3,1,a;2,2,14,a;5,1,06,b;0,2,4;1,5,1,a;3,4,,a;2,1,03;3,0,134;1,3,2,b;4,3,016;5,0,24,a;0,1,2;4,2,0',[12]],
[1,7,'2,5,07;5,0,03,a;3,2,6,a;1,5,56,a;4,4,57,a;5,3,07,b;3,3,1;1,2,14,a;0,3,247,b;5,1,56;2,4,345;6,0,,b;4,0,;1,3,;2,2,14,a;3,5,06',[10]],
[1,7,'4,0,;3,2,3;2,3,,a;2,0,3,a;4,3,0,a;6,1,02;6,2,012,a;7,3,27,b;2,2,2,b;3,1,057,b;5,3,4;6,5,07;2,1,5,a;7,4,26;4,5,7;1,3,457,a',[5]],
[1,7,'1,1,4;4,3,256;4,5,,a;0,4,24,a;5,5,47;0,5,06,a;5,4,4;3,4,025,b;3,5,02;2,1,,a;2,3,1,a;2,0,,b;2,2,246,b;1,4,046;4,1,137,a;5,2,27',[4]],
[1,7,'0,4,,a;2,4,047;3,3,,b;4,1,03,b;5,4,7;3,2,0,a;6,0,123;3,4,6,a;3,5,,a;1,3,046;2,1,,a;5,3,67;1,1,3,a;3,1,26,b;6,3,01;6,2,125;4,4,014;7,1,0',[6]],
[1,7,'5,3,236;4,5,456,a;4,2,,a;5,5,3,b;6,1,02;6,3,012;6,5,5;3,5,67,a;5,0,15,a;4,4,,a;7,4,13;2,4,36;3,3,025,a;6,4,27;2,3,,b;5,4,06,b',[4]],
[1,7,'2,2,;3,5,367;2,5,467,a;5,2,06,a;0,2,4;6,5,067;4,5,5,b;6,4,3,a;7,3,4,b;1,4,5;7,5,,a;4,2,1,a;7,4,7;3,3,2,a;4,3,025;6,3,34;3,4,17,b',[5]],
[1,7,'1,3,234,a;2,3,06;6,3,,a;2,5,,a;5,3,67;5,0,,a;4,3,025,b;3,0,,a;3,5,,b;5,5,06;5,2,3;5,1,36;3,1,567;2,0,06,a;4,0,1,b;1,4,136;6,5,07;4,5,56',[16]],
[1,7,'4,3,46;3,4,23,b;5,2,136;6,3,347,a;4,1,124,a;6,2,,a;3,5,7,a;4,5,;4,2,3;0,5,;7,2,2,b;5,1,37,a;7,4,347;3,2,124,b;6,1,013;6,4,2,a;7,3,1',[14]],
[1,7,'6,0,;4,3,3;1,4,26,a;4,5,06;2,2,346,a;5,0,012;5,1,45;5,2,4;3,1,246;6,5,;5,5,0,a;3,0,37,a;3,3,07,b;1,3,457,a;4,4,6,b;2,3,134;1,5,,b;5,3,23,a',[5]],
[1,7,'5,1,6,b;6,2,12;2,0,37;4,4,157;0,0,1;4,1,045;1,2,,a;5,0,3,a;6,3,17,b;5,4,6,a;7,1,0;3,1,;1,1,124,a;6,1,0;2,1,346,b;3,2,034,a;3,5,6,a;0,2,6',[3]],
[1,7,'5,1,24,b;4,5,156,a;0,4,;4,3,7,a;4,2,,a;3,2,457,b;5,2,3,b;2,3,346;2,2,014;4,4,15,a;3,4,4;1,2,7;3,3,145;1,0,,a;2,5,056;5,3,2,a;0,5,4;4,1,4,a',[14]],
[1,7,'3,2,34,b;1,2,134,a;5,1,;5,5,;3,1,034,a;4,4,246,b;6,3,5;7,2,,a;6,4,267;2,2,35,b;5,3,;3,4,67,a;1,1,6,a;6,5,07,a;4,2,57;4,5,7,a;2,4,026',[16]],
[1,7,'1,3,,a;4,2,4,b;3,4,0,a;6,3,;7,2,6;3,2,045,a;4,1,,a;6,2,246;2,2,236,b;3,3,16,a;6,0,;2,4,03,b;3,5,567;2,3,,a;6,5,067;6,4,6;0,4,27,a',[14]],
[1,7,'5,0,12,a;6,3,06,b;5,4,17,a;3,2,36;1,4,,a;0,1,5;6,1,367;1,5,,a;7,2,01;3,0,;6,0,0,a;2,1,02;4,1,24;3,3,4,b;2,3,014,b;5,1,012,a;2,4,13,a',[6]],
[1,7,'0,2,5,a;7,4,,a;7,1,,b;6,1,5,a;7,2,0;4,3,5,b;6,2,5,a;7,3,;2,0,123;5,4,345;3,4,347,a;5,2,56,a;4,5,5;5,3,047,b;2,2,3,a;1,2,0;3,5,456',[16]],
[1,7,'1,4,036;2,1,23,b;0,5,4,a;1,5,1,b;6,4,01,a;3,2,03;2,3,05;5,4,36;2,4,46;6,5,056,a;0,3,256,a;2,5,06,a;3,3,3;7,4,;1,2,,b;3,5,,a;1,1,236,a',[0]],
[1,7,'5,0,03,a;3,4,6;4,1,1;7,3,356;3,3,3,b;4,0,5,a;4,2,167;2,1,346,b;0,0,;4,3,47,a;4,4,0,a;2,4,,a;2,0,34,b;3,2,146,a;3,0,4;5,2,067;2,3,23;2,2,067,a',[15]],
[1,7,'6,2,37;2,1,,a;0,5,6;2,4,46,a;7,3,,a;3,1,023;3,4,4,b;4,4,13,a;4,2,134,a;0,1,15,a;5,1,;2,0,13;0,2,34,b;5,4,0,a;3,2,123;7,5,06,b;3,5,',[11]],
[1,7,'0,0,;4,2,247;2,0,024,a;4,0,,a;1,0,;5,0,0,b;6,0,5,a;7,3,36,b;5,2,36,a;7,0,1;6,2,357,a;2,1,4;7,1,067,a;4,3,57;1,5,25;2,2,347,b;6,1,27,a;4,4,6',[14]],
[1,7,'5,4,7,a;3,2,7,a;2,0,135;0,2,4,b;0,1,23,b;7,5,,a;2,3,5;6,1,046;2,1,3,a;6,5,4;5,3,0;4,1,05,a;1,1,0,a;6,4,026;4,3,0;4,2,07,b;5,0,06,a;5,1,012',[13]],
[1,7,'7,1,01;6,3,3,b;5,1,014,a;7,4,1,b;3,0,236,a;6,0,023;7,5,6,a;5,3,3,a;4,4,7,a;7,3,;1,1,0,a;4,2,234;4,0,023,b;5,2,1,a;3,1,6;5,0,0;6,1,2',[5]],
[1,7,'5,1,4,b;4,2,026,a;2,2,;7,0,;5,4,67;6,4,027;1,0,46,a;4,4,5,a;4,1,13,b;6,2,237,a;4,3,245,a;5,3,,a;7,1,;6,5,14;5,2,45,a;3,5,56;3,2,467,b',[15]],
[1,7,'2,0,23,a;6,0,7,b;5,0,024,a;6,4,126,a;5,1,0,a;4,5,,a;5,3,357,a;7,4,3;5,5,4,b;4,3,26;6,1,267;5,4,12,b;6,5,,a;6,2,04;6,3,013;3,1,3;4,2,',[10]],
[1,7,'7,2,7,a;5,0,0,a;3,0,7,a;4,5,045;7,3,,b;5,5,56;1,2,24,a;1,5,156,b;4,0,014,a;6,3,,a;4,4,;4,1,0,b;3,2,0,a;3,3,3;5,2,037;1,1,;0,2,2',[3]],
[1,7,'0,0,135,a;0,1,5,b;1,4,07;1,0,,a;2,5,25,a;6,5,3;2,3,157;0,3,,b;3,2,02,b;1,1,037,a;5,1,;1,3,36;0,4,16,a;1,2,34;3,3,025,a;1,5,46;3,5,04,a',[15]],
[2,8,'3,5,04;4,0,3;1,2,1,a;7,5,6;1,3,356,b;3,3,025;3,4,,a;1,1,1;0,2,46,a;4,4,;2,5,3,b;4,2,036;2,2,67;6,5,4;6,4,2;7,3,',[5,9]],
[2,8,'7,5,2;2,1,;7,3,6;4,3,0,a;6,5,057;1,2,5;7,2,1;5,1,3;4,4,06,b;5,5,7;6,2,17;6,3,067,b;3,5,;5,4,56;7,4,6,a;3,4,2;5,3,3,a;4,1,67',[4,5]],
[2,8,'2,4,0,b;4,2,05,b;3,2,02;5,4,146;4,5,57;2,3,126;1,1,12;5,3,0,a;3,4,1;1,3,3;3,3,4;2,2,7;0,3,,a;1,4,17;6,4,6;0,5,;3,5,2,a;4,4,016',[3,17]],
[2,8,'7,5,6;7,3,6;1,5,4;5,2,27;7,1,07;4,4,,a;4,2,35;3,0,24,b;7,2,;5,5,7;5,1,035;2,1,,a;4,5,457;5,4,23;6,0,23,b;3,4,6,a;7,4,07',[2,6]],
[2,8,'1,3,01;4,2,;2,0,7;5,2,6,a;0,0,46;0,4,4,a;0,3,6,b;7,3,067;3,3,,b;1,1,;6,2,0;4,3,06;2,1,036;5,0,,a;7,1,;5,5,567',[12,15]],
[2,8,'7,3,;2,0,03;5,2,5;7,0,124;5,4,6;5,5,;1,1,35,a;5,1,14;6,2,12;3,0,3;4,4,47,b;1,5,2;2,2,17,b;3,2,,a;7,1,3;6,4,015;3,3,136,a',[9,8]],
[2,8,'2,4,3,a;3,4,23;6,4,,b;5,4,5,a;6,2,257;4,5,4;1,4,4;5,0,3;4,0,124;2,5,67;1,3,,b;3,5,5;7,4,14;2,3,3;7,1,027,a;3,2,345',[15,9]],
[2,8,'6,2,17;7,2,0,b;2,5,7;4,4,;0,1,,a;5,2,12;2,4,5;4,3,25,a;5,0,03;2,1,056;4,0,2,a;2,0,03;5,4,0;4,2,345,b;1,1,04;6,0,;5,3,0',[14,8]],
[2,8,'0,4,5;0,2,3,a;2,0,134;2,3,5;6,3,014;2,4,;4,5,;5,4,23,a;1,2,234,b;3,0,13;1,5,07;5,2,;4,4,45;4,3,57,a;5,1,;3,1,24;3,2,0,b;2,1,4',[2,12]],
[2,8,'4,3,46,a;5,2,0;4,2,47;0,2,3;1,4,456;1,5,124;3,5,;3,3,35;3,4,67,b;0,1,126;0,4,0;7,3,4;5,5,;1,3,13,a;3,2,3;0,0,,b;2,5,26,a;6,0,2',[4,5]],
[2,8,'1,4,56,b;3,3,56;2,5,37;7,2,;4,3,236;3,2,;4,2,;7,4,,a;1,1,;3,4,156,a;4,4,04;6,4,46;5,2,4;3,0,;5,4,7,a;6,1,01,b;2,3,2;4,5,57',[17,11]],
[2,8,'1,1,1,b;4,2,023,a;5,0,;1,3,045;7,3,,a;1,2,36;4,0,;4,3,0;5,3,07,b;0,3,3,a;6,0,67;5,5,;0,2,056;6,4,157;3,4,;5,1,125;5,4,',[2,15]],
[2,8,'1,0,3;4,3,013;2,3,,b;2,4,6;1,2,45,a;5,2,6;4,2,345,a;2,0,1,a;7,2,14;3,2,01;6,5,,b;2,5,;5,3,125;3,4,017;3,1,237;3,3,135;7,1,2;5,5,7',[14,0]],
[2,8,'3,4,06,b;4,2,24;4,3,7,b;4,4,1,a;2,2,124;0,2,;1,3,367,a;6,3,01;3,3,;7,2,;2,4,4,a;4,5,;2,3,357;0,1,1;0,4,246;3,2,4',[4,7]],
[2,8,'4,1,03;2,4,017,a;6,4,7;2,2,,b;5,2,7;3,4,04;5,4,6;1,5,4;1,4,;6,3,037;3,1,03,b;3,3,157;7,4,46,a;5,3,,a;2,1,4;5,1,145',[5,9]],
[2,8,'4,5,0,b;7,4,0,a;5,2,012;1,0,247;1,2,;0,4,2;4,0,2;2,3,;3,4,035,a;6,5,,a;0,5,24;5,4,34,a;1,3,0;3,2,15;2,5,57,b;2,0,5;1,4,4;4,3,056',[2,3]],
[2,8,'6,5,;2,2,;6,1,026;5,2,123,a;7,1,,a;2,4,;3,2,034;4,5,7;6,3,7,b;1,1,3;4,4,145;3,5,7;2,1,134;1,2,567,b;6,4,,a;4,1,027,a;5,3,',[2,7]],
[2,8,'6,4,6,a;4,1,145;2,5,6;3,3,02;1,3,5,b;1,4,014;4,4,4;5,1,14,b;7,1,,a;0,2,;0,4,1,a;5,4,4;3,4,;4,3,023;0,5,7;5,0,;2,2,026;6,1,4,a',[13,1]],
[2,8,'6,4,06;3,5,456,a;1,1,027;3,1,4,a;4,2,07;4,4,136,b;5,5,;4,0,3;7,3,056;7,1,67,a;2,2,,a;6,0,;1,3,01;6,2,15;4,3,4;1,0,24;3,3,,b',[0,15]],
[2,8,'3,5,3;1,0,;2,4,34,b;4,2,03;7,4,7,a;2,2,17,a;7,5,67,b;1,5,56;5,2,7;3,4,4,a;6,4,0;3,2,67;2,1,67,a;0,4,57;0,0,;5,5,247;3,1,035;1,4,1',[2,15]],
[2,8,'5,5,16;4,2,125;5,1,5;3,3,23;4,4,02,b;6,3,57;6,2,4;2,5,7;5,4,26,a;5,2,4,a;7,3,;1,4,,a;6,4,056;7,2,6,b;5,3,0,a;4,5,0',[1,12]],
[2,8,'4,2,237;5,4,456,a;7,4,;7,2,7,a;3,3,,b;6,4,,a;2,0,57;1,4,45;5,2,;3,4,;4,3,134;2,3,0,a;4,4,46,b;6,1,37;1,3,5;5,1,2;3,2,246;6,3,56',[16,7]],
[2,8,'3,0,4;1,3,3,b;6,2,;0,2,3;1,1,127;5,4,346;6,3,2,a;7,1,7;6,4,15;6,5,03,a;5,0,3,a;1,2,4;5,3,056;7,4,34;5,5,,a;5,2,367,b;5,1,4;2,3,',[5,4]],
[2,8,'5,2,037;6,3,3;2,5,6;7,4,;1,0,;0,5,0;4,4,;1,1,457,b;3,1,67,a;4,0,34,a;4,3,247;0,0,4,a;2,2,5,b;4,1,2;2,0,6,a;1,4,136',[0,15]],
[2,8,'3,0,,b;6,4,46;3,2,015,a;6,2,,a;7,3,57;6,3,147;3,1,23,b;4,1,;3,4,0;5,4,4,a;7,4,;5,1,07;4,0,0;6,5,7;1,2,237;0,5,;5,3,245;1,4,1,a',[11,13]],
[2,8,'0,2,36,a;0,5,6;3,2,6,b;1,5,456;4,1,16,a;3,5,57;6,2,;3,4,27;1,3,5;1,2,,b;4,0,,a;1,4,15;4,2,06;3,1,;2,2,345;4,5,;4,4,356,a',[7,3]],
[2,8,'2,2,7;4,2,2,b;7,5,0;5,0,;4,5,036,a;1,1,25;5,2,0;5,3,134,a;4,1,1,a;4,0,16;7,0,1;2,3,,b;2,1,034;5,1,26,a;5,4,;6,0,014;2,0,5',[12,15]],
[2,8,'2,4,147;6,2,257,a;5,1,;0,4,0;6,3,47,a;4,3,045;2,5,056;2,3,,b;0,2,4;7,1,03,a;3,2,0;4,1,,a;1,5,27;1,0,3;7,0,5,b;4,5,6;4,4,25',[6,13]],
[2,8,'1,5,1;5,5,07;6,5,067;4,2,014;5,4,01,b;1,2,3,b;4,0,012;4,5,,a;3,4,05;6,4,7;7,2,4;5,3,012,a;2,3,;4,3,,a;6,1,1;2,0,5,a;3,5,',[6,4]],
[2,8,'5,0,013;1,5,45;1,4,;3,2,,b;2,5,357,a;5,4,5,a;4,2,0;3,4,25,a;6,3,;2,1,6;1,0,;4,3,236;5,1,;2,0,03,a;4,4,123,b;2,4,256',[0,1]],
[2,8,'6,4,67;3,0,,b;1,3,145;3,5,,a;2,1,027;2,4,124;3,3,,a;4,4,1;1,5,1,b;6,0,0;3,1,02,a;5,1,016;5,3,47;0,1,3;1,2,3;0,4,6,a;1,1,4;6,2,167,b',[2,0]],
[2,8,'2,2,47;1,4,3,a;4,3,3;6,5,2;6,4,05;2,4,13;3,2,5;7,3,5;3,4,57,b;6,1,;4,2,256,a;1,3,245;7,2,7,b;5,1,,a;4,1,1,b;2,3,25;2,5,5;4,5,156,a',[4,11]],
[2,8,'4,4,6,a;7,2,01;2,3,134,a;6,2,;6,4,2;4,2,16,b;5,0,2;2,5,046;6,3,5;4,3,7,a;2,4,6;5,3,047,a;2,1,6;4,5,,b;6,5,6;5,5,15,b;1,4,4;1,5,5',[6,7]],
[2,8,'4,4,02;1,5,,a;7,5,6;4,3,267;5,5,456,a;5,3,;1,4,046;4,2,6,b;5,0,24;0,4,3;3,4,,a;3,5,4;6,4,57;1,3,024;0,3,7;1,2,35,b;3,2,05;5,2,01,b;7,3,,a',[6,11]],
[2,8,'4,1,236,b;7,0,2;1,2,3;3,4,27,b;1,3,346;2,4,4,a;7,4,17;4,3,4;6,2,14;4,4,0,a;3,5,3;5,2,4;6,1,05;6,5,;6,4,4,b;4,2,,a;6,3,1;2,3,,a;5,4,046',[4,12]],
[2,8,'1,5,03;3,3,16,a;6,2,017;3,0,,b;7,4,3;5,3,;4,4,,b;4,0,;6,5,2,a;0,5,4,a;5,5,46,a;5,0,1;3,1,26;6,1,7;1,3,24;5,2,256,b;6,4,467',[14,16]],
[2,8,'6,3,027;2,3,267;6,0,023;3,3,06;5,4,;6,4,;2,2,45;7,1,,a;4,4,567;0,5,6,b;4,1,4;4,0,,b;0,3,246;0,0,0,a;3,0,5;6,2,,b;1,2,23,a;3,2,0;4,3,03,a',[2,8]],
[2,8,'4,5,;1,1,23;1,3,,a;6,1,7;6,5,0;3,2,13;1,5,36;4,0,3,b;2,3,5;3,5,46,b;5,4,,a;5,0,0,a;3,0,1;3,3,14,b;2,2,234;4,4,014;4,3,6,a',[1,3]],
[2,8,'5,1,,a;3,2,2;4,1,267;5,4,256;7,3,2,b;7,2,,a;4,0,12;5,3,56,a;3,0,7;4,2,,b;7,0,05;3,5,;6,2,03;6,0,014;6,1,156;7,4,,b;5,2,047;4,3,67,a',[3,14]],
[2,8,'1,2,;1,3,;3,3,0,b;2,2,45,a;6,3,,a;4,0,27;3,2,16;5,2,1,a;5,5,67;1,5,56;3,4,47;3,0,13;4,1,56,b;4,2,2;2,3,047,a;4,4,6;4,3,4,b',[8,9]],
[2,8,'3,2,124;0,3,6;6,1,;4,1,47;3,4,027,b;3,5,;6,5,07;5,5,7;0,4,6;2,3,,b;2,2,57,a;1,2,6,a;3,3,,a;5,0,34;7,0,;5,2,5,b;1,1,346,a',[6,13]],
[2,8,'2,0,025,a;5,1,126;3,1,7;1,2,47;1,3,3;6,4,;3,3,04;5,0,03;5,3,03;0,3,345;3,2,,a;0,0,167,b;4,3,5,b;2,3,1,b;6,1,4;1,4,,a;0,1,,a',[1,2]],
[2,8,'5,2,147,b;1,3,57;4,0,,a;0,5,67;1,0,124;0,3,7;6,4,;4,2,23,a;3,5,07;2,4,6;2,3,7;0,0,;3,0,34,b;2,2,024,a;1,2,5,b;4,5,;0,1,2,a;1,1,7',[4,8]],
[2,8,'1,2,6,b;5,0,1;1,1,,a;3,5,25;6,4,;4,3,24,a;2,3,15,a;1,4,26,b;2,0,234;4,0,246,a;4,1,6;3,3,02;7,0,167;3,2,6;4,2,013;6,3,;4,4,,b;5,1,06',[17,8]],
[2,8,'3,2,16,a;2,1,;2,3,4;6,0,123;4,2,167,b;7,1,;1,0,57;1,3,156;6,3,2,a;2,5,014;0,5,45;0,4,0,b;6,5,5;3,3,,b;4,1,0,a;3,1,7;2,0,;2,2,456,a',[3,7]],
[2,8,'7,5,4;4,5,046;6,4,;3,2,4,b;6,2,07,a;0,5,,a;1,4,7,b;4,4,05;4,2,7;1,3,036,a;1,2,012,b;1,5,236,a;3,5,6,a;3,1,0;3,3,36;2,1,35;0,3,2',[1,2]],
[2,8,'5,0,0,b;4,2,0,a;3,0,37;4,5,07,a;6,1,15;7,5,;4,0,2,a;6,0,012;5,5,047;2,2,14,a;4,1,;3,3,045;0,1,2,b;5,1,02,a;5,3,4;2,3,0;0,3,;3,1,06,b;4,3,3',[8,7]],
[2,8,'4,1,;0,0,,b;5,1,367;4,4,267,b;4,0,13;5,4,36,a;5,5,27,a;2,4,14;0,5,,a;1,1,7;6,3,3,b;6,2,012;1,4,15;2,5,6;2,2,6,a;6,5,016;1,5,4;3,2,2,a',[7,12]],
[2,8,'3,4,047;3,5,47,a;5,4,4,b;0,2,3,b;0,3,,a;1,0,2;6,4,,a;3,2,134;1,3,03;5,2,25;7,0,67;1,1,,a;4,3,5;1,4,2;4,4,;2,3,167,a;0,1,45;2,0,15;5,5,,b',[0,7]],
[2,8,'2,5,0;3,2,125,a;2,3,17,a;4,4,7,a;5,4,;7,2,;4,1,,b;5,1,45,a;6,3,05;5,3,137;2,2,026;4,0,27;3,1,345;4,2,07;0,2,;0,5,;7,5,,a;3,5,4,b;2,4,02,b',[4,8]],
[2,8,'4,3,7,b;3,0,0;0,1,347,b;7,4,7,b;1,1,,a;4,1,035;2,0,;5,0,7,a;2,3,014;2,2,367;3,1,046;3,2,3;1,3,7,a;4,4,,a;0,0,24;2,1,;1,0,23,a',[9,10]],
[2,8,'5,1,,b;5,5,467;2,5,027;4,5,067;3,3,05;5,3,,a;2,3,,b;0,4,235;2,2,15;6,5,,a;5,2,27,a;1,4,4;0,5,04;4,2,4,a;1,5,;3,1,24,a;3,4,;1,2,,b;4,3,1',[3,1]],
[2,8,'3,3,4,a;6,5,067;1,3,567;3,1,3,a;0,3,6;5,3,;3,0,47;4,1,015,b;5,5,;0,2,,a;3,2,156,b;4,0,2,b;5,0,,a;1,1,145;6,4,;2,2,035;1,2,16;0,5,06,a',[1,2]],
[2,8,'6,4,02;5,4,04;0,3,14,a;2,2,,a;6,2,6;3,1,123;4,2,0,a;1,3,4,a;3,2,4,a;0,4,6,b;0,2,2;7,4,57;4,3,5;5,2,046,b;5,0,35,b;4,4,;6,5,57',[5,1]],
[2,8,'2,2,1,a;5,3,016,a;5,1,;3,3,2;4,3,1,b;1,3,5;0,3,1,a;3,4,;4,0,,b;2,1,13;0,1,047,b;4,4,,a;4,2,16;1,4,456;2,3,046;2,0,123;2,4,24,a;1,1,;1,2,17',[13,15]],
[2,8,'4,0,467,a;5,2,;5,3,467,a;4,1,;6,2,7;6,4,456;5,0,,b;4,3,27,b;2,5,6;6,5,7,a;6,3,36;2,1,4;5,5,46;4,5,0;3,1,2,b;7,4,1;7,3,5,a;3,4,25,a',[5,12]],
[2,8,'1,3,14,b;3,2,25;4,0,0;6,1,06;3,1,135,b;6,4,5,a;7,3,;2,4,7,a;5,2,;0,5,;5,5,;4,4,046,a;5,3,7;4,2,;6,2,016;4,3,037,b;3,0,13,a;1,4,145;3,4,3,a',[10,14]],
[2,8,'0,4,0,b;2,5,3;5,0,012,a;4,3,45;0,5,;3,5,5;4,4,56,b;5,3,,a;2,4,035;6,1,05;4,1,,a;4,2,,a;3,2,;7,1,15;2,3,135;4,0,5,b;7,3,7;3,4,024;3,3,45,a',[1,14]],
[2,8,'7,0,,a;1,0,3;6,3,7,b;0,2,4;2,5,5,a;1,3,;4,3,4;4,5,06,a;4,4,5;1,1,146;5,5,057;2,3,247;2,2,1,b;7,3,6,a;6,2,37;2,1,23;4,0,15,b;1,2,;4,1,237,a',[7,10]],
[2,8,'6,4,0;5,4,025,b;1,2,145,b;5,5,6;4,2,356,a;2,3,2,a;1,5,467;5,2,06,a;0,5,;5,0,4;0,3,24,b;3,4,;6,0,07,a;2,4,5;2,5,5;6,3,47,a;2,1,27;3,1,04',[6,17]],
[1,9,'0,5,27,a;5,1,03,a;4,1,12;2,3,67,a;6,2,245;0,1,2,b;2,4,456;5,4,4;3,1,02,a;1,1,1;3,2,,b;5,3,;2,0,05;5,2,057,b;3,3,,a;7,3,017;7,2,;7,4,7;0,2,012,a',[6]],
[1,9,'3,4,567;2,1,34,b;6,2,3,a;5,1,14;3,0,04;7,0,02;2,3,017,b;5,5,12;5,0,,a;1,2,5,a;3,2,047,a;3,3,,a;0,3,46;7,4,;2,0,6,a;7,3,2,b;4,5,467;7,1,;4,3,357',[16]],
[1,9,'1,3,3,a;2,1,4;5,1,16;5,0,5,a;2,3,5;0,1,;5,2,7,b;1,1,5;0,2,456;1,2,2,b;2,4,016,a;4,3,07,a;2,0,01,a;1,4,;4,0,012;2,2,02;1,0,37,b;3,0,013,a',[14]],
[1,9,'6,0,;5,4,25;6,3,24;7,4,27,a;5,2,5,a;0,1,,b;5,5,7,a;3,1,0;6,5,057,a;3,4,156;4,3,1,b;6,2,02;2,2,,a;7,5,3,a;6,4,24,b;3,3,567;3,5,456;4,5,2',[16]],
[1,9,'0,0,4;1,1,347;5,1,4;4,3,137;4,1,034,a;6,5,,a;6,3,017;4,5,6,a;2,0,4;4,4,046,b;7,4,46,b;4,0,,b;7,1,125,a;3,4,;4,2,4,a;2,1,,a;7,3,',[1]],
[1,9,'4,1,12,a;3,4,35;5,1,01,a;5,4,3,b;6,1,23;3,5,457;0,2,,a;5,3,267;7,1,7;7,5,4;5,2,7,a;6,4,6,b;4,2,056,b;7,2,2;4,3,,a;6,0,123;2,4,07,a;4,5,67',[5]],
[1,9,'2,2,25;4,0,1,a;6,3,127;1,3,3,a;6,4,,a;1,5,0,a;5,4,12;0,4,1;3,3,126;3,0,,a;4,5,67;4,2,135,b;3,2,06;5,3,7;2,3,035,a;4,3,0,b;6,2,127;3,4,0,b',[16]],
[1,9,'7,4,057;5,4,0,a;6,1,236,b;6,5,067;6,4,467;0,4,,a;5,2,34;5,0,;3,5,,a;2,0,,a;2,3,5;3,1,47,b;6,2,35;4,3,4;5,3,07,a;6,3,;3,4,025;4,5,26,b;7,1,34,a',[3]],
[1,9,'3,1,245,a;2,0,234;2,5,5,a;1,2,123,a;0,3,,a;3,0,;3,3,;5,5,05;7,4,5;5,2,135,a;2,4,5;4,1,23;2,2,137,b;1,3,036,b;0,1,;1,1,04,a;4,0,03;6,2,0,b;4,2,',[1]],
[1,9,'3,4,345,a;6,5,04;5,3,01,a;3,2,026,a;2,5,;3,5,056;1,5,026,b;4,5,6;0,1,3;1,2,027;7,4,0,a;3,1,4,a;5,2,4,b;2,3,2;0,2,;4,3,,b;5,4,14,a',[1]],
[1,9,'2,5,456;3,2,124,b;4,3,036,a;0,3,,a;5,0,;4,0,24;2,2,,a;4,2,;5,4,034,a;0,4,0;6,4,,b;2,4,0;3,5,456;1,3,46;1,2,014,b;7,4,5,a;0,2,0,a;4,4,;6,5,6',[0]],
[1,9,'2,3,235,b;7,4,,b;3,2,26;6,5,15;3,4,;1,1,02,a;5,4,36,a;4,4,047;3,3,0;1,2,4;0,2,345,b;7,0,7,a;0,1,;5,0,14;2,4,167;2,0,34,a;2,1,36,a;2,2,,a;3,1,01',[7]],
[1,9,'2,2,167,b;5,3,3;2,5,3;1,0,45,a;4,3,247;1,5,456;1,3,3,a;3,2,0,a;4,2,024,b;4,5,06;5,2,37,a;3,0,0,a;7,4,;3,5,0;7,5,,b;2,1,7,a;4,1,0',[5]],
[1,9,'3,2,34,a;7,3,06,a;2,3,04,b;5,5,056,b;2,2,234;5,1,4;2,5,5;4,3,1,b;7,0,;6,3,12;3,4,6;3,3,5,a;6,4,34,a;5,2,146;4,5,5,a;6,2,1;4,4,56,a',[4]],
[1,9,'4,2,5;7,2,,b;7,0,5,a;2,1,1,b;6,0,126,b;3,2,13;6,4,7;3,1,257,a;2,0,2,a;7,4,0;6,2,,a;6,3,035;4,1,034;5,1,0,a;7,3,;4,3,345;7,1,27;6,1,057;5,3,,a',[12]],
[1,9,'6,1,46,a;5,4,567;7,3,37,b;7,0,06;4,2,012,b;3,5,,a;5,5,0;5,3,367;4,3,2,a;2,4,37;4,4,;7,2,267,a;3,2,;6,4,1,a;6,2,3;5,2,345;2,2,,a;4,0,1,b;5,0,7',[1]],
[1,9,'3,5,,a;3,1,37,a;4,0,123;7,1,07,b;4,1,12,a;4,2,1;3,2,123,a;5,3,157,b;6,5,5;0,5,56;5,2,23;6,1,;5,0,,a;0,4,5;3,3,46;5,1,46,b;3,0,4;2,5,;4,3,135,a',[16]],
[1,9,'7,4,06;5,1,45;3,0,03;4,1,5,b;2,0,0;6,3,,b;5,0,;5,4,,a;6,2,3;4,0,034;6,5,456;7,5,17;5,2,;7,2,236,b;7,1,01,a;7,0,012,a;7,3,7,a;5,3,57,a;1,0,5,a',[10]],
[1,9,'2,2,0,a;0,4,2;0,5,6;3,1,34;2,4,3,a;3,2,01;6,1,012;1,3,245,b;4,1,13;3,4,024,b;4,5,47,a;5,3,0;6,3,01;7,4,0,a;4,4,,a;4,3,0,b;3,5,4,a',[6]],
[1,9,'3,0,0;7,2,6;4,0,2,a;4,3,2,a;2,1,123,a;2,4,,b;2,2,37,a;7,1,,a;2,3,1,b;3,1,046;7,4,02;5,4,56;1,3,25;1,2,24,b;1,1,47,a;4,1,136;5,3,;1,4,45;5,5,3',[9]],
[1,9,'6,2,24,b;5,3,,a;5,4,05,a;4,1,03,a;4,5,025;2,2,26,a;0,1,0;0,5,6;4,3,16,a;6,3,07,a;2,5,05;5,5,047;5,1,3,b;3,4,67;0,0,,a;1,1,07;3,5,06;5,2,26;3,2,34,b',[11]],
[1,9,'4,2,,a;2,0,3;2,4,012;5,4,15,a;3,2,236,b;2,5,057,a;2,2,6,b;3,5,,b;0,4,5;3,0,57;4,3,4,a;6,3,1,a;0,5,05;4,1,2;1,5,1;4,5,12,a;5,2,67;5,0,1,a;3,4,24',[2]],
[1,9,'6,4,,a;6,3,25,a;4,4,035;3,4,025,a;2,3,4,a;6,2,1;6,1,1;7,0,,a;5,5,;2,0,4,a;6,0,0;7,2,5;3,0,04,a;2,4,1,b;5,3,057,b;7,1,167;3,3,246;3,5,,b;4,1,123',[18]],
[1,9,'6,3,2,a;1,2,03,b;3,5,0,a;3,4,027,b;5,1,346;1,5,6,a;7,2,;6,1,,a;0,1,234;2,3,0;6,2,24,a;6,5,67;2,1,6,b;0,2,3;5,0,01;5,2,146;4,1,0,a;2,5,045,a;3,2,',[15]],
[1,9,'0,1,26,b;5,1,;0,0,,a;4,3,046,b;2,5,16,a;3,3,147,a;0,5,5,a;4,1,1,a;4,2,34;1,4,123;4,5,056;5,4,,a;2,2,;7,2,;7,5,4;7,3,37;1,1,4,a;2,1,02,b;2,3,157',[10]],
[1,9,'5,3,267,a;3,1,0;1,4,4;5,0,123;4,3,1;5,5,456,a;4,1,035,a;1,2,,a;1,1,5;3,2,0,a;1,0,2;6,5,,b;4,4,567;5,2,,b;3,4,7,b;3,3,46,a;7,4,,a;2,1,567',[2]],
[1,9,'4,2,024,a;1,1,146,a;2,2,467,b;2,1,37;2,0,023,a;6,5,,a;3,2,;0,0,1;7,4,,a;3,1,0,a;0,2,26,a;7,3,2;3,4,7;5,2,12;4,3,3;1,0,4;7,5,17,b;5,3,37,b;5,5,457',[18]],
[1,9,'4,2,06,a;0,4,,a;5,5,06;3,5,057;3,4,,a;2,4,045,b;1,4,7,b;3,0,;5,3,,a;2,2,;5,4,057;0,3,26,a;3,2,0,a;0,5,7,a;5,2,7,b;6,3,267;0,0,;3,3,256',[2]],
[1,9,'1,3,0;1,2,15,a;3,1,0;3,2,02,a;2,2,25,a;7,2,1,b;2,5,7,a;4,1,023;3,4,157,b;0,1,23;5,2,6;4,4,257;6,3,,a;1,4,6,a;4,3,1,b;0,3,1;6,2,047;4,5,5;5,4,06,a',[7]],
[1,9,'1,2,147;4,0,1,b;0,3,234;0,0,4;3,5,,a;2,2,23;4,2,034,b;6,2,;1,4,;5,3,13,a;0,4,,a;2,0,04,a;0,1,157,a;2,4,,b;3,3,47,a;3,2,,a;1,1,025;7,5,57',[16]],
[1,9,'6,4,,a;1,4,4;4,3,5;2,2,4;4,4,012,b;3,3,1;1,2,267,b;7,1,5,a;5,3,05,b;5,0,02;3,0,123;2,3,,a;1,5,;1,1,03,a;0,3,04,a;0,1,24,a;6,3,6;4,1,;3,1,234,a',[9]],
[1,9,'5,1,1,a;0,2,01,a;6,1,017;1,2,,a;5,2,04;2,4,13;1,1,12;6,2,0,b;4,1,1,b;4,4,567;0,5,57,a;1,0,34;2,1,6,b;3,2,1,a;4,3,057,a;2,3,13;5,0,13,a;7,1,07',[9]],
[1,9,'6,1,013,a;3,1,45;4,1,124;4,2,046,a;3,2,67,a;6,4,,b;3,3,2,b;5,1,,a;2,2,036,a;1,3,45;6,5,06;0,3,6;0,1,,a;4,0,;5,2,,b;4,3,356;5,5,5,a;2,1,17;1,0,4',[9]],
[1,9,'1,3,27;3,1,4;6,2,34,b;6,0,12,a;6,3,23,b;7,1,;7,4,267,a;7,2,1,a;1,5,4;6,4,27;4,3,045;5,1,36,a;3,5,7;7,5,3,a;5,2,25,a;5,3,5;7,0,02,a;6,1,45,b',[10]],
[1,9,'5,4,14;4,2,7;6,2,27;7,2,067;0,0,2;4,0,0,a;6,4,35,b;0,1,;6,3,17,b;6,1,0;4,4,457;1,1,1,a;0,2,1,a;5,2,0,a;7,3,67,b;4,5,,a;7,0,01,a;2,0,016,a',[10]],
[1,9,'5,2,;2,0,6,a;3,2,07,a;0,1,;2,5,,a;7,3,7,a;2,2,5,b;3,1,05,a;1,0,;4,4,025;5,3,047,b;4,3,56;2,3,46,b;3,4,156,a;6,2,;1,4,345;4,0,07;3,0,2;4,2,1,a',[15]],
[1,9,'0,4,;6,1,06;2,1,1;6,3,2,b;4,1,234;3,4,2,a;6,0,,a;1,0,06,a;0,0,23,a;6,4,06;3,5,1;0,1,,a;1,1,2,b;4,4,7;3,2,157;1,4,047;1,3,2,a;0,3,56,a;1,2,5,b',[14]],
[1,9,'0,1,,a;5,0,5,a;2,4,017,b;1,1,026,b;1,5,;4,1,123,b;1,3,2,a;2,0,2;2,1,456,a;5,3,03,a;1,0,7,a;4,4,07;3,3,47;1,2,,a;3,0,4;1,4,6;5,4,067;0,4,',[16]],
[1,9,'2,1,125;1,4,56,a;5,4,13;5,3,,a;7,5,,a;4,2,346,b;1,2,46,a;4,1,23;3,5,;2,3,34,b;3,3,37,a;4,5,457;5,2,13;7,2,,b;1,0,;2,4,034,a;3,4,;4,4,257,a',[0]],
[1,9,'2,1,07;2,4,34,a;3,2,034;0,2,3,b;3,1,;4,4,,a;6,2,34;4,3,5,a;1,3,6,b;3,3,6,a;5,3,7,b;3,5,067,a;1,1,45,a;2,3,14,a;1,5,3;2,0,13;4,5,057;0,5,2;5,4,067',[16]],
];
BD.DAILY = [
[1,1,'1,4,023;3,1,;2,0,12;2,4,045;2,3,25;0,3,,a;2,1,237;1,0,;4,3,047;3,4,6;7,3,0,b;0,4,;1,5,1;0,2,23',[2]],
[1,2,'2,3,7,a;0,4,5;0,0,5;2,5,;0,1,,a;4,4,25;1,1,234;4,3,035;1,4,034,b;4,1,27;6,5,,b;3,0,04;2,4,0,a;7,3,;7,1,027',[6]],
[1,4,'2,5,456;4,5,,b;4,3,024,a;3,1,03;0,0,;4,1,;3,2,467;2,1,135;0,3,0,a;5,3,6,a;2,3,05;3,0,03;1,3,34;5,2,3,a;3,5,;3,3,,b;5,5,7',[0]],
[1,1,'5,1,23;4,3,;4,2,046;4,4,0;6,4,;6,3,;2,5,7,a;3,4,05,b;7,3,12;5,3,47;0,3,1;5,4,067;3,1,;2,2,25;7,4,03',[0]],
[1,2,'4,0,013;2,4,46,b;2,2,237,a;3,0,0;3,3,04,b;5,5,07;5,4,;3,5,,a;3,1,;0,0,;2,3,4;1,1,04,a;7,3,05',[0]],
[1,4,'6,2,014;7,2,157;5,2,;6,1,014;5,4,0,b;4,3,0,a;3,4,,b;3,3,3,a;6,4,,a;4,1,17;2,3,0;7,1,;1,3,56;4,5,5;5,3,134,a',[0]],
[2,3,'2,1,45;6,1,1;6,2,07;2,0,3;3,1,146;3,5,6;3,2,3,a;6,5,3;3,3,,b;0,4,;5,3,015;3,0,37;2,2,1,a',[0,3]],
[1,2,'6,2,6;6,5,167;2,1,3;3,4,45;3,2,;7,0,;5,1,037,b;4,3,26;7,3,,a;6,3,046;4,4,,a;5,4,0;4,1,0;6,1,015;5,2,367,a;5,3,,b',[1]],
[1,4,'5,2,016;3,0,123;2,2,24,b;2,4,47;5,1,,a;3,4,035,a;4,3,034;1,1,;2,1,6;4,5,5;4,2,356,a;2,3,5,b;3,1,4;7,2,;4,1,3,a;1,4,6',[1]],
[1,1,'3,0,,a;3,5,4;0,0,14;6,3,6;6,0,026;6,2,02;4,0,;2,0,013,b;1,0,2;1,2,;0,2,;2,2,567;3,3,257',[12]],
[1,2,'0,5,4,a;7,3,;0,2,37;5,2,06,a;5,1,6;3,4,025,b;0,4,2;3,3,0;4,3,05;1,3,267,b;3,2,1;5,3,2;1,5,,a;3,5,;6,4,057',[14]],
[1,4,'4,4,17,a;0,2,;3,1,7,a;0,4,,a;3,3,6;5,0,027;1,1,14;3,5,;5,3,06,b;6,4,07;3,2,6;4,2,3,a;1,5,567;1,3,47,b',[12]],
[1,1,'4,3,03,a;7,4,;1,2,0;5,4,4;1,5,07;0,5,;5,0,47;5,2,025;4,5,4;7,0,1;1,3,;6,3,,b;3,3,01;6,5,567;3,2,035',[8]],
[2,3,'1,1,36;7,5,;7,2,124;4,5,;3,4,;5,3,5,a;2,3,2;4,0,;4,4,6,b;1,2,467;2,2,;4,2,046;3,0,5;4,3,014,a;0,1,',[9,12]],
[1,4,'0,5,;1,4,157;0,3,145,a;0,0,;0,2,16,b;7,4,;1,3,7;3,2,47;0,1,36,a;7,2,7;1,0,12,b;1,2,;4,0,4;5,2,347;6,3,37;3,0,4,a;1,1,7,a',[1]],
[1,1,'4,4,126;6,5,5;6,1,03,b;7,3,6;4,5,;4,3,035;3,5,456;7,2,,a;1,3,;5,1,23;2,5,;1,4,34',[11]],
[1,2,'6,4,4,a;5,3,13,b;6,3,7,a;2,0,3;4,1,7;1,2,023;0,2,35;2,4,,b;4,2,13;1,3,;1,4,5,a;3,5,6;3,0,347;4,5,045;7,5,7',[5]],
[1,4,'3,3,37,a;1,5,367;4,0,,b;2,4,;0,0,0,a;4,3,01;4,4,;2,5,;1,3,45;3,1,015;1,4,6;0,4,6,a;2,2,27,b;2,1,247,a;0,2,4',[1]],
[1,1,'4,2,347;2,4,15;3,1,67;7,1,7;6,3,;2,5,;2,0,3;6,4,5;1,5,6;1,4,5;5,2,13;4,1,4,a;3,0,3,b',[1]],
[1,2,'5,2,;6,4,07,b;0,2,27,b;6,1,123,a;4,0,014;3,0,15;5,1,02;5,3,;3,1,1;7,2,1;0,3,,a;2,2,0;4,1,4,a;4,3,;5,0,123',[4]],
[2,3,'2,2,17;4,3,;7,4,;6,3,03,a;0,3,0,a;3,5,5;4,4,567;1,1,;1,3,0;5,4,7;5,2,3;4,1,3,b;7,1,02',[5,9]],
[1,1,'3,0,0;6,2,16;4,0,03;4,1,036;7,2,,a;0,0,7;3,2,2;2,5,06;6,1,,b;2,1,;5,2,024;5,5,0',[3]],
[1,2,'2,1,,a;7,1,;3,5,46,a;6,5,24,b;4,4,16;5,3,3;1,3,45;4,2,67;7,5,1;2,2,;3,2,47,b;1,2,5;2,4,347;2,3,47,a;4,1,4',[12]],
[1,4,'3,5,6,a;3,3,,a;5,4,;4,0,;2,4,456,b;5,5,0;2,2,345;1,0,012;3,2,,a;2,3,167;1,3,,b;0,4,4;1,4,,a;0,1,23',[7]],
[1,1,'6,4,;2,4,37;6,5,0;2,5,4,b;0,0,02;4,2,37;2,0,0;4,5,06;3,2,134;0,5,,a;1,4,134;3,5,',[8]],
[1,2,'2,5,6;0,4,67;6,3,,a;1,3,5;6,1,2,a;0,1,4;2,2,04,b;6,4,356;3,1,14;1,2,0,a;3,4,014;4,2,03;5,1,,b',[10]],
[1,4,'4,0,;4,1,3,b;0,3,02;3,3,247;6,3,17,a;4,4,57,a;0,0,37;2,5,;0,2,2,b;3,5,057;4,3,4;1,1,0,a;7,1,02;6,0,01;0,5,6;0,1,,a',[13]],
[2,3,'2,3,014;4,3,16,a;4,5,034;2,4,04;5,2,3;3,3,46,a;0,3,15;5,5,7;3,0,;0,5,1;5,3,2;3,2,3;2,5,3;0,4,,b;3,4,0;4,2,34',[0,2]],
[1,2,'5,3,457,a;4,3,5;3,2,1,a;3,3,;6,2,3;6,4,47,b;7,4,4;3,0,236;3,1,36,b;4,2,012;6,3,6,a;4,4,45;2,3,',[11]],
[1,4,'2,4,,a;1,4,046;2,3,7;0,1,;1,1,0,a;1,0,26,b;0,4,17,b;1,2,123;3,4,7;3,3,;0,5,;0,3,2,a;1,5,04,a;3,0,012;1,3,235;2,5,57',[13]],
[1,1,'3,0,;3,3,14;7,2,4;3,4,,b;5,0,2;5,1,14;7,4,06;5,5,;6,2,;7,3,35,a;6,1,27;4,3,3;5,4,25;5,2,13;4,1,347',[14]],
[1,2,'3,5,07;5,4,4;2,0,04;2,5,15;3,1,0;3,3,47,b;4,0,2;1,5,45;2,4,47;0,1,4;4,1,,a;3,4,45,a;4,3,,b;0,2,56,a;2,2,015;1,3,3',[7]],
[1,4,'6,2,7;6,0,012;3,1,0,a;4,2,4;5,4,2,b;6,5,157,a;6,1,125;7,4,;5,0,,a;4,3,136;4,1,,a;4,0,01,b;2,5,;2,1,04;6,4,27;7,0,',[1]],
[1,1,'1,3,6;0,2,;2,3,12;1,4,;2,1,03;4,1,236;1,1,13,a;2,4,57;3,2,156;6,3,6;3,1,2;4,0,0;3,3,35,b;6,1,;4,2,5',[4]],
[2,3,'1,1,34;4,2,0;2,3,15;0,5,1;2,2,;1,4,06,a;5,0,01;4,1,23,b;4,0,013;0,4,2;1,0,1;3,5,04;4,5,;5,2,17,a;5,1,4;3,1,0',[2,11]],
[1,4,'5,4,02;3,2,135,a;2,0,02;4,2,02;0,5,;1,5,,b;5,2,036;2,2,2,a;5,0,,a;4,5,05;6,3,16;4,0,02;6,5,7;3,4,;2,3,2,a;4,3,35,b',[11]],
[1,1,'5,4,0;3,3,024;4,5,4;3,4,2;4,0,234;5,5,6;6,2,235;3,5,;7,1,7;6,4,5,b;6,5,06;7,3,3,a;6,0,1',[4]],
[1,2,'6,4,07,b;5,5,,b;6,2,367;1,3,;2,3,1,a;7,3,1;5,3,2,a;4,2,;3,3,015;5,1,046;3,2,234;4,1,;2,4,267;6,5,06;6,1,0,a;2,5,',[10]],
[1,4,'0,1,;7,4,1;4,4,024;4,3,356,a;2,0,023;3,4,4;1,2,1;7,5,,a;5,4,,a;4,2,0,b;5,0,03;4,5,;7,2,012;2,3,7,a;5,3,013;6,3,;5,2,127,b',[10]],
[1,1,'3,5,7;2,3,6;5,1,012;2,1,247;1,0,;0,5,6;1,5,05;3,1,17,b;4,2,7;4,1,;1,1,47;2,4,14;5,2,0;0,2,5,a',[0]],
[1,2,'6,1,235;3,1,4;5,1,015;7,0,0;4,1,7,b;1,5,,b;5,3,156;4,2,5;7,1,,a;3,2,2,a;2,2,04;0,2,4;6,0,234,a;3,0,1;6,3,;3,5,07',[6]],
[2,3,'4,3,34;1,4,05;0,4,;2,3,24;4,5,,a;7,4,;6,5,,b;5,1,7,a;7,3,2;6,4,3;3,1,13;7,5,06;4,0,123;4,2,5',[1,7]],
[1,1,'5,4,5;1,2,;7,1,6;1,3,47;4,3,03;2,3,4;3,3,06;3,1,127,b;2,0,4,a;1,1,234;3,2,27;6,0,34;3,0,47;6,3,;2,2,',[9]],
[1,2,'1,1,234;1,4,6;5,3,357,b;1,0,13;3,2,4;4,1,1;6,4,01;4,4,356,b;7,1,1,a;1,2,5;6,2,,a;4,3,7;4,2,4,a',[0]],
[1,4,'2,2,126,b;2,0,,a;2,5,467;3,5,;7,3,67;3,2,07;6,1,127;1,0,;3,4,;3,3,,a;0,4,16;2,3,,a;6,2,134,a;4,4,7,b;5,0,1;0,2,46',[6]],
[1,1,'2,1,037;2,0,25;1,0,4,b;5,4,57;2,3,5,a;2,2,236;1,1,0;4,4,6;4,1,7;6,1,7;5,0,13;7,2,',[5]],
[1,2,'4,3,2,a;0,2,26;3,1,3;2,4,;0,1,;5,1,1;6,4,47,b;5,3,4,b;2,2,245;7,4,4,a;1,3,457;3,3,5,a;4,4,57;3,2,07;5,2,0',[10]],
[1,4,'6,4,0,a;5,0,12;7,4,17;6,5,67;5,4,,a;3,5,,a;2,5,;6,2,56;6,1,02,a;7,2,2;7,1,2;4,5,,b;3,1,;4,3,126;3,4,124;5,2,1,b;3,2,23',[1]],
[2,3,'6,3,13,b;6,4,,a;4,1,01;1,0,2;5,1,235;5,4,;6,2,2;7,3,1;5,3,57;0,1,7;3,2,247;3,4,;1,3,5;3,1,03,a',[2,4]],
[1,2,'6,5,14,a;5,2,026,b;1,5,,a;7,3,;1,2,;3,2,46;4,2,;4,3,035;5,3,7;2,5,035;5,1,36;2,3,7,a;5,0,1,b;7,5,06;6,2,27;4,1,',[9]],
[1,4,'1,2,467,b;4,4,;1,1,0,a;0,1,;1,5,;2,2,23,a;1,0,4;4,2,,b;2,5,067;3,4,127;0,3,5;2,1,47;0,2,06,a;3,5,7;2,4,2;4,1,2,a',[9]],
[1,1,'1,2,;4,3,;3,4,15;5,1,;2,1,,b;6,2,145;5,0,1,a;5,3,267;7,2,1;2,3,3;4,2,056;2,5,0;5,5,5;4,1,057',[5]],
[1,2,'0,4,;3,0,,b;1,2,47,b;1,4,;2,2,046;0,2,125,a;2,0,04;1,5,067;3,2,;0,5,,a;2,4,14;1,0,;1,3,357;0,1,,a',[12]],
[1,4,'4,3,15,a;2,4,;0,1,;3,4,0;1,0,2;2,2,4;1,3,;0,3,04,b;2,3,0,a;1,2,14;0,2,;4,2,137,a;2,0,127;3,2,,b;7,5,;2,1,026,a;3,3,246',[4]],
[1,1,'6,0,1,a;7,0,0,b;5,2,046;6,4,012;7,3,126;3,1,4;3,4,7;5,3,56;1,2,237;1,4,;6,2,35;4,2,;4,1,0;5,1,0;5,5,',[7]],
[2,3,'5,4,017;7,4,;7,2,0;6,0,124;6,5,2;7,5,6;4,5,7;4,4,,a;7,0,;6,3,035;3,2,0;5,5,467;1,2,;5,3,36,b;5,2,0,a',[3,11]],
[1,4,'5,4,135;1,1,04;4,4,7;5,1,125,b;6,5,07;6,4,02;3,3,2;6,1,,a;6,3,2;5,5,6,a;2,4,,a;2,1,,a;3,1,034;6,0,;3,4,045,b;5,3,4',[12]],
[1,1,'4,4,,a;4,5,046;3,5,7;7,5,;2,3,034;1,2,0;4,3,145;6,3,1,b;2,5,;5,2,05;3,4,4;1,3,36;4,2,;2,4,2',[4]],
[1,2,'5,1,034;7,3,167;3,0,,a;5,3,;3,5,56;4,4,7;1,2,;2,5,;7,1,,b;3,4,467;4,0,,a;2,4,235;3,1,345,a;4,1,07;1,1,6;3,2,6,b',[11]],
[1,4,'3,0,;5,4,37;3,2,;2,4,46,a;0,1,3,a;3,4,156,b;5,3,01;3,5,7;2,1,25;1,2,,b;7,4,1,a;6,4,07;5,2,2;2,3,47,a;6,5,056',[1]],
[1,1,'2,3,1;2,4,,a;3,1,;7,0,3;5,5,6;0,5,2;1,4,56;5,3,067;2,5,046;4,3,5;1,3,2,b;5,0,16',[8]],
[1,2,'7,3,067;7,2,;6,2,,b;2,4,067;2,3,,a;6,3,,b;4,3,457;5,4,,a;1,0,16;7,1,;5,1,13;6,1,4;5,2,245,a',[6]],
[2,3,'2,4,;5,1,023;5,0,23;7,2,;6,1,3;3,3,,a;5,4,2;2,1,3;6,2,;3,4,056;6,3,1;4,3,0,a;5,2,345,b',[2,9]],
[1,1,'1,4,;4,0,7;6,4,0;6,1,25;5,3,;6,3,236;6,2,356,b;7,4,;4,1,36;7,1,,a;5,1,02;4,4,0;4,2,356',[12]],
[1,2,'4,0,2;2,4,56;4,2,56;4,5,6,a;4,3,27;7,4,0;1,3,6;1,5,456;4,4,2,a;3,5,3;1,0,;4,1,3;3,4,,a;2,1,34,b;2,5,456,b',[7]],
[1,4,'3,0,02,b;1,1,;1,5,05;5,5,,a;3,2,06;3,1,7,b;2,4,6;2,0,1,a;0,2,;0,4,26;0,5,456;4,2,17;2,1,5,a;3,4,06,a;2,5,045',[14]],
[1,1,'4,0,,a;0,0,2;3,4,034;2,2,6;3,2,23;1,3,35;0,2,3;4,3,6;4,5,24;3,5,;1,2,34,b;3,0,014;4,1,;7,5,0',[11]],
[1,2,'5,2,015;3,5,567;4,2,1;3,3,35,b;5,5,;2,3,5,a;4,0,6,a;2,2,04;0,2,7;6,5,07;2,4,6;2,5,,b;5,3,56;7,0,0;5,4,26;6,2,7,a',[9]],
[1,4,'3,2,,a;3,3,26;4,4,7;1,3,0;2,0,134;0,4,,a;2,2,147,b;0,1,2;4,0,23;4,2,136,b;6,2,16,a;0,3,24;2,4,6;0,2,236;3,0,,a;6,1,',[4]],
[2,3,'7,5,6;5,3,,b;3,4,45;4,1,7;7,2,016,a;7,1,1;4,3,17,a;6,2,;3,0,15;0,3,;6,5,4;2,3,045;3,2,4;4,2,346',[10,11]],
[1,2,'6,2,06,b;5,0,023;7,1,1;2,5,;2,2,056,b;4,3,35;1,2,56,a;2,0,7,a;1,4,135;6,1,;5,3,25;0,5,;4,2,27;3,1,2,a;3,2,045;5,2,',[8]],
[1,4,'3,1,2;0,2,1,a;1,0,4,a;0,0,2;2,0,124;3,4,16,a;0,1,5,a;4,4,05;3,0,;2,3,;1,1,037,b;0,3,;1,5,7;4,2,07;2,5,016;1,2,1,b',[13]],
[1,1,'3,3,;4,2,367;7,5,;1,1,5,b;2,1,06;2,2,357,a;0,0,47;4,0,;2,0,;4,1,07;3,2,047;3,0,',[10]],
[1,2,'3,3,34;3,1,024;5,1,;0,1,4,b;4,4,2,a;1,2,34,b;6,3,5;1,1,3,a;3,0,012;2,2,5,a;1,0,14;4,5,;3,4,',[8]],
[1,4,'5,1,2;7,3,126;3,3,15,a;6,3,26;1,5,6,b;7,4,;5,5,7,a;5,3,012,b;7,0,2;6,2,03;7,1,,a;2,4,6,a;6,5,4;1,3,24;7,5,3;5,2,256;4,5,05',[16]],
[1,1,'1,2,345;6,5,3;4,2,37;1,3,26;1,4,027;4,0,6,b;4,3,4;7,5,0;3,1,5,a;7,2,;7,3,6;0,4,05;2,1,13;2,3,',[3]],
[2,3,'3,0,2,b;7,1,;2,1,15;4,1,;2,2,6;6,1,056;1,1,2;1,2,6;7,0,,a;1,0,5,a;5,0,034;2,0,0;6,0,345',[4,10]],
[1,4,'0,3,;4,5,056;1,2,0,b;1,5,67,a;2,5,07;6,5,04;7,2,16;3,4,,b;4,4,07;4,2,13;6,3,56,a;5,4,6;7,5,6;4,3,6,a;3,3,34,a',[5]],
[1,1,'7,2,4;3,1,234;2,3,6,b;2,0,12;3,3,;5,0,036;5,2,07;6,2,07;5,1,3;3,2,5;0,2,1,a;0,4,0;4,2,12;4,3,0;2,2,01',[1]],
[1,2,'3,5,456,b;7,0,06;5,3,356;3,2,24,a;3,3,,a;3,4,6,a;6,5,5;7,5,7;1,3,134;6,4,,b;0,4,;5,0,14;3,1,;7,1,;7,4,012',[8]],
[1,4,'2,2,3;2,3,;2,0,,a;4,5,24,a;4,1,5;0,3,;0,0,023;3,2,5,b;4,4,2,a;0,1,23;1,2,234;2,1,6,a;1,4,4;3,4,67,b;1,0,03;1,1,25',[14]],
[1,1,'3,2,03;1,4,125;5,4,;7,2,;5,3,267;4,2,145;2,3,,b;3,3,;5,1,0,a;4,1,1;0,5,4;1,2,03',[4]],
[1,2,'1,3,2;2,5,7,a;5,1,2;4,1,2;3,3,02,b;0,3,,a;2,3,026;5,4,;2,1,4;4,4,7;3,5,0,b;7,1,0;6,0,123;3,1,14;2,4,24,a',[12]],
[2,3,'7,2,;3,4,01,b;5,3,136;3,2,234;1,3,56;5,2,3;6,2,4;6,3,1;2,5,0,a;3,1,;3,3,2;3,5,17,a;7,5,6;5,4,0',[2,3]],
[1,1,'5,5,,b;1,4,45;5,2,24;6,5,6;6,3,7;4,5,045;2,5,;3,3,3;2,4,,a;6,2,;4,1,15;3,2,247;1,5,456',[12]],
[1,2,'0,1,26;5,1,;6,0,14;3,0,;0,3,457,a;2,5,567;1,1,;1,2,67,a;6,3,1;1,3,;2,3,0,b;2,1,01,b;3,3,045,a;0,0,4',[5]],
[1,4,'4,2,14,b;7,3,;4,3,0;2,2,6;6,4,;6,2,3;4,1,6;5,1,017;4,5,6,a;1,3,7,a;5,5,057;1,5,4,a;7,5,7;3,1,14,b;4,4,56;5,3,247,a;6,5,04',[16]],
[1,1,'3,4,0;2,3,0;0,3,;6,5,17;4,3,14,b;4,4,147;3,3,046;7,3,4;3,2,04,a;0,2,;5,5,47;4,2,;4,5,467',[12]],
[1,2,'4,2,6,a;7,5,;6,0,,a;6,5,7;5,4,36,b;6,2,026,b;7,1,;3,3,456;5,3,35;5,1,034;3,1,5;4,0,034,a;4,1,',[7]],
[1,4,'5,2,;5,3,3,b;3,5,57;3,1,17,b;3,4,,a;0,1,2;2,2,,a;5,0,014;2,3,357;7,1,;3,0,02,a;3,2,256;4,1,345,a;1,3,7;0,4,4;1,4,2;2,0,',[8]],
[2,3,'2,4,67,b;6,1,7;4,4,0;3,3,;7,1,0;0,5,;6,0,3;0,4,4;5,4,05;3,4,0;2,3,2,a;3,2,123;1,4,01,a',[6,11]],
[1,2,'1,4,;2,5,07;0,3,56;3,1,,b;0,1,,a;5,2,;3,0,,a;6,1,01,a;4,1,037;2,1,45,b;4,3,026;0,5,05;6,3,016;2,3,1;4,5,0',[12]],
[1,4,'2,3,34,b;5,0,134;0,4,0,a;6,4,,b;1,4,4,a;6,3,;6,0,24;5,2,07;3,4,0;2,2,167,a;0,2,3;5,1,236;4,3,;1,1,12;7,3,1;6,1,7,a',[11]],
[1,1,'5,3,027;1,3,7,a;5,4,3;0,0,;6,0,0;1,1,1;0,2,2;3,5,7;3,3,257;0,3,3,b;3,0,07;2,0,04',[0]],
[1,2,'1,3,2,b;5,4,7;2,4,0;3,2,,a;2,3,2,a;1,5,7;0,4,25;2,1,3,a;3,3,047;2,2,0;1,1,24;2,5,;4,3,13;1,2,4,b',[8]],
[1,4,'0,1,46;3,2,026;3,5,;5,2,23;3,0,124;6,3,1,a;0,2,6,a;5,4,6,b;2,3,4,b;5,3,,a;6,2,0;4,3,07;4,0,3;4,2,234;2,1,,a',[13]],
[1,1,'4,2,0;4,4,4,a;5,2,03;5,1,023;4,0,012;3,1,;3,0,016;4,1,16;2,2,3;1,4,,b;0,3,;6,0,12;3,3,3;6,2,;6,3,1',[11]],
[2,3,'7,3,27,b;3,5,4,a;2,4,345;5,2,2;4,2,3;5,1,;2,5,5;7,1,267;3,2,5;6,4,5;6,5,047;7,5,,a;5,5,;6,0,4;7,4,14;4,4,5',[1,2]],
[1,4,'1,5,;7,0,;3,4,257;4,3,46;0,5,,a;2,0,0;5,0,7;4,0,04;7,3,16,b;3,0,1,a;0,3,02,a;2,3,,a;1,2,235;2,1,034;0,2,25,b;3,5,67;5,1,4',[2]],
[1,1,'6,2,16;5,3,147,b;2,0,1;7,1,2;6,5,;4,2,;7,2,047;5,2,24;7,3,;6,1,,a;3,5,04;6,0,13',[11]],
[1,2,'1,4,04,a;5,4,;2,5,7,a;2,1,2;2,2,24;1,3,245;0,4,5;1,5,5;2,4,47,b;3,3,2,a;1,0,;3,5,5,b;1,1,246',[12]],
[1,4,'6,2,;3,2,06,b;5,4,;4,0,;4,4,456,a;7,3,67;7,2,02;7,1,,a;6,5,367;4,3,0,a;3,0,7;2,2,3,a;6,3,34,b;7,4,03',[8]],
[1,1,'5,5,57;3,2,36,a;0,1,;0,4,26;3,0,;4,3,2;2,3,457,b;5,0,;2,2,124;0,5,;2,4,3;0,2,34;7,3,',[0]],
[1,2,'3,3,257,b;5,4,07,a;6,4,345;6,3,01;7,4,;5,0,,a;4,2,1;4,0,24,b;5,5,456;6,5,2;0,0,;7,3,07;3,4,;7,5,2;4,3,4,a',[8]],
[2,3,'3,3,07;4,2,234,a;4,5,2;6,3,026;3,2,;1,1,;2,0,23;5,3,2;6,2,03;1,0,34;2,1,;6,4,17,a;7,3,;2,3,;3,1,37;2,2,7,b',[3,9]],
[1,1,'4,4,47;0,3,03,b;5,2,24;5,4,06;1,1,1;0,0,234;3,1,;2,2,457;1,4,,a;4,0,;5,3,;6,2,17',[7]],
[1,2,'7,4,0;2,1,2,a;3,3,,a;2,2,,b;5,4,367;4,5,346;6,5,02;4,2,27;4,3,07,a;6,3,13;4,4,67,b;5,3,25;3,1,;5,5,',[9]],
[1,4,'1,4,;5,2,;3,0,34,a;1,2,2;3,3,56,b;2,1,4;7,1,056;3,1,,b;5,1,045,a;3,4,367;6,0,7,a;4,5,0;4,2,,a;1,5,06;5,4,056',[14]],
[1,1,'2,5,6;4,0,3,a;7,0,025;2,2,5;5,5,567;4,3,145,b;3,3,;7,1,7;5,4,;4,4,467;4,2,;5,3,;6,4,37',[4]],
[1,2,'6,1,7;4,1,,b;4,0,3,a;6,0,3,a;3,5,,b;5,3,125;0,1,0;5,4,57;3,0,4;7,1,0;5,1,,a;2,1,06;5,0,14;6,3,7',[5]],
[1,4,'2,0,03,a;3,2,;2,5,25;7,5,3;1,0,47;5,0,14;6,0,1,a;0,3,;6,4,03,a;6,1,024;5,3,1;5,4,06;5,1,01;2,4,,a;3,0,01,b;5,2,567,b',[2]],
[2,3,'2,5,6;2,3,26,b;5,3,3;4,3,05;2,2,,a;4,4,56;5,0,;5,1,;6,0,013;3,2,3;7,4,;5,2,23;2,1,235,a',[5,8]],
[1,2,'0,0,46,a;1,4,,b;6,4,;0,2,6,b;6,0,2;2,2,127;3,0,234;5,5,5;0,3,236,a;1,3,467;1,2,,a;6,3,7;3,3,2;2,5,47;1,1,',[5]],
[1,4,'1,2,,a;2,1,7;4,0,3;6,4,57;6,3,5,a;7,2,4;0,1,024,a;3,0,023;3,2,47,b;6,2,;4,2,36;1,0,1,b;0,3,345;7,3,0,a;2,5,5;3,4,;1,3,67',[7]],
[1,1,'3,2,02;5,5,0;2,3,1;5,4,57;4,3,67;2,2,02;4,4,347;7,2,15;1,2,46;2,5,0;1,1,;4,2,35,a;0,5,,b;3,4,',[6]],
[1,2,'5,2,,b;6,2,24;5,1,37,a;3,3,7;4,2,026;3,2,03;3,5,5;2,2,13;1,2,;4,1,4,a;6,3,67,a;4,5,;1,5,456;4,0,6;7,2,5,b',[12]],
[1,4,'3,0,12;1,2,17,b;7,4,2,a;5,2,137;3,3,4;6,1,,a;1,4,6;4,2,,b;4,4,4;5,1,,a;6,4,067;3,4,0;5,3,47;7,3,67,a;7,0,17;0,1,',[10]],
[1,1,'0,3,;5,3,12;2,5,,a;4,4,0,b;2,3,357;5,5,26;1,5,457;0,1,23;2,4,36;4,5,06;3,2,;5,4,1;3,5,5',[6]],
[2,3,'5,2,;3,2,04;3,0,237;4,3,47;5,3,;4,2,6,a;3,5,02;3,3,57;1,3,3,b;0,2,6;4,4,06;4,1,3;1,2,;0,5,6;1,4,,a;4,0,015',[10,2]],
[1,4,'4,2,,b;1,1,4;7,0,3;4,3,,a;3,0,024;1,0,25;6,1,267;4,0,4;5,0,14,a;6,3,,b;5,3,07,a;0,0,;3,3,247,a;3,5,7;4,1,346',[4]],
[1,1,'2,1,0;4,1,014;1,4,6;6,3,7,a;5,1,17;6,4,046;2,3,46;1,2,;1,1,;4,2,,b;3,4,67;4,0,;3,3,017',[5]],
[1,2,'4,2,5,a;7,2,07;2,3,147;6,1,12,a;2,1,127;6,4,,b;6,2,;3,1,4;4,3,147;5,1,,b;6,3,25;0,1,7;0,5,;3,3,456;2,2,,a',[2]],
[1,4,'6,4,3,b;1,3,;3,3,067;4,2,016;0,4,6,a;2,2,;0,5,1;1,5,567,a;3,2,16,a;1,4,14,b;0,2,2;4,1,,a;4,4,4;3,1,14',[3]],
[1,1,'4,1,146;5,0,4;4,0,;5,1,126;3,2,147;4,3,03,b;3,4,;2,4,4;6,5,56;5,2,1,a;7,0,;2,3,;5,3,5;2,1,;6,2,137',[0]],
[1,2,'6,3,,b;4,1,36;6,2,2,a;2,5,,a;5,1,0;4,0,;6,1,013;2,0,;4,3,14;5,2,2;6,5,6;5,4,3;5,0,013;5,3,057,a;7,2,02,b',[12]],
[2,3,'0,3,2;3,2,6;0,4,4;5,2,04;5,0,2;6,5,;5,3,34,a;6,3,6,a;3,0,13;6,2,,b;6,4,02;3,4,0;1,2,45;3,3,047',[4,13]],
[1,1,'5,5,67;1,2,14;3,4,;7,5,;2,5,25;2,3,23,b;6,5,047;2,4,1,a;1,0,245;4,5,0;4,3,017;3,0,0;4,2,2;4,4,1;0,3,',[6]],
[1,2,'5,5,6,a;5,1,;7,4,37;4,1,2,b;0,5,4;5,3,056;4,2,07;2,4,2,a;3,4,0,a;7,1,02;2,3,34,b;3,2,;3,5,04',[12]],
[1,4,'2,2,25,a;5,5,;6,4,;3,1,26;2,0,14;2,3,025,b;3,2,1,b;1,1,234;4,0,3;4,2,36,a;2,4,5,a;1,4,;5,1,1,a;2,5,;5,3,23',[4]],
[1,1,'0,4,2;1,4,34;3,2,4,a;2,3,57;0,1,02;4,0,;2,1,04;3,3,;5,1,07;2,5,5;4,2,,b;4,1,;2,4,56;4,3,027;4,5,25',[1]],
[1,2,'0,4,,a;2,0,5,a;2,3,146;4,3,267;1,4,7,b;3,2,;5,5,;1,1,234;3,1,7,b;1,3,;4,5,7;3,3,127;2,2,1,a;4,2,157;6,5,067;1,5,7',[14]],
[1,4,'4,3,145,b;6,2,;6,1,;0,0,7;5,4,0,a;3,3,067,a;6,5,067;5,3,;4,1,34;3,4,245,a;4,4,7;5,2,47,a;4,5,,b;3,1,7;6,4,5',[6]],
[2,3,'2,4,24,b;7,1,,a;1,3,35,a;1,0,2;7,5,23;5,4,;5,3,035;6,0,13;2,2,6;2,5,;4,0,;4,1,67;4,2,136',[3,7]],
[1,2,'2,5,4;7,1,5,a;6,0,12;3,1,4,a;7,2,;6,1,014,a;5,5,5;3,4,1;4,2,246,b;5,1,13;4,0,5;1,1,1;4,5,045,b;4,4,57;6,2,',[2]],
[1,4,'5,2,27;2,0,3;7,0,2;1,3,7;5,3,3;4,4,36,b;3,4,24;2,1,5;3,1,015;3,2,5,b;7,3,1;2,3,034,a;4,0,34,a;4,1,,a;3,0,;2,2,23;4,3,157,a',[1]],
[1,1,'4,3,4;3,4,237;2,2,1;4,1,13;1,3,7;0,2,;1,1,13;2,5,;2,3,24;1,2,0,b;1,4,456;3,2,157;5,5,;2,1,01,a;5,3,2',[11]],
[1,2,'0,2,7;5,3,3,b;3,1,057;2,1,1,b;2,0,1,a;4,2,7,a;7,2,;4,5,7,a;0,3,;5,2,23;6,1,123;4,0,2;4,4,26;6,4,017',[10]],
[1,4,'1,1,3;2,0,0;0,5,35,a;2,2,256;5,2,237;2,5,056,a;3,5,05;3,1,2;3,4,4,b;2,1,36;2,3,;2,4,345,a;4,4,;6,3,1,b;4,5,6;4,2,;4,3,2,a',[0]],
[1,1,'2,1,0;5,5,356;6,5,046;5,4,367;5,3,015,a;7,4,2;6,3,;2,3,;7,5,;5,1,67;1,1,;4,4,;5,0,,b;6,4,467',[3]],
[2,3,'6,1,56;3,2,7;3,3,16,b;5,5,6;4,5,0;3,0,1,a;1,5,,a;3,1,;6,0,07;5,4,056;5,3,7;6,4,1;5,2,6;4,4,015;3,4,;6,3,067',[4,11]],
[1,4,'5,3,6,b;2,4,7;2,1,27;4,4,4;4,2,257,a;6,3,01,a;1,2,6;1,1,346;3,2,245,b;0,3,0;1,0,3;3,1,,a;3,3,046,a;4,5,;4,1,07;5,1,;0,2,',[6]],
[1,1,'3,3,6;6,3,14;7,0,;5,4,4;5,5,7;4,3,6,a;5,2,124;3,2,35;7,2,06;7,4,,b;7,3,16;5,3,5;6,1,236',[12]],
[1,2,'2,2,27,a;2,0,,a;0,0,156;2,1,126,b;1,2,5;3,4,057;4,3,;2,4,6,a;1,3,,b;0,5,;0,4,02;0,1,47;3,1,016;3,0,',[5]],
[1,4,'0,1,45;1,5,13,b;3,1,2;1,2,3;0,4,,a;2,1,,a;1,4,0,a;5,5,5,b;0,2,6;1,0,6;3,3,136;4,5,0,a;4,2,012;1,3,257;2,2,046',[13]],
[1,1,'4,3,045,b;3,4,356;2,2,;6,4,;3,2,026;5,5,5;6,5,07;3,3,1,a;4,0,;3,1,;4,5,46;4,2,6',[6]],
[1,2,'5,2,6,a;3,1,235;4,2,,a;0,2,13;1,2,4;5,1,;4,0,37;1,0,12;2,2,4;0,1,;3,2,047;1,1,123,b;1,5,0,a;4,4,6;1,4,2,b',[1]],
[2,3,'0,3,;4,2,15;5,2,346;3,2,6,b;1,1,023;3,1,,a;1,5,;2,0,13;5,0,4;4,4,146;6,4,;6,0,,a;3,5,056;0,1,24;1,2,',[2,7]],
[1,1,'1,5,0,b;3,2,2;4,3,05;1,3,4;4,5,56;7,2,0;2,3,07;0,5,;5,2,125,a;3,5,024;7,0,;0,1,',[1]],
[1,2,'2,5,14;6,4,7;7,1,06,a;6,1,6,a;5,4,045;7,4,1;6,5,,b;5,2,245;7,2,6,b;6,0,12;2,4,0;7,3,02,a;4,2,6;6,2,3;1,4,37;4,3,',[7]],
[1,4,'1,2,13,a;0,3,16;4,2,;1,1,;1,3,1,a;2,3,5,b;4,0,124;0,2,25,a;6,5,,b;3,2,013;3,0,34;5,2,;5,0,012;5,3,01;3,3,,a',[10]],
[1,1,'3,5,;5,0,,a;0,0,2;2,3,017;5,3,016;6,3,07;5,1,056,b;2,1,3;1,4,3;3,0,0;0,1,;5,4,',[5]],
[1,2,'5,0,01,b;5,5,;7,1,,a;5,3,026;7,4,6,a;4,3,567;6,4,47;3,2,46,b;6,2,;7,2,;4,1,4,a;6,3,236;6,1,4',[11]],
[1,4,'6,3,26,a;2,3,14;1,5,456;6,1,26,a;4,4,14,a;0,5,;5,4,,b;1,3,467;3,4,6;4,2,037;3,5,;6,4,06;1,0,;3,2,12,a;3,1,03,b;2,1,0;4,3,',[2]],
[2,3,'0,0,;4,3,3;1,4,24,a;1,5,35;0,3,2;2,1,1;1,1,257;5,4,3;0,4,6,b;6,5,;2,5,;4,5,06;3,3,07;2,0,2;2,4,4,a',[11,12]],
[1,2,'4,4,01;6,0,1;6,2,27;7,5,05,a;4,5,7;3,0,;1,2,24;6,3,5,a;7,2,1;5,2,47,b;5,5,;1,5,;6,4,03,b;5,3,245,a;4,2,034',[1]],
[1,4,'3,2,245;2,5,,a;1,3,2;2,2,234;0,4,;7,1,0;1,1,23;4,4,2;2,3,124,b;2,0,2;1,0,124;0,5,0,a;3,4,0;1,2,2,a;6,2,5,a;5,0,1,b',[10]],
[1,1,'7,0,;5,0,;3,3,13;0,1,;6,0,024;4,3,37,a;5,1,01;5,2,14,b;3,5,14;6,2,;1,5,3;6,1,014;2,1,02;6,5,;4,4,16',[4]],
[1,2,'5,0,04;3,5,047;0,5,,a;3,0,1;1,3,7;3,4,024;7,3,4,a;5,2,6;1,4,17;7,0,5;7,2,2;5,5,;0,3,7,b;6,4,5,a;5,4,456,b;0,2,6',[5]],
[1,4,'1,2,246;4,2,057,b;2,3,6;2,2,257;3,1,2;3,2,6,a;2,5,,a;0,4,,a;4,1,45;1,5,45;0,0,;5,0,247;1,3,12,b;2,0,,a;5,2,;1,1,4;6,0,6',[0]],
[1,1,'3,4,13;6,4,017;5,4,12;4,5,0;3,3,125;1,0,;6,0,;3,1,7;2,5,,a;1,3,236;5,5,7;5,3,07;2,4,,b;2,3,024',[1]],
[2,3,'2,3,14;6,2,,a;4,3,3;2,1,1;4,5,;2,4,4;5,3,057,a;3,5,46;0,5,4;4,4,5,b;2,5,45;3,0,24;3,3,;4,1,017',[5,13]],
[1,4,'3,0,,a;3,5,,a;3,2,156;2,4,3,b;2,5,,a;2,3,02,a;1,3,345;1,1,5;5,4,037;4,0,17,b;4,3,;4,4,167;3,1,1;6,5,7',[8]],
[1,1,'3,3,23;4,4,3;1,3,4;5,3,1,b;7,2,4;2,4,;3,5,7;4,2,346;0,1,03;1,1,;3,1,013;4,0,12;1,0,124;4,1,,a',[12]],
[1,2,'5,1,7;2,1,024;3,5,,a;6,2,167,b;3,4,,a;7,0,05;6,1,7;5,3,1;4,0,4,a;2,2,5;3,1,23;4,2,246;4,1,4;4,3,1,b',[1]],
[1,4,'5,2,235,a;6,3,1,b;2,3,35;3,4,;4,1,347,b;5,1,;1,1,2;1,5,,a;5,3,035,a;3,0,;7,0,4;6,4,;5,4,;3,3,16;3,1,07,a',[2]],
[1,1,'5,3,;5,4,16;6,0,16;3,4,,a;6,3,67;3,0,3;3,1,037;2,1,037;1,1,;6,4,;1,0,;3,3,2,b;6,1,16;2,0,34',[6]],
[1,2,'5,5,;0,5,6;2,3,,b;5,0,2;2,0,04,b;2,5,046;7,3,03,a;5,3,047,a;1,3,;5,4,;0,3,4,a;5,2,124;7,2,17;3,3,',[11]],
[2,3,'2,5,;4,1,34;1,3,13;5,4,4;4,4,2;4,2,23,a;1,2,25;1,1,,a;2,2,1;5,1,01;5,3,0;6,4,7,b;2,4,2;2,1,034',[6,8]],
[1,1,'7,5,;4,1,0,b;7,2,17;1,2,;2,3,17;6,1,6,a;6,3,4;2,1,024;0,1,;7,3,2;6,4,35;3,1,346;5,2,47;5,4,467;6,0,',[13]],
[1,2,'7,0,0;7,4,;4,2,26;4,4,67;2,4,46;4,1,3,a;5,5,457;7,3,046,a;5,3,1,a;4,3,346,b;3,4,,b;2,2,2;2,3,',[6]],
[1,4,'5,3,,a;6,1,7,b;6,5,067;4,2,27,a;1,2,;7,0,,a;5,0,;5,2,7;3,1,46;6,2,056;3,4,5,b;2,4,5,a;3,2,024;7,1,156;3,5,57;4,1,',[2]],
[1,1,'0,4,5;0,1,1;3,2,6,a;7,0,;1,3,156;3,4,047;5,4,4;4,0,234;1,1,;4,1,012;1,4,,b;2,3,057;4,2,0;6,2,;2,1,1',[5]],
[1,2,'1,4,24,b;5,0,;1,2,4;3,3,3;3,0,123;5,2,156,b;6,1,0,a;1,5,67;2,4,36,a;4,3,;3,2,124;4,1,,a;4,4,',[4]],
[1,4,'4,0,2,a;7,3,6;6,0,05,a;1,4,46;5,5,;5,4,;5,3,23;7,0,6;7,2,,a;4,1,17;3,0,024,b;2,0,34,b;6,3,237;7,4,56,a;6,4,156;6,1,125;3,4,',[15]],
[2,3,'1,5,;5,1,124;5,3,026;4,5,,b;7,5,5;6,4,0;0,4,;5,2,35;6,1,;5,5,457,a;2,2,;4,4,4;1,4,0;3,3,;2,5,047;5,4,6,a',[1,14]],
[1,2,'4,4,03,a;1,2,,b;4,2,02;0,5,,a;0,2,12;1,1,12;1,5,;5,5,0;1,3,5;3,4,16,b;3,5,57,a;2,5,034;2,2,37',[2]],
[1,4,'3,5,57;7,4,;6,4,247;4,1,345;5,5,045;7,2,12;4,5,6;6,2,,b;3,2,2;6,5,67;0,2,26;3,1,4,b;4,3,04,a;6,1,3,a;5,2,1,a;6,3,,a',[4]],
[1,1,'4,2,;1,3,4;4,5,5;3,3,012;2,0,6;0,5,;2,3,156;2,4,;6,3,3;2,1,36;4,1,27,b;3,5,047;1,4,15;1,5,0;3,0,1,a',[3]],
[1,2,'4,2,236;5,1,;5,4,45,b;0,2,;4,4,6,a;6,5,1;4,3,,b;5,3,246,a;7,4,;2,2,247;2,4,457;6,3,23,a;3,3,',[9]],
[1,4,'0,3,;0,4,16;1,4,23,a;3,3,017,a;2,3,036,b;4,2,125;4,4,12;2,5,,a;1,5,16,a;6,0,;5,5,;1,1,4;2,2,1;2,1,3;4,5,7;3,5,45;3,4,1,b',[5]],
[1,1,'2,0,;6,3,036,b;7,4,36;5,0,0;4,3,;6,0,;4,0,013,a;4,1,056;2,2,0;7,3,0;0,2,;1,1,5',[7]],
[2,3,'2,2,345;1,2,13;3,0,,a;4,2,5;0,3,;7,2,1;3,1,26;5,5,,a;2,3,45;6,3,;5,3,6;5,1,2;2,0,24;4,0,17;5,0,3,b',[1,12]],
[1,4,'4,3,24;2,2,,a;5,5,046;3,5,;6,2,01;4,4,17;5,4,7,b;5,3,36,b;6,3,5,a;6,5,;2,5,;3,2,46,a;4,2,;3,3,347;5,0,45,a',[13]],
[1,1,'2,4,247;4,4,12;1,0,1;2,1,027;3,3,67;4,2,1;2,5,7;1,1,145,b;1,4,;4,3,067;3,1,,a;2,0,15;0,2,;0,1,',[9]],
[1,2,'3,1,02,a;4,2,27;1,2,1,a;3,3,157,b;5,5,;4,5,47;2,3,5;1,1,;5,1,016;4,1,0;0,0,1;1,5,6,b;5,0,5,a',[8]],
[1,4,'2,1,;1,2,13,a;2,3,467,b;5,3,6;7,3,;4,5,47;1,1,2,a;6,2,;3,4,01;6,4,026,b;7,5,267;1,3,6;3,5,456;4,4,37,a;0,3,5,a;2,5,7',[12]],
[1,1,'1,2,7;1,3,056;2,2,245;3,2,34;5,0,;3,3,;0,3,;6,2,012,b;4,0,24;0,1,04;4,3,;2,1,4;5,1,;4,4,7,a',[1]],
[1,2,'6,3,0;4,1,04;6,1,26;2,1,1;5,0,123,b;2,0,14;6,2,56;2,4,7;5,4,05,b;5,1,2,a;0,2,,a;1,2,3,a;7,1,2;4,2,01;3,2,5;6,0,12',[5]],
[2,3,'5,4,,a;6,4,034;4,5,7;5,5,0;7,5,;4,2,6;3,0,1;1,1,0;4,1,47,b;0,3,1;4,4,67;7,4,07;0,1,,a;6,3,17;5,1,13',[1,3]],
[1,1,'1,3,,b;2,4,07;3,2,6;4,2,157;6,0,36;7,4,;0,2,23;0,3,01,a;3,1,57;7,2,23;2,0,1;7,1,2;4,0,04;1,4,5',[3]],
[1,2,'1,2,0,a;3,2,14,a;4,5,067;0,4,4,b;2,5,6;3,4,;2,4,6;4,4,,a;2,2,023,b;7,5,;1,3,6;6,5,047;1,4,04;3,3,0',[11]],
[1,4,'1,3,67,b;1,5,5,a;2,1,2,a;3,0,235;4,2,137;1,4,26;3,2,47;1,1,,a;2,2,257;1,2,;4,1,156;2,4,36,b;5,3,;3,1,;3,3,0;0,2,7,a;5,0,67',[3]],
[1,1,'4,2,0;6,5,6;2,2,1;5,5,027;6,2,2;5,1,1;7,3,027,a;1,1,;2,4,1;4,3,47;7,4,1;2,1,05;4,4,057;2,5,5;6,3,5,b',[3]],
[1,2,'3,2,135,b;6,3,34;6,2,;4,1,14;1,4,7,a;7,4,;6,1,2;4,3,045,a;3,0,023;0,3,0,a;5,2,1;0,0,7;2,3,,b',[8]],
[1,4,'6,1,;3,2,,a;4,3,2,b;0,2,6;0,4,;5,2,135;4,1,13;2,3,34,b;3,4,67,a;3,3,5,a;4,4,3;2,2,13;1,2,034,a;1,1,234',[13]],
[2,3,'0,3,;6,5,04;3,5,0;5,5,02,a;7,5,;4,1,;6,4,02;7,1,1;1,5,045;6,1,14;6,2,3;3,2,2;4,4,6,b;1,4,57;3,4,02,a',[6,9]],
[1,2,'1,3,045;5,2,25;3,1,;3,4,47;2,4,6,a;2,3,6;1,5,345,a;0,3,3;6,1,,b;2,2,4;3,3,26;2,5,0,b;5,4,0,a',[0]],
[1,4,'6,3,2,b;3,3,0,a;7,1,;0,3,0;4,4,6,b;6,1,124;3,4,147;3,1,24;2,1,,a;6,2,3;2,5,7;5,4,035,a;4,3,2;7,3,6;0,1,1;6,5,37,a;3,2,247',[7]],
[1,1,'0,4,06;3,2,27;1,1,;3,5,5;1,2,1,a;2,1,6;1,4,256;0,3,6;2,2,167;5,3,2;2,3,;2,5,067;0,5,156;0,1,;1,3,,b',[11]],
[1,2,'4,0,123;6,0,;2,0,34;4,3,57;5,0,4;4,2,12;3,2,2;5,3,,b;3,4,0,b;3,1,245,a;5,1,6;3,5,015;1,3,;1,0,23;4,1,,a;2,4,347,a',[2]],
[1,4,'1,2,4,a;3,4,047,a;0,0,5;6,5,67;7,4,;6,1,;3,0,,a;6,3,356;1,4,456;3,2,12;4,2,,a;2,2,7;3,1,236,b;1,1,47;2,3,,b',[3]],
[1,1,'5,1,05,a;3,1,07;2,1,;4,2,5;3,2,357;3,4,7;5,5,567;5,4,067;5,3,5;2,0,0;4,3,,b;3,3,56;6,4,',[6]],
[2,3,'5,0,,a;0,1,;4,1,4;5,1,,b;6,5,15;6,1,037;7,2,;3,2,456;3,1,04;5,2,,a;2,5,;4,3,167;7,4,6',[4,11]],
[1,4,'3,3,145,a;1,1,013,a;0,4,;5,4,,b;4,3,23;6,5,,a;6,3,2,a;0,1,;5,3,7;5,5,7;1,0,123;2,3,;7,4,7;3,1,37;2,4,06;4,4,345,b',[10]],
[1,1,'0,1,6;4,2,26,a;3,3,6;2,0,4;4,3,07;5,2,0;1,1,015;3,2,5;1,0,3;4,1,123,b;0,2,;0,0,4;4,0,12',[6]],
[1,2,'4,0,3;3,2,016;3,3,57,b;1,1,25;4,5,67;3,4,067,b;6,4,;1,3,,a;2,3,,a;1,4,3,a;1,2,2;6,5,067;6,0,2;3,0,45',[11]],
[1,4,'1,5,7;3,3,7;4,4,,a;1,3,24;4,5,26,a;3,4,4,b;5,5,;0,3,7;4,3,02,a;2,5,127;6,4,012,a;0,4,0;4,2,3;3,1,123;2,3,23,b;6,5,27;1,1,',[13]],
[1,1,'2,0,14;2,1,046;4,3,026;5,3,36;4,2,;5,0,1;6,2,14;1,1,;2,4,16;4,0,23,b;1,5,,a;4,1,12;3,1,1;7,5,0;7,2,',[8]],
[1,2,'1,4,14,b;3,3,356,a;4,1,,b;6,0,1;0,3,5;2,1,4,a;2,2,036;1,0,01;4,2,5;4,4,5;3,2,1,a;0,1,;1,2,16;0,0,07',[6]],
[2,3,'7,4,;5,2,145;3,2,;6,0,012;4,2,146;5,0,;4,4,7,b;6,1,23;7,2,02,a;2,2,,a;4,0,03;1,0,34;3,0,;6,2,1',[11,3]],
[1,1,'3,4,1;7,0,7;5,3,1;4,0,124;1,0,134;0,4,3;4,1,4,a;1,5,;4,3,5;3,1,235,b;6,1,25;0,1,2;6,4,',[4]],
[1,2,'2,3,345;1,3,36;4,5,3,a;5,4,01;2,0,1,a;2,4,06,a;3,2,02;6,5,;1,1,;2,2,36,b;4,3,3;4,0,1;5,5,4,b',[11]],
[1,4,'2,5,247;5,0,4,a;5,5,045,a;7,0,6;6,0,4;5,4,3,a;6,4,;2,4,236;7,5,,a;3,5,4;4,5,3,b;2,3,345;4,3,7;1,2,;3,4,47;1,4,5;1,0,236,b',[7]],
[1,1,'5,3,5;4,4,45;3,4,07;7,4,3;5,4,;6,2,46;4,5,35;7,2,1,a;6,4,;4,2,245;6,1,3;5,1,;5,2,123;1,4,04,b',[9]],
[1,2,'7,0,0;3,5,346;1,3,,b;5,2,5;4,2,1,b;4,0,,a;4,3,06;5,1,07,a;3,4,,a;2,5,456;3,1,15;6,5,37;2,4,05',[9]],
[1,4,'5,3,,b;1,2,235;5,5,1;0,4,,a;2,3,4;1,5,246;2,4,047;4,3,45,a;3,5,;2,1,347;3,1,1,b;0,2,14;2,2,,a;5,4,2;1,4,0,a;1,0,27',[6]],
[2,3,'4,5,06,a;3,3,4;0,3,6;2,5,57;4,1,6;0,2,,a;1,1,1;4,4,1;2,0,7;3,4,,b;4,3,026;6,3,027;1,5,45;1,2,123;2,3,6;3,5,6',[6,13]],
[1,2,'2,2,5;4,2,047;0,5,6,b;4,3,0,a;1,0,37,a;0,2,47;1,2,013;2,1,,b;5,0,7;3,2,017;5,2,16,a;2,0,;3,1,',[1]],
[1,4,'4,1,,b;5,5,4,a;4,4,3;6,0,04;2,4,,b;2,2,134;1,3,3;3,5,46,a;6,5,7;3,3,13,a;4,0,4;3,0,034;3,4,02,a;5,4,7;3,2,456;5,0,',[5]],
[1,1,'6,3,4;4,2,7;0,4,7;3,3,016,b;7,3,4;0,1,,a;1,2,4;3,1,0;2,3,167;0,5,6;0,0,3;3,0,013',[11]],
[1,2,'5,4,45,a;3,3,;5,1,012;0,3,4,a;5,0,;3,1,,a;3,0,12,b;1,1,;6,3,4,b;1,2,015;4,1,157;2,1,01;2,3,',[2]],
[1,4,'5,2,,a;4,1,3;3,4,,a;2,4,035,b;4,5,067;3,5,07,b;0,5,2;1,3,24;4,4,7,a;1,4,56;1,1,5,a;5,1,02;6,4,1;2,2,13;5,4,014',[14]],
[1,1,'6,3,036;0,0,3;3,3,34;5,0,0;4,4,26;6,0,;6,4,7;7,4,6;7,3,7;4,5,;3,1,,a;6,1,67;3,0,07,b;5,4,045',[13]],
[2,3,'5,0,;1,2,13,a;2,1,013;0,1,6,b;0,3,;1,1,2;3,2,05;0,0,4,a;2,2,;3,4,7;2,3,;1,3,45;1,4,46;0,2,6',[2,12]],
[1,4,'3,2,3,b;2,3,;1,2,1,a;3,4,07;2,4,56;2,1,123;4,2,45,a;0,1,24,a;7,2,;4,0,;1,3,7;2,2,4;4,3,046,a;5,3,02;5,5,;0,2,2,b',[3]],
[1,1,'0,3,36;1,5,05;1,2,45;0,0,;5,1,;6,1,02;1,3,0;1,4,,a;6,4,0;3,5,067;2,4,;5,4,02,b;3,4,57;2,2,017',[9]],
[1,2,'4,2,16,b;3,1,6,b;6,4,01;3,2,356;5,5,,a;5,2,25;4,3,7,a;3,0,2;4,4,2;6,1,12,a;5,3,13;3,4,4;4,1,4;6,0,01',[13]],
[1,4,'4,1,1;1,5,45;2,0,134,a;5,0,1;0,2,6,b;3,3,16;2,3,46,b;1,0,24;5,3,47;2,1,,a;1,3,4;2,4,27,a;3,2,6,a;7,3,;3,0,156',[7]],
[1,1,'4,2,27;3,5,,a;7,2,237;3,0,;4,3,,b;6,1,;3,3,;6,3,7;6,2,014;5,3,047;5,4,056;4,4,;5,5,03;6,5,067;7,5,',[13]],
[1,2,'3,1,;5,3,07;3,4,3,b;4,5,05;7,2,126,a;2,5,5;4,3,0,b;6,2,024;7,1,;2,3,26,a;5,2,013,a;2,0,;7,5,4;6,3,0;5,4,1;4,2,7',[7]],
[2,3,'2,3,12,a;6,2,,b;7,5,5;4,5,04;7,2,;5,3,035;1,4,6;6,0,;7,1,157;4,3,035;6,5,,a;6,1,34;3,5,',[3,9]],
[1,1,'4,1,16;3,4,36;0,1,6,a;1,1,7,b;6,1,013;2,0,2;0,4,6;3,1,0;2,3,016;5,0,013;1,4,;3,2,;1,3,1;3,3,6',[9]],
[1,2,'2,4,2;7,3,1,b;5,3,;3,0,2;6,2,034;7,2,,a;4,2,1,a;3,5,5;4,4,5;4,3,56;3,2,234,b;5,4,67;5,2,5,a',[3]],
[1,4,'4,2,03;2,0,,a;3,4,456;2,4,067;2,2,;4,5,3;3,2,45,b;7,5,0;5,4,4;1,4,;3,1,1;2,3,156,a;5,2,047,a;2,5,456;5,0,07,a;7,2,;3,0,,b',[13]],
[1,1,'1,1,25;1,0,0;3,0,24;2,0,3;0,0,;3,1,6;2,1,057;1,2,03;0,2,3;4,1,23;3,5,4;3,4,5,b;5,0,15;4,3,,a',[6]],
[1,2,'4,3,04,b;5,2,017;7,0,125;3,0,;1,4,3,a;4,2,1,a;6,3,;3,2,1;4,1,267;6,0,04;2,5,6;2,4,,a;1,3,4,b;5,0,2',[9]],
[1,4,'4,0,;0,4,345;3,4,,a;0,1,256;0,2,46,b;1,2,3,a;4,3,06,b;1,3,24,a;2,2,157,a;4,1,45;3,1,03;2,0,124;0,0,;2,1,;5,0,',[11]],
[2,3,'7,3,6,a;6,1,0;3,4,4;4,4,;5,0,023;6,4,356,b;4,2,023;4,3,;1,0,3;7,5,01;4,0,;5,1,,a;1,2,346;6,3,;5,5,1;5,2,',[4,6]],
[1,2,'4,4,567;2,2,6;6,2,,a;7,3,27;7,4,057;2,1,1,b;2,4,;4,1,2,a;6,0,;5,2,2,b;4,2,35;3,2,26;1,1,;2,3,356;3,4,046,a;5,3,45',[13]],
[1,4,'0,4,;4,2,16;7,3,;4,1,14,a;2,2,15;3,1,345;1,0,4,a;5,5,567;4,0,0,b;2,3,6;6,1,07,a;5,2,,b;2,1,17,a;3,0,1',[7]],
[1,1,'3,2,;4,2,;1,4,046;3,3,36;1,3,2;2,0,012;3,0,;0,4,23;1,1,4;2,3,1,a;3,1,4;4,1,12,b;2,4,25;1,5,0;1,0,2',[5]],
[1,2,'3,4,5,a;5,3,04;3,3,157,a;4,0,,b;7,2,;0,0,5;5,5,567;7,3,67;5,4,56;6,0,;4,3,6,b;2,2,7,a;2,4,46',[6]],
[1,4,'7,3,;5,2,027,a;5,5,57;4,0,02;5,3,2,a;7,0,2;2,0,37;4,3,2,b;7,2,1;2,2,36,a;2,1,;5,0,024;3,0,,b;3,3,5;0,1,6;0,0,,a;3,1,016',[11]],
[1,1,'4,3,367;0,1,5;4,0,3;3,3,04,b;3,2,;3,1,56,a;3,0,;4,1,025;1,1,034;5,1,7;5,3,7;2,3,',[8]],
[2,3,'5,4,46;3,3,5;6,3,17;6,4,;5,2,,a;4,5,0;7,2,2;4,4,02;4,1,4;4,2,234,b;7,5,6,a;7,4,26;1,5,1',[2,1]],
[1,4,'5,1,,a;4,4,156;6,4,6,a;3,3,5;0,5,2,a;3,5,01;4,3,34;5,0,016;5,3,6;7,5,7;4,5,246;6,3,,b;5,5,467;2,0,,a;4,2,357,b;5,4,7',[10]],
[1,1,'6,1,1,a;3,4,;3,0,0,b;1,4,;1,3,25;6,0,0;5,3,0;4,1,15;3,1,34;1,0,25;5,0,123;2,1,5;3,2,167',[5]],
[1,2,'1,2,;6,4,0;3,2,01,b;7,4,,b;7,2,236;5,4,457,a;2,2,03,a;2,1,,a;2,3,2;2,5,;5,5,1;5,2,024;1,4,5',[11]],
[1,4,'2,3,,a;1,3,7,b;3,2,14,a;1,4,235,a;1,5,7;0,4,57;3,1,35;6,4,,b;1,2,456;2,1,3;1,0,;4,0,13;2,5,47;3,0,124;6,2,,a',[13]],
[1,1,'2,4,247;2,2,1;1,3,047;3,5,67;4,3,,b;2,5,;3,4,345,a;2,3,4;0,3,;2,1,4;0,2,4;5,4,47;3,2,157;5,0,0;1,4,2',[3]],
[1,2,'5,4,156;6,1,2;4,5,46;6,0,04;6,5,,a;7,0,6,b;4,0,5;7,1,12,a;6,3,02,a;5,5,5;4,3,4;7,4,6,b;4,4,0;5,1,456;6,2,;5,0,03',[0]],
[2,3,'6,2,035;7,3,37;2,4,;3,5,,a;3,3,17;3,1,467;3,0,2;2,2,07;5,3,017;1,1,0,a;6,1,;7,1,6;0,3,,b;2,0,1;2,1,1;3,2,7',[0,8]],
[1,1,'2,4,2;0,2,4;6,2,67,a;5,1,23,b;6,1,7;3,2,024;2,5,7;1,5,;1,2,2;5,3,17;1,0,;2,1,237;5,0,;0,3,67;3,5,167',[11]],
[1,2,'3,1,047;1,1,237;3,2,;4,4,0,a;1,5,;3,3,1,a;5,2,013;4,3,0,b;5,0,024,a;6,0,1;2,0,;6,1,37,b;3,4,;3,0,',[0]],
[1,4,'2,5,134;6,2,,a;5,5,6;3,0,023;3,3,67,b;4,1,35,a;5,3,5;2,3,014,a;1,2,345;3,2,;6,0,1;0,0,4,a;4,2,45,b;0,4,;0,3,23;7,4,',[8]],
[1,1,'2,3,3;3,1,;7,2,0;7,1,24;6,2,15;4,1,134;5,3,347;4,4,567;4,5,;3,3,7;5,2,;6,1,3;4,3,06;2,2,46,b;2,0,5,a',[7]],
[1,2,'6,2,1;4,3,6;2,4,246;4,2,2;4,1,7,b;4,0,3,a;3,3,,b;3,4,456,a;4,4,6;1,1,;6,1,0;2,2,5;1,3,346;5,2,25;7,3,4;5,3,47,a',[12]],
[1,4,'7,3,45;0,3,,b;6,4,56;3,5,06,b;3,2,;2,5,,a;5,3,267;5,2,1;3,4,05;1,5,,a;4,4,6;6,5,06;3,1,12;5,4,03,a;6,1,;0,4,456;1,3,023,a',[6]],
[2,3,'0,2,4;1,3,024;4,0,;2,3,,a;2,4,,b;4,4,0;1,0,234;3,2,3;0,3,6;3,1,015;4,3,;2,2,36;1,1,13;1,4,05,a',[6,9]],
[1,2,'6,3,257;6,1,6,a;5,2,067,a;5,1,,b;4,2,2;4,0,;4,3,6;5,0,3,b;4,1,246;7,2,3;5,3,346;6,0,1;6,4,,a',[10]],
[1,4,'0,2,1,a;2,5,067;0,5,0;3,3,,a;2,0,06;0,0,2;3,5,07;0,4,,b;2,2,5,a;2,4,5;3,2,7;1,5,5,b;2,3,6;1,4,257;2,1,346;0,3,256;3,1,,a',[6]],
[1,1,'1,1,15;3,3,26;3,1,,b;1,0,6;2,2,357;0,2,;3,4,13;2,0,0,a;2,5,;4,1,2;4,0,2;2,3,567',[11]],
[1,2,'5,1,012;4,2,;2,4,45;2,1,136,b;5,3,7;3,1,0;2,0,;1,3,4,a;3,0,,a;1,2,7;3,4,2;2,3,,b;3,3,014;3,2,016;2,2,5;0,3,04,a',[0]],
[1,4,'6,2,;7,1,;3,4,56;4,1,267,b;6,4,7,a;2,0,0,a;4,3,;1,0,;3,1,347;2,2,,b;7,0,2;7,3,17;5,2,057,a;5,1,14,a',[2]],
[1,1,'4,0,057,a;3,4,46;3,1,024;2,1,6;3,0,4;2,0,;2,4,;4,4,,b;5,1,127;7,4,4;3,3,;5,2,13;1,0,14',[2]],
[2,3,'5,5,;1,4,;1,3,24,a;6,1,;3,1,134;4,3,;0,1,24,a;4,1,457;1,2,04;0,2,136,b;0,3,5;1,0,12;4,2,;3,0,',[0,11]],
[1,4,'7,5,67;4,3,,b;6,0,14;5,3,,a;4,5,457;3,4,06;5,2,1;5,0,6;7,3,02;3,2,345,a;7,4,0;7,2,267;7,0,01,b;1,4,4;3,3,5,a;4,2,,a;4,1,',[4]],
[1,1,'7,4,3;2,4,17;1,2,4;7,3,,b;3,2,014;6,5,;4,4,013;6,1,0;6,3,;5,5,45;5,2,25;5,4,046;5,3,47,a;3,5,6',[11]],
[1,2,'4,1,236;2,3,145;7,2,2,a;6,4,;1,3,12;4,5,3;2,2,01;3,4,347;1,4,;0,2,;5,5,7,a;5,2,;6,3,15,b;4,4,4,a;5,4,245,b;5,3,',[7]],
[1,4,'4,5,467;6,2,0,b;5,0,;7,5,5;1,1,1,a;6,4,1;3,2,156,a;1,2,2,b;0,2,4,a;1,4,5,a;3,1,0;5,4,147;4,2,47;4,1,15',[11]],
[1,1,'2,2,0;0,3,1;2,3,347;0,1,23;0,4,4;1,3,034;6,3,;3,4,04,a;5,3,34;5,2,;6,4,;3,1,014;4,1,35;4,4,7;1,2,5,b',[11]],
[1,2,'1,0,;5,2,2;7,2,12;2,1,;6,0,026;4,1,016,b;5,0,1;4,0,;3,2,3,a;6,1,147,a;6,3,,a;6,5,16;1,1,146;7,1,2;3,1,02,b',[4]],
[2,3,'4,4,05;3,2,05;1,5,;4,2,05;1,3,;5,0,3;2,0,45;3,3,13,a;5,1,;2,1,4;2,2,136,b;4,0,0,a;6,2,17;6,5,6;3,4,',[3,13]],
[1,1,'6,2,;6,0,;5,3,06;7,2,;5,4,567;7,1,137;4,0,01,b;2,2,,a;3,2,04;0,3,4;3,3,023;5,1,04;4,1,6;4,4,;3,1,',[4]],
[1,2,'0,4,,b;0,1,236;1,2,1,a;1,5,06,a;1,1,06;0,0,;0,5,;2,4,45;2,5,06;3,4,;1,0,2;2,2,3,a;3,3,17,b;1,4,46',[8]],
[1,4,'2,2,45,a;0,1,;6,1,;1,5,5;7,2,027,b;3,1,06;4,1,06,b;1,2,234;4,2,026;4,5,5,a;5,2,;4,0,,a;3,2,0,a;3,3,03;3,0,;4,4,06',[7]],
[1,1,'1,0,147;0,1,;3,1,145,b;3,2,;2,2,;1,2,356;3,3,67;3,0,2;5,4,;0,4,;4,0,3;2,1,35;5,1,3,a;3,4,046;2,0,6',[5]],
[1,2,'1,1,347;3,4,;5,4,4,b;6,3,1;6,2,1;3,3,023;4,4,2,a;4,5,35;3,2,347,b;1,0,,a;0,3,6;0,1,56;4,1,1;0,0,4,a',[0]],
[1,4,'0,3,,b;7,5,,a;1,3,0;5,4,6;1,2,4,a;5,3,456;1,4,,a;1,1,2;2,5,45;4,3,016,a;4,5,4,b;6,4,036;3,2,047;2,1,0;6,2,15;4,4,067;6,3,0',[11]],
[2,3,'7,5,7;1,1,0,b;4,0,,a;2,3,047;3,3,46;6,4,137;3,2,7;2,1,;3,0,;5,3,3;0,3,6;0,1,;1,2,57,a;3,1,025;6,0,0',[3,14]],
[1,2,'4,4,06;4,2,017;3,0,;5,0,15;2,2,356,a;2,5,67,a;6,1,;6,2,67;2,4,,b;2,0,,a;2,1,,b;5,1,127;4,0,04;3,4,1;5,2,1',[7]],
[1,4,'7,4,;7,2,4;6,4,014,b;5,4,12;6,2,012;4,4,4;4,2,,a;5,2,1;4,3,036,b;5,5,,a;3,3,56;5,3,24,a;6,3,5;7,3,0;3,2,,a',[4]],
[1,1,'6,1,0;3,1,345;4,3,5,a;6,0,6;5,1,;5,3,026,b;5,2,0;4,0,47;1,0,5;2,0,036;5,5,5;5,4,2',[9]],
[1,2,'7,3,,b;5,4,57;7,1,01,b;7,2,016,a;4,4,2;3,2,6;6,3,5;4,1,4;5,0,23;5,2,017;5,1,3;6,1,6,a;4,5,;7,0,7,a',[8]],
[1,4,'4,4,057;5,0,023,a;2,0,12;1,2,;4,1,4;6,1,,b;1,1,245,a;7,4,;5,2,7,b;7,1,26;7,2,6,a;5,3,036;3,3,;3,1,;2,2,67;3,4,,a;6,4,046',[0]],
[1,1,'1,2,5;6,3,567;4,1,2;5,4,025;2,1,345;7,2,46,a;3,0,0;2,0,;5,5,;7,1,,b;7,0,;6,0,237',[0]],
[2,3,'3,4,;3,1,13;3,3,056;4,2,15;5,3,056,b;2,3,;6,1,;5,0,;6,2,36,a;0,0,67;4,3,,a;3,5,6;1,1,37',[11,12]],
[1,4,'5,1,,a;7,2,2;7,0,,b;6,0,234;6,5,3,a;5,2,,a;5,3,2;5,4,057;5,0,034;6,2,17,b;6,3,257,a;7,4,;4,0,;7,1,1',[8]],
[1,1,'4,2,0;5,3,146;4,1,;6,5,;4,4,025;4,5,04;7,2,;4,3,46;6,2,24;3,2,;3,5,6;5,1,03,b;5,4,047;6,3,7,a;1,4,5',[12]],
[1,2,'6,0,0,b;6,2,146;4,2,345;6,1,,a;7,4,0;5,0,2,a;5,5,;7,5,6;5,2,6;7,2,16,a;6,3,37;7,1,6,b;7,3,125;5,4,35',[2]],
[1,4,'3,2,37;4,3,056;1,3,2;4,5,456;6,5,,a;6,1,7,b;6,3,;5,0,27,a;4,0,;5,4,456;2,1,0,a;5,1,0,b;4,1,014;1,4,;7,2,126,a',[3]],
[1,1,'6,4,36;4,2,6;1,1,,a;3,5,0;3,3,047,b;2,4,1;1,5,5;1,4,67;2,3,1;5,5,07;5,3,367;6,1,',[9]],
[1,2,'2,0,02;2,5,05;2,1,12;1,4,6;2,3,25;0,2,;3,2,26,b;0,0,;0,3,2,b;3,4,45,a;3,3,1,a;2,4,23,a;1,3,27;3,1,1',[0]],
[2,3,'5,5,;5,2,12;6,3,6;7,4,;5,1,,a;4,3,34,b;2,4,45;6,0,1;3,5,4;6,2,,a;4,4,145;5,0,35;4,2,245',[6,11]],
[1,1,'3,3,4;4,2,267,b;5,3,046;3,1,014,a;4,5,57;6,2,17;5,0,;0,4,3;3,0,;4,4,2;4,0,024;2,1,7;6,3,',[5]],
[1,2,'7,2,1;3,5,5,a;4,2,17,b;4,3,3,a;6,1,123;6,0,0;4,4,056,a;4,0,04;1,0,;5,0,1;5,3,3;6,4,07;6,2,167;4,5,6,b;3,1,;3,4,25',[4]],
[1,4,'2,5,;2,4,016;1,1,2,b;3,3,237,b;4,3,07;1,5,;3,4,013,a;4,5,;1,4,,a;7,1,;5,4,7;4,4,15,a;2,2,1,a;2,1,',[10]],
[1,1,'2,3,013;4,3,1;3,3,5;2,5,;0,1,0;6,4,;0,3,6,a;0,4,;4,5,056,b;4,4,367;1,4,02;6,3,025;7,2,',[0]],
[1,2,'1,1,017;1,0,3;7,0,,a;0,3,,b;0,4,356;3,5,5;4,3,35;1,5,014,a;6,5,;0,5,;1,4,026;0,0,04;0,2,25,a;0,1,;3,1,;6,2,14,b',[10]],
[1,4,'3,2,0,b;6,3,24;6,4,17;5,2,4;6,2,6,b;6,5,67,a;2,2,0,a;6,0,23;2,0,7;7,1,0,a;3,0,347;4,5,;4,2,047,a;7,3,1;5,5,046',[10]],
[2,3,'4,4,07;5,4,036;3,4,7;0,1,;3,3,0,a;6,5,5;4,3,,a;4,2,2;5,1,124;3,1,16;5,3,05;6,2,57;7,4,6;3,2,46;0,3,,b;2,2,2',[13,1]],
[1,2,'4,1,036;1,2,14;4,3,05;2,4,;5,0,4;7,0,02;2,1,457;5,1,,a;1,0,3;3,3,15,a;7,2,6,b;0,3,5;3,0,27;7,1,0,b;5,2,4;3,2,237,a',[1]],
[1,4,'1,1,06;5,1,4,a;2,0,3,a;0,3,6;2,1,36,b;1,4,5;0,1,4;2,5,067;4,1,06,a;1,5,;1,2,4;4,2,5,b;4,3,,a;2,3,037',[7]],
[1,1,'5,3,4;3,2,3;4,3,;4,5,046;5,5,;6,3,7;7,3,0;5,2,;6,4,367,b;6,1,2;3,5,,a;4,2,015;4,4,45;7,5,046',[3]],
[1,2,'0,1,6;6,5,06;3,3,6,b;3,0,134,b;0,0,6;3,2,0,a;6,3,07;1,0,01,a;2,1,07;1,2,0,a;4,1,;0,2,246;1,1,6',[1]],
[1,4,'6,1,017;3,1,034,a;3,3,;1,5,,a;3,5,67;5,5,13;1,4,2,a;7,2,;5,0,;6,5,7;3,4,024,b;5,3,1;1,1,;5,1,;4,2,134;3,2,17,b;6,4,12,a',[0]],
[1,1,'3,3,;2,3,,a;1,1,03;4,4,016;0,4,;4,0,3,b;3,2,01;0,1,;7,3,36;5,4,02;3,5,;2,4,0;1,4,04;2,2,357;4,3,03',[6]],
[2,3,'3,1,137;2,4,;2,5,6;3,5,46;0,3,;3,2,4;2,3,45;0,1,126;6,5,2;3,4,167;1,1,02;1,4,,a;4,2,2;5,3,,a;1,3,,b',[3,10]],
[1,4,'4,2,037;0,2,;5,0,;3,1,6,a;3,0,4;3,2,013;7,3,16,b;5,4,,a;6,4,2,b;7,4,15,a;7,1,045;4,1,234;6,5,;7,2,5;5,1,3;5,3,6,a',[11]],
[1,1,'1,1,34;5,1,047;5,3,3;1,2,35,a;2,3,,b;3,0,;1,3,6;2,1,3;4,0,;6,4,;3,3,045;5,4,13',[0]],
[1,2,'2,0,1;3,2,3;1,4,6,a;2,2,16,a;1,2,346;3,4,46;3,3,;1,5,03;5,3,;4,4,17,b;4,3,4,a;2,5,067;0,5,5,b;5,4,0',[11]],
[1,4,'2,4,04;4,1,3,a;2,2,;7,4,5;6,4,5;5,3,;5,5,37,a;7,3,26;0,4,16;7,5,06,b;6,1,;7,0,1,a;6,5,067,a;5,4,0;3,5,456;3,2,35,b',[14]],
[1,1,'5,0,123;0,0,07;7,3,2;4,2,,a;4,0,134;6,1,;2,0,0;5,2,035,b;2,4,25;2,3,267;6,3,;3,1,',[4]],
[1,2,'7,3,,a;7,0,24,a;6,1,;7,2,2;1,1,2;2,0,17;5,3,46;4,0,4,b;5,1,37;6,3,6;5,2,5;6,0,,b;7,1,26,a;4,2,357',[13]],
[2,3,'1,2,;2,1,5;5,4,045,a;4,3,04;4,1,;3,3,6;7,3,;0,4,16,a;0,3,17;7,4,;3,4,7;2,4,046;6,3,7,b',[11,3]],
[1,1,'2,4,3;2,1,2;6,1,5;3,4,01;4,2,1;3,1,04;4,4,0;3,2,3;7,0,26;1,1,34;3,3,346,b;7,2,;4,3,16,a',[9]],
[1,2,'7,3,26;2,1,35;3,1,,a;2,4,3;4,2,137,b;0,3,;6,1,5,a;3,3,02;6,4,045;3,5,;3,4,;3,2,23,a;6,2,067;3,0,,b;5,1,04',[12]],
[1,4,'2,3,,b;5,4,;7,5,0;0,2,23;4,4,,b;0,3,1,a;2,0,;3,5,5,a;0,5,014;1,4,015;5,3,013,a;1,1,125;3,4,04;2,5,256,a;2,4,;6,5,0',[11]],
[1,1,'6,5,6;4,4,0;6,4,367;6,0,0;5,3,;6,2,146;7,2,247;2,4,27;7,5,;2,5,02;0,2,56;1,5,,b;2,0,,a',[0]],
[1,2,'2,5,0,a;3,2,;5,0,0;2,3,135;6,1,14;5,1,4,a;4,3,5;4,5,056;4,1,567;0,5,3,b;1,5,;4,2,56;4,0,24,a;5,2,,b',[3]],
[1,4,'1,3,4;7,3,,a;1,2,25,a;5,4,;1,4,5;3,1,;3,3,057;2,1,36,b;2,0,35,a;6,4,5,a;2,3,67;1,5,56,b;6,0,;4,5,46;4,2,15;5,5,45;3,4,367',[16]],
[2,3,'7,4,0;3,1,01,a;7,5,6;6,2,01;6,5,46,a;2,3,25;3,5,4;1,5,;5,4,4,b;2,2,56;5,5,467;3,2,26;2,0,;0,1,1',[5,7]],
[1,2,'7,5,4,a;3,4,3;6,1,057;1,5,5,b;5,3,037;4,3,125;4,5,0,a;3,1,03;3,5,,b;4,2,01;2,2,,a;4,4,17;1,1,',[4]],
[1,4,'4,2,7,a;3,0,235;5,3,156;3,3,15;6,5,,a;7,1,1,b;6,2,0,a;4,4,3;6,3,036;5,1,4;5,4,6,b;5,5,;6,0,,a;7,4,01',[1]],
[1,1,'4,3,137;4,1,0;5,1,03;1,0,3;6,1,01;7,4,;3,5,;6,4,,a;5,4,,b;4,4,146;1,1,;5,2,236;6,0,26;5,3,14',[12]],
[1,2,'4,0,;3,1,037;3,4,167,a;2,4,24,b;2,0,0;2,3,14,a;1,3,2;3,5,;5,4,3;5,3,4;1,1,2;1,4,,b;3,0,124;2,1,02,a;2,5,45;3,3,5',[12]],
[1,4,'2,0,1;5,3,17,a;2,5,024,b;1,4,36;1,5,;1,2,;1,1,04,a;2,4,,a;3,3,5,a;5,0,01;2,3,014,b;0,3,24;3,5,267;0,1,2;0,4,',[9]],
[1,1,'1,3,357;3,1,24,b;7,5,;2,4,0;4,5,5;3,2,,a;6,5,4;2,2,57;3,4,36;4,3,013;7,2,3;5,1,',[9]],
[2,3,'6,5,;6,2,4;5,4,0;5,3,35;3,1,;6,1,7,a;4,5,45;2,1,46;5,2,05,b;2,2,26;4,3,457;0,2,4;2,4,7;7,2,,a',[8,6]],
[1,4,'3,2,05,a;2,4,,b;7,2,6,a;5,0,0;4,5,56;1,2,24,a;3,3,3;0,4,3,b;4,3,037;3,1,12;4,4,1;2,2,1;2,1,24;2,3,37;1,5,45,a',[12]],
[1,1,'4,4,;0,3,;3,4,26;1,5,4;0,5,034;5,4,6,a;5,1,12;3,1,;1,4,167;4,5,;3,5,456;5,5,036;2,2,;1,3,45;4,3,0,b',[8]],
[1,2,'7,2,0;1,2,01,a;5,4,;5,5,16;1,1,34;1,4,,b;1,5,6;0,2,7;0,4,5,b;0,3,4;2,2,013;4,1,2;4,2,014;1,3,04,a;2,3,,a',[4]],
[1,4,'1,0,4;2,4,56;3,3,124,b;4,1,0,a;6,3,0;0,1,1;4,3,45;5,2,07,a;2,1,012;4,4,256;2,2,,a;3,4,04,a;3,0,123,b;4,2,;7,1,',[0]],
[1,1,'0,3,12;5,5,;1,1,67,b;2,2,27;0,1,3;1,2,;3,3,167;2,5,4,a;3,2,13;1,5,47;0,0,3;2,3,07',[6]],
[1,2,'3,1,015;3,2,,b;3,3,6;0,3,;2,1,47;6,1,;6,5,;5,1,34,a;1,3,0,b;4,2,4,a;6,2,023,a;5,3,067;4,0,37;1,0,',[11]],
[2,3,'0,0,;2,4,,a;6,2,14;1,1,7;3,3,014,a;6,5,0;4,4,4,b;7,2,;5,0,24;7,0,;6,1,5;6,3,7;4,2,14;5,1,134;7,4,01;5,4,',[3,8]],
[1,1,'5,2,267;7,0,0;6,0,2;1,2,;0,3,5;1,4,7;3,2,47;4,0,014;2,1,0,a;6,3,0;5,4,3;3,0,24;4,3,;1,3,26,b',[7]],
[1,2,'2,3,56;1,4,4;4,4,7;0,2,,a;3,2,25,a;3,1,,b;6,0,,a;2,0,134;3,0,15;0,3,3;5,0,47;3,5,7;1,1,7,b',[0]],
[1,4,'6,3,;1,2,6,a;5,4,25,b;1,0,24;4,4,047,a;3,5,456;2,3,235;3,2,17,b;0,4,7;5,5,;2,2,17,a;4,5,6,a;3,4,6;1,5,;4,3,4;1,4,26',[5]],
[1,1,'3,4,36;2,3,12;0,5,6;0,0,;4,5,456;4,2,26,a;4,3,5,b;1,2,;1,5,246;1,3,46;4,4,06;0,2,6;2,5,56;7,2,',[8]],
[1,2,'5,0,3,a;3,2,46,b;7,5,;7,2,6;5,5,06;6,5,047;4,2,4,a;2,3,056;3,5,,a;7,0,1;6,1,7;5,3,01;3,0,4,b',[5]],
[1,4,'7,4,,b;0,3,5;6,4,;1,1,;3,2,13;5,2,357;3,1,37;4,3,0,a;2,0,12;7,0,7,a;1,0,234;2,1,25,b;3,0,012;3,3,,a;1,4,7;2,3,12,a',[5]],
[2,3,'1,0,4;7,4,7;6,5,056;5,5,3;3,2,01;7,3,2;3,4,;3,5,,a;4,0,0,a;5,1,036;4,1,126;1,2,6;5,0,;4,4,013,b',[2,9]],
[1,2,'5,2,5;2,2,,b;4,5,,a;4,3,026;5,3,6;3,1,13;4,1,014,b;5,1,15;3,0,26;6,0,;4,0,024;4,4,5;5,0,,a;2,3,3,a',[3]],
[1,4,'3,4,23;5,4,;3,1,;4,5,567,b;7,3,7,a;5,5,067;3,5,6;5,3,4;7,5,46;6,2,0,a;6,4,3,a;3,3,7;4,2,67;7,4,6;6,5,056;6,3,01,b;5,2,,a',[14]],
[1,1,'3,3,;0,2,;5,0,2;7,5,6;2,0,047;7,2,3;4,4,1;5,4,01;5,3,23;4,3,05,b;4,5,36;3,4,14,a;0,0,2;4,2,125',[4]],
[1,2,'1,1,0;0,1,5,a;5,4,06;3,2,134,a;1,3,567;2,2,056;0,2,,a;4,4,7;1,0,14;3,0,123;4,1,2,b;2,1,,b;1,4,;6,2,',[4]],
[1,4,'7,5,067;4,2,26;4,3,7,a;3,5,,a;5,4,04;1,0,4,a;7,3,027,b;0,2,;5,5,4;5,3,;4,5,456;2,0,1,b;3,2,0;6,2,017,a;4,0,02',[10]],
[1,1,'4,4,5,a;5,5,7;4,5,046;0,1,06;0,3,2;3,2,3;1,2,47;3,4,37;6,5,;2,5,07;1,5,,b;0,5,45',[7]],
[2,3,'3,5,;0,4,2;2,1,23;7,0,,a;2,5,4;4,4,,b;3,2,2;4,0,45;0,0,,a;2,4,026;3,4,56;1,1,247;2,3,37;4,3,256;1,2,;2,2,7',[9,11]],
[1,4,'1,3,356;5,3,67,a;6,2,16;4,3,026;5,2,;7,2,;4,4,,a;2,1,4,a;1,2,2;6,1,57;4,0,24;7,0,0;3,1,,b;4,2,4,a;7,1,127,b;1,0,23;6,0,23',[3]],
[1,1,'5,1,125;0,2,1;5,0,05;3,0,1;2,0,137;5,3,7,a;2,3,4,b;0,3,4;7,0,;2,4,6;6,0,034;2,5,;5,2,1',[0]],
[1,2,'2,3,035;0,4,1,b;2,2,07,a;4,2,0,a;1,3,25;4,1,4,b;3,4,056;5,2,;1,1,7,a;7,1,;1,5,5;0,0,;3,1,367;1,2,467',[0]],
[1,4,'4,2,47;6,2,0,a;3,0,36;7,3,;7,0,07,b;5,3,4;5,0,07;7,2,067,a;6,3,5,b;2,0,4;4,5,5;6,5,06;6,1,0;5,2,,a;6,4,067;4,1,,a',[11]],
[1,1,'2,2,57;1,3,1;3,1,4;0,1,;2,1,13;4,0,01;1,4,2;3,0,134;3,2,45;6,2,;0,0,34;0,3,346,b;4,1,0;1,0,6,a;0,4,',[7]],
[1,2,'4,2,7;4,5,3,b;5,4,16;2,1,23;6,0,12;5,3,,a;4,3,67,a;2,2,25,a;3,1,01;6,3,13,b;4,0,2;7,4,;5,1,01',[4]],
[2,3,'5,3,156;7,3,6;2,2,;4,2,;5,1,134,b;2,4,567;4,1,3,a;3,3,6;7,1,6;0,3,236;3,2,5;7,0,2;3,5,;1,3,0;7,2,06;0,2,,a',[5,0]],
[1,1,'6,1,45;7,4,,a;5,4,026;5,0,6;6,2,1;6,4,46;2,4,1,b;7,0,02;1,5,;7,1,1;5,2,5;5,5,1;2,0,6;4,4,06;4,2,357',[2]],
[1,2,'5,2,;4,4,15,a;4,3,234,b;6,3,;2,4,056;2,1,34,a;5,1,;6,4,;5,4,47;4,2,245;7,1,26,a;0,4,,b;3,5,',[4]],
[1,4,'1,2,47;3,4,467,a;4,4,456;3,1,024;5,4,;0,2,46;5,2,6;2,4,467;2,2,6,b;4,3,56,b;3,3,4,a;4,1,;3,0,3,a;4,0,01,a;0,1,',[7]],
[1,1,'5,5,,b;3,1,1;2,5,6;5,3,24,a;1,1,6;3,3,246;3,5,;1,2,146;2,3,24;4,2,127;0,3,;4,5,4;1,3,34',[7]],
[1,2,'5,3,36;2,3,124;4,1,4;7,3,7;7,5,,a;6,1,05,b;2,1,;0,5,,a;3,5,;2,4,345;5,0,13,a;4,2,134,b;5,1,3;5,4,7;7,2,3',[1]],
[1,4,'5,2,15;6,4,5,a;7,0,;0,0,0;2,5,;3,1,1,a;3,5,456;5,5,3;6,2,05,a;5,3,356,b;3,3,057;4,2,7,b;7,1,,a;7,3,6;2,3,',[6]],
[2,3,'5,1,;7,1,0;6,0,13;5,5,4;3,0,134;6,1,5;1,3,6;3,1,014;0,1,;5,2,2;6,5,,b;1,1,035,a;0,3,46;4,2,0;3,2,;2,2,4,a',[7,4]],
[1,2,'0,3,;3,0,15;6,5,6;4,1,367,a;5,3,,a;4,4,3;3,3,356;6,0,;4,0,,b;6,2,7;3,2,5;5,2,2,b;4,3,237;5,5,46;2,1,134,a',[6]],
[1,4,'3,2,;6,3,13;2,3,06;7,2,2,b;6,5,3,a;1,3,4;1,1,;5,1,234;7,1,,a;4,5,5;3,3,04;6,2,023,a;7,3,01,a;6,1,34;5,3,02;5,5,0,b;2,2,7',[7]],
[1,1,'6,5,05,b;3,1,;4,3,247;3,4,;2,3,1;4,5,;1,4,12;1,5,;1,3,245;2,5,456;6,3,6;2,4,467;2,1,3;3,5,4;7,4,03,a',[9]],
[1,2,'2,4,6,b;6,4,067;3,5,06;2,1,0,a;2,2,,a;4,2,04;5,5,05;6,3,2;4,3,47;3,3,04,a;5,4,;1,3,,b;2,5,056',[6]],
[1,4,'4,0,14,a;3,2,13;6,5,,b;6,1,125;7,5,46,a;0,4,4;7,3,027;7,0,04;1,4,04;2,2,014;6,4,5,a;3,4,267;7,4,,a;0,2,;2,4,,b;5,3,',[3]],
[1,1,'5,1,3;2,0,3;6,2,4;5,3,,a;4,1,4;7,2,4,b;5,2,56;6,1,36;3,3,04;3,1,047;1,3,24;1,1,;3,2,46;4,2,14',[12]],
[2,3,'1,4,,a;3,3,6,a;5,0,;1,2,;3,2,;2,3,07;4,1,135;2,4,067;6,3,4;4,3,0,b;0,2,;6,1,012;0,3,0',[7,11]],
[1,4,'1,4,037,b;2,1,06;0,3,05;1,3,0,a;6,2,0;2,0,,a;3,5,;2,4,05,b;4,2,4;0,4,45;2,2,,a;4,4,07;0,1,;2,5,146,a',[11]],
[1,1,'3,1,014;0,5,;5,1,05,a;5,3,067;1,1,,b;2,1,037;6,0,4;3,2,1;2,0,0;0,1,7;2,2,;3,3,7',[3]],
[1,2,'6,2,247;2,3,0;4,0,1;6,4,014,a;5,4,04,b;4,4,34;3,1,;4,3,0,a;5,3,02;7,1,;6,0,23;5,5,,a;7,4,7;7,2,27;5,2,02,b',[10]],
[1,4,'0,3,;4,4,;4,1,345;3,2,3,b;0,5,3;2,3,4,a;2,1,02,a;2,5,57;0,2,45;1,5,056;1,4,357;2,4,467;7,4,,a;5,4,047,b;6,3,;1,1,,a',[9]],
[1,1,'1,2,,a;4,1,;4,2,26;4,3,0;0,2,;3,2,024;4,5,1;5,4,017;0,5,4;1,4,15;3,5,0;2,4,01;2,3,17,b;1,5,16',[7]],
[1,2,'7,2,;2,5,,a;4,1,15;5,1,5;4,3,36,b;4,0,67,a;5,2,346;0,3,6;3,2,134;1,4,27;5,0,0;6,0,;4,5,,a;6,3,1;1,5,14,b',[2]],
[2,3,'4,3,;4,0,,a;4,2,026;5,1,4,b;3,3,2;2,2,345;0,3,23;0,2,,a;1,3,7;2,1,1;3,4,4;4,1,047;7,1,',[5,8]],
[1,1,'5,5,5;5,4,45;2,4,4;0,5,5;0,4,6;6,5,3;6,4,124;2,1,6;0,1,;5,2,0,b;1,3,12;2,3,6;7,2,025;7,4,27,a;1,5,05',[10]],
[1,2,'1,0,;5,4,04,a;0,2,46,b;2,0,013;2,2,2;0,1,37,a;4,4,236,b;6,4,5;3,4,;4,2,4;5,5,,a;2,4,4;6,3,1;5,3,4;4,5,5',[3]],
[1,4,'3,2,,a;2,4,6,a;1,3,4;5,3,5;6,1,126,b;4,3,047;3,3,05,b;2,1,2,a;6,0,025,a;2,2,;3,1,4;5,0,;6,2,01;4,0,234',[10]],
[1,1,'1,2,;3,3,127;0,4,4;1,0,2;2,2,17;7,0,02;5,2,;7,3,026;7,4,3,a;5,0,;4,3,057,b;4,0,24;3,4,;0,0,1',[11]],
[1,2,'1,3,0,a;2,3,026,a;6,3,047,b;5,2,07,a;0,0,;2,4,;4,1,7;3,2,27,b;2,0,;4,5,567;3,3,47;0,3,5;4,3,',[9]],
[1,4,'5,2,27;0,1,5,a;3,2,2,b;4,1,01,a;4,5,;2,2,4;0,3,012;3,3,,a;4,3,,b;2,3,345;4,2,7;3,1,03,a;1,3,045;5,3,16;0,4,',[12]],
[2,3,'5,4,67;0,1,6;4,3,15;3,4,,a;3,3,3,a;6,1,234;7,1,6;3,2,025;4,4,;0,2,6;7,2,;5,0,146,b;7,3,0;5,1,13',[0,7]],
[1,2,'0,2,;4,2,36;3,3,15,a;2,0,234;5,0,1;3,5,057;5,1,,a;7,0,;2,2,23;1,5,;4,0,;6,2,7;5,3,057,b;2,3,,b;4,3,035,a',[5]],
[1,4,'6,2,017;4,3,1,a;0,3,034,a;1,3,,a;6,4,056;3,0,;4,2,4;2,3,4,a;5,1,67;4,0,02,b;4,4,6;5,0,13;7,3,;1,4,57,b;3,2,6;3,4,05',[4]],
[1,1,'3,5,7;2,3,1;1,1,;1,3,4;5,2,015;2,5,06;3,4,1;5,3,16,a;1,4,0,b;0,4,3;3,1,013;2,2,2',[10]],
[1,2,'5,1,017,b;5,4,,a;5,3,024;4,1,15;5,5,7,b;2,3,;4,2,1;3,3,0,a;4,0,;7,4,,a;3,4,;2,2,;4,4,047;7,3,127',[2]],
[1,4,'0,2,3,a;5,0,;3,0,;5,2,,a;2,1,06,b;3,2,236;5,5,14;4,0,124;4,1,034;6,5,,b;2,4,47;2,0,5;3,4,6;2,2,034,a;1,2,0;7,5,,a',[7]],
[1,1,'1,3,026;4,5,56;1,2,134,a;0,4,;6,1,1;7,4,26;1,4,016;7,5,;7,2,7,b;0,3,;4,4,46;6,3,',[0]],
[2,3,'2,1,4;3,0,017;3,5,2;1,3,34,b;4,3,7;3,3,5;2,0,2;0,3,3;1,2,2;3,4,057;2,2,35;1,4,57,a;3,1,,a;4,1,',[1,9]],
[1,4,'3,3,0;5,5,47;5,3,;0,3,;2,1,2,b;1,5,;6,3,56;2,2,;2,5,046;5,2,25,a;6,5,6,a;4,1,02;2,4,7;1,0,3,a;3,1,1,a;4,3,157,b;3,2,27',[11]],
[1,1,'2,1,234;1,1,36;5,4,,b;2,3,5;6,2,3;2,2,256;2,5,06;1,0,14;4,0,34;7,0,;1,5,;3,0,3;4,1,,a',[1]],
[1,2,'2,3,0,a;1,3,;3,1,;5,5,2,a;7,1,127;7,3,01,a;6,3,147;1,1,02;5,4,;2,2,257;4,1,7;5,3,2,b;3,0,;0,1,35,b;5,2,0;6,1,014',[15]],
[1,4,'6,4,03,b;3,5,57;4,3,4,a;0,2,;7,3,16;6,2,57;4,2,56,a;2,2,6;5,3,045;4,4,,a;1,3,457;6,0,;7,5,267;4,0,34,a;3,3,5,b',[1]],
[1,1,'2,4,0,b;6,0,;6,4,;4,2,06;3,5,7;7,5,6;1,3,05;3,1,;1,2,2;6,3,126;4,1,36;7,4,4,a;4,5,046;0,4,5',[9]],
[1,2,'3,0,023;1,2,67;3,5,,a;5,3,16,a;1,1,,b;4,1,013;0,0,,a;2,0,12;4,5,17;2,1,06;6,3,1,b;3,2,;5,2,023',[0]],
[2,3,'3,1,247;2,2,02;5,1,;5,3,156;4,2,,a;5,0,2;4,3,3;4,4,;4,1,24;3,3,045,b;7,1,;5,4,1,a;2,3,46;1,5,',[0,13]],
[1,1,'2,2,147;7,2,2;7,3,,b;6,4,37,a;6,0,5;2,4,;4,4,0;4,2,045;5,4,045;6,2,;1,3,05;7,5,6',[8]],
];
'use strict';
var BD = window.BD || (window.BD = {});
BD.COLS = 6;
BD.ROWS = 8;
/** Up, up-right, right, down-right, down, down-left, left, up-left. */
BD.DIRS = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];
BD.inside = function (r, c) { return r >= 0 && r < BD.ROWS && c >= 0 && c < BD.COLS; };
/** "r,c,arrows[,a][,b]" -> { r, c, arrows, armour, bomb }. */
BD.decodeSky = function (sky) {
return sky.split(';').map(function (s) {
var p = s.split(',');
return {
r: +p[0], c: +p[1],
arrows: p[2] ? p[2].split('').map(Number) : [],
armour: p.indexOf('a') > 2, bomb: p.indexOf('b') > 2,
};
});
};
BD.freshHits = function (balloons) { return balloons.map(function (b) { return b.armour ? 2 : 1; }); };
/**
* The chain started by tapping [starts] on a sky with hit counts [hits0].
* Returns { ticks: [{ darts: [[r0,c0,r1,c1]], events: [[index, 'pop'|'crack']] }], hits, cleared }.
* Tick 0 = the tapped pop (and bomb blasts); each later tick moves every
* dart one cell and lists what it hit.
*/
BD.simulate = function (balloons, starts, hits0) {
var hits = hits0.slice(), at = {}, ticks = [], darts = [];
balloons.forEach(function (b, i) { at[b.r * BD.COLS + b.c] = i; });
function pop(i, events) {
if (hits[i] === 0 && events.some(function (e) { return e[0] === i && e[1] === 'pop'; })) return;
hits[i] = 0;
events.push([i, 'pop']);
var b = balloons[i];
b.arrows.forEach(function (d) { darts.push([b.r, b.c, BD.DIRS[d][0], BD.DIRS[d][1]]); });
if (b.bomb) {
BD.DIRS.forEach(function (d) {
var r = b.r + d[0], c = b.c + d[1], j = at[r * BD.COLS + c];
if (BD.inside(r, c) && j !== undefined && hits[j] > 0) pop(j, events);
});
}
}
var first = [];
starts.forEach(function (s) { if (hits[s] > 0) pop(s, first); });
ticks.push({ darts: [], events: first });
var guard = 0;
while (darts.length && guard++ < 200) {
var moves = [], events = [], current = darts, next = [];
darts = [];
current.forEach(function (d) {
var nr = d[0] + d[2], nc = d[1] + d[3];
moves.push([d[0], d[1], nr, nc]);
if (!BD.inside(nr, nc)) return;
var j = at[nr * BD.COLS + nc];
if (j !== undefined && hits[j] > 0) {
hits[j]--;
if (hits[j] === 0) {
hits[j] = 1; // let pop() run its effects
pop(j, events);
} else {
events.push([j, 'crack']);
}
return;
}
next.push([nr, nc, d[2], d[3]]);
});
darts = darts.concat(next);
ticks.push({ darts: moves, events: events });
}
return { ticks: ticks, hits: hits, cleared: hits.every(function (h) { return h === 0; }) };
};
/** A tap that still clears the sky within [tapsLeft] taps, or -1. */
BD.bestTap = function (balloons, hits, tapsLeft) {
for (var i = 0; i < balloons.length; i++) {
if (hits[i] === 0) continue;
var a = BD.simulate(balloons, [i], hits);
if (a.cleared) return i;
if (tapsLeft >= 2) {
for (var j = 0; j < balloons.length; j++) {
if (a.hits[j] > 0 && BD.simulate(balloons, [j], a.hits).cleared) return i;
}
}
}
return -1;
};
/** Level row [taps, section, sky, solution] -> a level object. */
BD.level = function (row, number) {
return {
number: number, taps: row[0], section: BD.SECTIONS[row[1]], sectionIndex: row[1], sky: row[2], solution: row[3],
balloons: BD.decodeSky(row[2]),
};
};
/** Level index i (0-based) as played in browsers: level 1 = the ten-balloon cascade. */
BD.levelAt = function (i) { return BD.level(i === 0 ? BD.WEB_LEVEL1 : BD.LEVELS[i], i + 1); };
/** One play of a level (GameState in the Flutter game). */
BD.Game = function (level) {
this.level = level;
this.balloons = level.balloons;
this.hits = BD.freshHits(this.balloons);
this.tapsLeft = level.taps;
this.tapsUsed = 0;
this.status = 'playing';
this.attempt = 1;
this.usedBonusTap = false;
};
BD.Game.prototype = {
get remaining() { return this.hits.filter(function (h) { return h > 0; }).length; },
/** 3 stars first try, 2 after retries, 1 with a bonus tap. */
get stars() { return this.status !== 'won' ? 0 : this.usedBonusTap ? 1 : this.attempt === 1 ? 3 : 2; },
tap: function (i) {
if (this.status !== 'playing' || this.tapsLeft <= 0 || this.hits[i] === 0) return null;
var chain = BD.simulate(this.balloons, [i], this.hits);
this.hits = chain.hits;
this.tapsLeft--;
this.tapsUsed++;
if (chain.cleared) this.status = 'won';
else if (this.tapsLeft === 0) this.status = 'lost';
return chain;
},
retry: function () {
this.hits = BD.freshHits(this.balloons);
this.tapsLeft = this.level.taps;
this.tapsUsed = 0;
this.status = 'playing';
this.attempt++;
},
addBonusTap: function () {
this.tapsLeft++;
this.usedBonusTap = true;
if (this.status === 'lost') this.status = 'playing';
},
hint: function () { return BD.bestTap(this.balloons, this.hits, this.tapsLeft); },
};
'use strict';
var BD = window.BD || (window.BD = {});
BD.DAILY_UNLOCK_AFTER = 5;
BD.MILESTONES = [{ day: 3, hints: 2 }, { day: 7, hints: 3 }, { day: 30, hints: 0, badge: true }];
BD.Store = (function () {
var S = VPC.Save;
function migrate() {
if (S.get('migrated', false)) return;
var ns = 'flutter.balloon_domino.', legacy = 'flutter.';
var ownOrigin = ['playgama', 'crazygames'].indexOf(VPC.build.portal) >= 0;
var read = function (k) {
try {
var v = localStorage.getItem(ns + k);
if (v === null && ownOrigin) v = localStorage.getItem(legacy + k);
return v === null ? undefined : JSON.parse(v);
} catch (e) { return undefined; }
};
var unlocked = read('unlocked'), n = 0;
if (typeof unlocked === 'number' && unlocked > 1) { S.set('unlocked', unlocked); n++; }
for (var i = 1; i <= 400; i++) {
var st = read('stars_' + i);
if (typeof st === 'number' && st > 0) { S.set('stars_' + i, st); n++; }
}
['tutorial', 'web_goal_card', 'sound'].forEach(function (k) {
var v = read(k);
if (typeof v === 'boolean') { S.set(k === 'sound' ? 'muted' : k, k === 'sound' ? !v : v); n++; }
});
BD.SECTIONS.forEach(function (s) { if (read('intro_' + s[0]) === true) { S.set('intro_' + s[0], true); n++; } });
['last_day', 'streak', 'best', 'total', 'free_hints'].forEach(function (k) {
var v = read('daily_' + k);
if (typeof v === 'number') { S.set('daily_' + k, v); n++; }
});
S.set('migrated', true);
if (n) VPC.log('migrated', n, 'keys from the Flutter save');
}
function today() {
var d = new Date();
return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 864e5);
}
var daily = {
get today() { return today(); },
get seed() { return today(); },
get lastDay() { return S.get('daily_last_day', -999); },
get doneToday() { return daily.lastDay === today(); },
get streak() { return daily.lastDay >= today() - 1 ? S.get('daily_streak', 0) : 0; },
get best() { return S.get('daily_best', 0); },
get freeHints() { return S.get('daily_free_hints', 0); },
useFreeHint: function () {
var n = daily.freeHints;
if (n <= 0) return false;
S.set('daily_free_hints', n - 1);
return true;
},
/** Today's puzzle solved: grows the streak, gives hints. Returns the result. */
complete: function () {
if (daily.doneToday) return { streak: daily.streak, hintsAdded: 0, freeHints: daily.freeHints, milestone: null };
var t = today(), s = daily.lastDay === t - 1 ? S.get('daily_streak', 0) + 1 : 1;
var m = BD.MILESTONES.filter(function (x) { return x.day === s; })[0] || null;
var add = 1 + (m ? m.hints : 0);
S.set('daily_last_day', t);
S.set('daily_streak', s);
S.set('daily_best', Math.max(daily.best, s));
S.set('daily_total', S.get('daily_total', 0) + 1);
S.set('daily_free_hints', daily.freeHints + add);
return { streak: s, hintsAdded: add, freeHints: daily.freeHints, milestone: m };
},
nextMilestone: function () {
var s = daily.streak;
return BD.MILESTONES.filter(function (x) { return x.day > s; })[0] || null;
},
level: function () {
var row = BD.DAILY[daily.seed % BD.DAILY.length];
var lv = BD.level(row, 0);
lv.daily = true;
return lv;
},
};
var api = {
migrate: migrate,
daily: daily,
/** Highest playable level number. */
get unlocked() { return S.get('unlocked', 1); },
stars: function (n) { return S.get('stars_' + n, 0); },
recordWin: function (n, stars) {
if (stars > api.stars(n)) S.set('stars_' + n, stars);
if (n + 1 > api.unlocked) S.set('unlocked', n + 1);
},
get totalStars() {
var t = 0;
for (var i = 1; i < api.unlocked && i <= BD.LEVELS.length; i++) t += api.stars(i);
return t;
},
get tutorialDone() { return S.get('tutorial', false); },
markTutorialDone: function () { S.set('tutorial', true); },
get goalCardSeen() { return S.get('web_goal_card', false); },
markGoalCardSeen: function () { S.set('web_goal_card', true); },
/** Never won a level: goes straight into level 1. */
get brandNew() { return api.unlocked <= 1 && api.stars(1) === 0; },
introSeen: function (section) { return S.get('intro_' + section, false); },
markIntroSeen: function (section) { S.set('intro_' + section, true); },
get dailyUnlocked() { return api.unlocked > BD.DAILY_UNLOCK_AFTER; },
/** Levels in this build (demo builds stop early). */
get playable() { return VPC.build.demoLevels > 0 ? Math.min(VPC.build.demoLevels, BD.LEVELS.length) : BD.LEVELS.length; },
};
return api;
})();
'use strict';
var BD = window.BD || (window.BD = {});
BD.R = 76;
BD.COLORS = ['#FF2E7E', '#1FA8FF', '#FFC800', '#14D99A', '#FF7A1A', '#9B4DFF'];
BD.INK = '#4A1738';
BD.BOMB = '#3A2D4F';
BD.BW = Math.ceil(BD.R * 2.4);
BD.BH = Math.ceil(BD.R * 3.4);
BD.BCX = BD.BW / 2;
BD.BCY = Math.round(BD.R * 1.28);
BD.art = (function () {
var R = BD.R;
function mix(hex, to, t) {
var a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
var ch = function (s) { return Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t); };
return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
}
function balloon(c, color, bomb) {
var cx = BD.BCX, cy = BD.BCY, base = bomb ? BD.BOMB : color, dark = mix(base, '#000000', 0.16);
c.strokeStyle = 'rgba(74,23,56,0.4)';
c.lineWidth = 3;
c.beginPath();
c.moveTo(cx, cy + R * 1.12);
c.quadraticCurveTo(cx + R * 0.25, cy + R * 1.6, cx, cy + R * 2.0);
c.stroke();
c.save();
c.translate(cx, cy);
c.scale(1, 1.12);
var g = c.createRadialGradient(-R * 0.35, -R * 0.45, 0, -R * 0.35, -R * 0.45, R * 1.75);
g.addColorStop(0, bomb ? '#7A6A92' : '#ffffff');
g.addColorStop(0.17, base);
g.addColorStop(1, dark);
c.fillStyle = g;
c.beginPath();
c.arc(0, 0, R, 0, Math.PI * 2);
c.fill();
c.restore();
c.fillStyle = dark;
c.beginPath();
c.moveTo(cx - R * 0.13, cy + R * 1.12);
c.lineTo(cx + R * 0.13, cy + R * 1.12);
c.lineTo(cx, cy + R * 1.27);
c.closePath();
c.fill();
c.fillStyle = 'rgba(255,255,255,0.35)';
c.beginPath();
c.ellipse(cx - R * 0.42, cy - R * 0.5, R * 0.16, R * 0.28, 0.6, 0, Math.PI * 2);
c.fill();
}
function star(c, cx, cy, r, color) {
c.fillStyle = color;
c.beginPath();
for (var k = 0; k < 10; k++) {
var a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
}
c.closePath();
c.fill();
}
var AW = Math.ceil(R * 0.95), AH = Math.ceil(R * 0.56);
function arrow(c) {
var y = AH / 2, from = R * 0.12, tip = R * 0.86, base = tip - R * 0.3, half = R * 0.2;
c.lineCap = 'round';
c.lineJoin = 'round';
c.strokeStyle = 'rgba(58,18,48,0.55)';
c.lineWidth = R * 0.11 + 7;
c.beginPath(); c.moveTo(from, y); c.lineTo(base, y); c.stroke();
c.strokeStyle = '#ffffff';
c.lineWidth = R * 0.11;
c.beginPath(); c.moveTo(from, y); c.lineTo(base, y); c.stroke();
c.beginPath();
c.moveTo(tip, y);
c.lineTo(base, y - half);
c.lineTo(base, y + half);
c.closePath();
c.fillStyle = '#ffffff';
c.fill();
c.strokeStyle = 'rgba(58,18,48,0.55)';
c.lineWidth = R * 0.045;
c.stroke();
}
function ring(c, w, h, intact) {
c.save();
c.translate(w / 2, h / 2);
c.scale(1, 1.12);
var rr = R + R * 0.12;
if (intact) {
c.strokeStyle = '#C9D3E0';
c.lineWidth = R * 0.15;
c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.stroke();
c.strokeStyle = '#8E9BB0';
c.lineWidth = R * 0.05;
c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.stroke();
} else {
c.strokeStyle = '#8E9BB0';
c.lineWidth = R * 0.1;
for (var k = 0; k < 8; k++) { c.beginPath(); c.arc(0, 0, rr, k * Math.PI / 4, k * Math.PI / 4 + Math.PI / 7); c.stroke(); }
}
c.restore();
}
var CELL = R * 2.5, DW = Math.ceil(CELL * 0.44), DH = Math.ceil(CELL * 0.16);
function dart(c) {
var ox = CELL * 0.27, y = DH / 2;
c.fillStyle = BD.INK;
c.fillRect(ox - CELL * 0.22, y - CELL * 0.02, CELL * 0.3, CELL * 0.04);
c.beginPath();
c.moveTo(ox + CELL * 0.14, y);
c.lineTo(ox + CELL * 0.04, y - CELL * 0.067);
c.lineTo(ox + CELL * 0.04, y + CELL * 0.067);
c.closePath();
c.fill();
c.fillStyle = '#FF4F87';
c.fillRect(ox - CELL * 0.24, y - CELL * 0.053, CELL * 0.08, CELL * 0.106);
}
function cloud(c) {
c.fillStyle = 'rgba(255,255,255,0.78)';
[[60, 70, 44], [108, 54, 52], [160, 70, 40], [110, 86, 40]].forEach(function (p) {
c.beginPath(); c.arc(p[0], p[1], p[2], 0, Math.PI * 2); c.fill();
});
}
return {
AW: AW, AH: AH, DW: DW, DH: DH, CELL: CELL,
/** Boot: all textures. */
textures: function (scene) {
var T = VPC.Juice.canvasTexture;
BD.COLORS.forEach(function (col, k) { T(scene, 'bd-balloon-' + k, BD.BW, BD.BH, function (c) { balloon(c, col, false); }); });
T(scene, 'bd-balloon-bomb', BD.BW, BD.BH, function (c) { balloon(c, BD.BOMB, true); star(c, BD.BCX, BD.BCY, R * 0.45, '#FFC23D'); });
T(scene, 'bd-arrow', AW, AH, arrow);
var rw = Math.ceil(R * 2.6), rh = Math.ceil(R * 2.9);
T(scene, 'bd-ring2', rw, rh, function (c, w, h) { ring(c, w, h, true); });
T(scene, 'bd-ring1', rw, rh, function (c, w, h) { ring(c, w, h, false); });
T(scene, 'bd-hub', 24, 24, function (c) { c.fillStyle = '#fff'; c.beginPath(); c.arc(12, 12, 10, 0, Math.PI * 2); c.fill(); });
T(scene, 'bd-hint', Math.ceil(R * 3.4), Math.ceil(R * 3.4), function (c, w) {
c.strokeStyle = '#FFC23D'; c.lineWidth = R * 0.12; c.beginPath(); c.arc(w / 2, w / 2, R * 1.6, 0, Math.PI * 2); c.stroke();
});
T(scene, 'bd-dart', DW, DH, dart);
T(scene, 'bd-cloud', 220, 140, cloud);
T(scene, 'bd-star', 128, 128, function (c) { star(c, 64, 66, 60, '#ffffff'); });
BD.art.skyStrip(scene);
},
/** The sky gradient: a thin strip, stretched to the sky box (rounded by a mask). */
skyStrip: function (scene) {
VPC.Juice.canvasTexture(scene, 'bd-sky', 4, 256, function (c, w, h) {
var g = c.createLinearGradient(0, 0, 0, h);
g.addColorStop(0, '#8FD3FF');
g.addColorStop(1, '#FFE3C9');
c.fillStyle = g;
c.fillRect(0, 0, w, h);
});
},
balloonKey: function (b, i) { return b.bomb ? 'bd-balloon-bomb' : 'bd-balloon-' + (i % BD.COLORS.length); },
colorOf: function (b, i) { return b.bomb ? 0xFFC23D : parseInt(BD.COLORS[i % BD.COLORS.length].slice(1), 16); },
};
})();
'use strict';
var BD = window.BD || (window.BD = {});
/** Page gradient + balloons drifting up behind everything. */
BD.backdrop = function (scene) {
var g = scene.add.graphics().setDepth(-10);
var drift = [];
for (var k = 0; k < 9; k++) {
var img = scene.add.image(0, 0, 'bd-balloon-' + (k % BD.COLORS.length)).setDepth(-9).setAlpha(0.22);
drift.push({ img: img, x: (k * 0.137 + 0.05) % 1, y: (k * 0.31) % 1, sp: 0.018 + (k % 4) * 0.006, sc: 0.32 + (k % 3) * 0.1 });
}
var view = VPC.view(scene);
function layout(v) {
view = v;
g.clear();
g.fillGradientStyle(0xFFF1E2, 0xFFF1E2, 0xFFD3CF, 0xFFC7D9, 1);
g.fillRect(0, 0, v.w, v.h);
}
var tick = function (t, dt) {
drift.forEach(function (d) {
d.y -= d.sp * dt / 1000;
if (d.y < -0.25) d.y += 1.5;
d.img.setScale(d.sc * view.s * Math.min(1, view.cssH / 700) * 0.9 * 100 / BD.R);
d.img.setPosition(d.x * view.w + Math.sin(t / 1400 + d.x * 9) * 12 * view.s, d.y * view.h);
});
};
scene.events.on('update', tick);
scene.events.once('shutdown', function () { scene.events.off('update', tick); });
return { layout: layout };
};
/** A bobbing hero balloon with arrows (title art). */
BD.heroBalloon = function (scene, color, arrows) {
var c = scene.add.container(0, 0);
var body = scene.add.image(0, 0, 'bd-balloon-' + color).setOrigin(BD.BCX / BD.BW, BD.BCY / BD.BH);
c.add(body);
arrows.forEach(function (d) {
c.add(scene.add.image(0, 0, 'bd-arrow').setOrigin(0, 0.5).setRotation(Math.atan2(BD.DIRS[d][0], BD.DIRS[d][1])));
});
if (arrows.length) c.add(scene.add.image(0, 0, 'bd-hub').setScale(BD.R * 0.2 / 20));
return c;
};
BD.Home = new Phaser.Class({
Extends: Phaser.Scene,
initialize: function Home() { Phaser.Scene.call(this, { key: 'Home' }); },
create: function () {
var self = this, st = BD.Store, UI = VPC.UI;
VPC.Portal.gameplayStop();
this.bg = BD.backdrop(this);
this.heroes = [BD.heroBalloon(this, 1, [2, 4]), BD.heroBalloon(this, 0, [6, 2, 4]), BD.heroBalloon(this, 2, [6])];
this.title = UI.text(this, 0, 0, 'Balloon\nDomino', 64, '#FF4F87', { stroke: '#ffffff', strokeWidth: 10, shadow: '#C92E62', shadowY: 6, lineSpacing: -18 });
this.tag = UI.text(this, 0, 0, 'One tap. One chain. Clear the sky.', 19, BD.INK, { weight: '600' });
var next = Math.min(st.unlocked, st.playable);
this.play = UI.button(this, {
label: st.brandNew ? 'Play' : 'Level ' + next, icon: 'play', primary: true, w: 300, h: 70, fontSize: 28,
onPress: function () { self.go('Play', { idx: next - 1 }); },
});
this.levels = UI.button(this, { label: 'Levels', icon: 'grid', w: 300, h: 58, fontSize: 22, onPress: function () { self.go('Levels', {}); } });
var dailyOn = st.dailyUnlocked;
var d = st.daily;
this.daily = UI.button(this, {
label: 'Daily Challenge', icon: dailyOn ? 'calendar' : 'lock', w: 300, h: 58, fontSize: 21, enabled: dailyOn,
badge: dailyOn ? (d.doneToday ? 'DONE' : d.streak > 0 ? d.streak + ' DAY' + (d.streak > 1 ? 'S' : '') : 'NEW') : '',
onPress: function () { self.go('Play', { daily: true }); },
});
this.dailyNote = UI.text(this, 0, 0, dailyOn ? '' : 'Clear level ' + BD.DAILY_UNLOCK_AFTER + ' to unlock', 15, '#8A4E6E', { weight: '600' });
this.btnSound = UI.button(this, { icon: VPC.Audio.muted ? 'mute' : 'sound', w: 58, h: 52, onPress: function () {
VPC.Audio.setMuted(!VPC.Audio.muted);
self.btnSound.setIcon(VPC.Audio.muted ? 'mute' : 'sound');
} });
this.btnMusic = UI.button(this, { icon: 'music', w: 58, h: 52, onPress: function () {
VPC.Audio.setMusic(!VPC.Audio.musicOn);
self.btnMusic.setAlpha(VPC.Audio.musicOn ? 1 : 0.45);
} });
this.btnMusic.setAlpha(VPC.Audio.musicOn ? 1 : 0.45);
var stars = st.totalStars;
this.stars = UI.text(this, 0, 0, stars ? stars + ' stars' : '', 17, '#8A4E6E', { weight: '700' });
this.starIcon = this.add.image(0, 0, 'bd-star').setTint(0xFFC23D).setVisible(!!stars);
this.demo = UI.text(this, 0, 0, VPC.build.demoLevels ? 'Demo: the first ' + st.playable + ' skies' : '', 15, '#8A4E6E', { weight: '600' });
VPC.Keys.bind(this, { Enter: function () { self.play.press(); }, Space: function () { self.play.press(); } });
VPC.onResize(this, function (v) { self.layout(v); });
this.heroes.forEach(function (h, k) {
self.tweens.add({ targets: h, y: '-=' + 10 * VPC.dpr(), duration: 1300 + k * 200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: k * 180 });
});
this.game.events.once('postrender', VPC.ready);
},
layout: function (v) {
var u = v.s, cx = v.cx, k = Math.min(1, v.cssH / 760, v.cssW / 420);
this.bg.layout(v);
var top = v.h * 0.07;
var hs = 0.42 * u * k * 100 / BD.R;
this.heroes.forEach(function (h, i) {
h.setScale(hs * (i === 1 ? 1.15 : 0.95));
h.x = cx + (i - 1) * 96 * u * k;
h.y = top + (i === 1 ? 40 : 58) * u * k;
});
this.title.setScale(k).setPosition(cx, top + 190 * u * k);
this.tag.setScale(Math.min(1, k * 1.05)).setPosition(cx, top + 275 * u * k);
var y = top + 345 * u * k, bk = Math.min(1, k * 1.08);
this.play.setScale(bk).setPosition(cx, y);
this.levels.setScale(bk).setPosition(cx, y + 84 * u * bk);
this.daily.setScale(bk).setPosition(cx, y + 156 * u * bk);
this.dailyNote.setScale(bk).setPosition(cx, y + 200 * u * bk);
this.btnSound.setScale(bk).setPosition(cx - 36 * u * bk, y + 250 * u * bk);
this.btnMusic.setScale(bk).setPosition(cx + 36 * u * bk, y + 250 * u * bk);
this.stars.setScale(bk).setPosition(cx + 12 * u * bk, Math.min(v.h - 40 * u, y + 300 * u * bk));
this.starIcon.setScale(20 * u * bk / 128).setPosition(this.stars.x - this.stars.displayWidth / 2 - 14 * u * bk, this.stars.y);
this.demo.setScale(bk).setPosition(cx, Math.min(v.h - 18 * u, y + 326 * u * bk));
},
go: function (key, data) {
var self = this;
this.cameras.main.fadeOut(160, 255, 241, 226);
this.cameras.main.once('camerafadeoutcomplete', function () { self.scene.start(key, data); });
},
});
BD.Levels = new Phaser.Class({
Extends: Phaser.Scene,
initialize: function Levels() { Phaser.Scene.call(this, { key: 'Levels' }); },
init: function (data) {
var per = 20, st = BD.Store;
this.per = per;
this.pages = Math.ceil(st.playable / per);
this.page = data && data.page !== undefined ? data.page : Math.min(this.pages - 1, Math.floor((Math.min(st.unlocked, st.playable) - 1) / per));
},
create: function () {
var self = this, UI = VPC.UI;
VPC.Portal.gameplayStop();
this.bg = BD.backdrop(this);
this.back = UI.button(this, { icon: 'back', w: 58, h: 52, onPress: function () { self.leave('Home', {}); } });
this.heading = UI.text(this, 0, 0, '', 30, BD.INK);
this.blurb = UI.text(this, 0, 0, '', 16, '#8A4E6E', { weight: '600' });
this.prev = UI.button(this, { icon: 'back', w: 64, h: 56, onPress: function () { self.turn(-1); } });
this.next = UI.button(this, { icon: 'next', w: 64, h: 56, onPress: function () { self.turn(1); } });
this.pageText = UI.text(this, 0, 0, '', 17, '#8A4E6E', { weight: '700' });
this.tiles = this.add.container(0, 0);
VPC.Keys.bind(this, {
ArrowLeft: function () { self.turn(-1); }, ArrowRight: function () { self.turn(1); },
Enter: function () { self.leave('Play', { idx: Math.min(BD.Store.unlocked, BD.Store.playable) - 1 }); },
});
VPC.onResize(this, function (v) { self.layout(v); });
this.game.events.once('postrender', VPC.ready);
},
turn: function (d) {
var p = Phaser.Math.Clamp(this.page + d, 0, this.pages - 1);
if (p === this.page) return;
this.page = p;
VPC.Audio.play('tick');
this.layout(VPC.view(this));
},
layout: function (v) {
var self = this, u = v.s, st = BD.Store, UI = VPC.UI;
this.bg.layout(v);
var first = this.page * this.per, last = Math.min(st.playable, first + this.per);
var sec = BD.SECTIONS[BD.LEVELS[first][1]];
this.heading.setText(sec[1] + ' skies').setPosition(v.cx, 44 * u);
this.blurb.setText(sec[2]).setPosition(v.cx, 80 * u);
this.back.setPosition(44 * u, 44 * u);
var cols = v.wide ? 10 : 5, rows = Math.ceil(this.per / cols);
var cell = Math.min((v.w - 32 * u) / cols, (v.h - 230 * u) / rows, 96 * u);
var gw = cell * cols, top = 118 * u;
this.tiles.removeAll(true);
for (var n = first; n < last; n++) {
(function (n) {
var k = n - first, x = v.cx - gw / 2 + (k % cols + 0.5) * cell, y = top + (Math.floor(k / cols) + 0.5) * cell;
var open = n + 1 <= st.unlocked, stars = st.stars(n + 1), current = n + 1 === Math.min(st.unlocked, st.playable);
var t = UI.button(self, {
label: open ? String(n + 1) : '', icon: open ? null : 'lock', primary: current, w: cell / u - 12, h: cell / u - 26, fontSize: Math.min(26, cell / u * 0.3),
enabled: open, onPress: function () { self.leave('Play', { idx: n }); },
});
t.setPosition(x, y - 8 * u);
self.tiles.add(t);
for (var s = 0; s < 3; s++) {
var img = self.add.image(x + (s - 1) * cell * 0.2, y + cell * 0.36, 'bd-star').setScale(cell * 0.0016).setTint(s < stars ? 0xFFC23D : 0xE9CDB8);
if (!open) img.setAlpha(0.4);
self.tiles.add(img);
}
})(n);
}
var by = Math.min(v.h - 44 * u, top + rows * cell + 46 * u);
this.prev.setPosition(v.cx - 110 * u, by).setEnabled(this.page > 0);
this.next.setPosition(v.cx + 110 * u, by).setEnabled(this.page < this.pages - 1);
this.pageText.setText((first + 1) + '–' + last + (VPC.build.demoLevels ? '  (demo)' : '  of ' + st.playable)).setPosition(v.cx, by);
},
leave: function (key, data) {
var self = this;
this.cameras.main.fadeOut(160, 255, 241, 226);
this.cameras.main.once('camerafadeoutcomplete', function () { self.scene.start(key, data); });
},
});
'use strict';
var BD = window.BD || (window.BD = {});
BD.DART_MS = 125;
BD.INTROS = {
storm: ['New: Storm balloons', ['Armoured balloons (silver ring) need two dart hits. Tapping one pops it straight away.', 'Bomb balloons (dark, with a star) pop every balloon right next to them.']],
double: ['New: two taps', ['These skies hold two separate chains. You get two taps to clear them.', 'Find the right balloon for each chain. Armour cracked by the first chain stays cracked.']],
thunder: ['Thunder skies', ['You cleared the first 120! These skies are bigger, with more armour and bombs.', 'Watch for traps: some wrong balloons pop almost everything.']],
cyclone: ['Cyclone skies', ['Two taps again, in bigger skies with more traps.', 'Plan both taps before you start: the first chain changes the second.']],
hurricane: ['Hurricane skies', ['The biggest skies so far, with exactly one right balloon each.', 'Follow the arrows backwards from the hardest balloons to reach.']],
tornado: ['Tornado skies', ['Balloons carry extra arrows that lead nowhere. Only some darts matter.', 'More armour than ever: plan which darts crack it first.']],
monsoon: ['Monsoon skies', ['Two taps in crowded skies. One wrong start leaves a mess.', 'Find the balloon that reaches the most others, then finish the rest.']],
eclipse: ['Eclipse skies', ['The final 40 skies: the biggest and trickiest, one right balloon each.', 'Clear all 400 to finish Balloon Domino!']],
};
BD.RULES = ['How to play', [
'Tap a balloon. It pops and fires a dart along each of its arrows.',
'A dart pops the first balloon in its way, which fires its own darts.',
'Clear the whole sky with your taps. The trick is choosing where to start.',
'First try = 3 stars. Retries = 2. An extra tap = 1.',
]];
BD.Play = new Phaser.Class({
Extends: Phaser.Scene,
initialize: function Play() { Phaser.Scene.call(this, { key: 'Play' }); },
init: function (data) {
var st = BD.Store;
data = data || {};
this.daily = !!data.daily;
this.idx = this.daily ? -1 : Math.min(data.idx || 0, st.playable - 1);
this.level = this.daily ? st.daily.level() : BD.levelAt(this.idx);
this.g = new BD.Game(this.level);
this.busy = false;
this.card = null;
this.handOn = false;
this.tutorial = false;
this.combo = 0;
this.hintsUsed = 0;
this.freeTapUsed = false;
this.leaving = false;
this.highlight = -1;
this.kickAmp = 0;
this.shown = false;
},
create: function () {
var self = this, st = BD.Store, UI = VPC.UI, lv = this.level;
this.bg = BD.backdrop(this);
this.shadow = this.add.graphics().setDepth(5);
this.board = this.add.container(0, 0).setDepth(10);
this.skyImg = this.add.image(0, 0, 'bd-sky').setOrigin(0);
this.clouds = this.add.container(0, 0);
this.cloudMask = this.make.graphics();
var mask = this.cloudMask.createGeometryMask();
this.clouds.setMask(mask);
this.skyImg.setMask(mask);
this.cloudList = [0, 1, 2].map(function (k) { var c = self.add.image(0, 0, 'bd-cloud').setAlpha(0.95); self.clouds.add(c); return c; });
this.board.add([this.skyImg, this.clouds]);
this.hintRing = this.add.image(0, 0, 'bd-hint').setVisible(false);
this.board.add(this.hintRing);
this.views = lv.balloons.map(function (b, i) { return self.makeBalloon(b, i); });
this.dartLayer = this.add.container(0, 0);
this.board.add(this.dartLayer);
this.hitZone = this.add.zone(0, 0, 10, 10).setOrigin(0).setInteractive().setDepth(11);
this.hitZone.on('pointerdown', function (p) { self.onSkyDown(p); });
this.comboText = UI.text(this, 0, 0, '', 34, '#ffffff', { stroke: '#FF2E7E', strokeWidth: 3, shadow: '#FF2E7E', shadowY: 3 }).setDepth(60).setVisible(false);
this.comboSub = UI.text(this, 0, 0, '', 24, '#FFC800', { shadow: 'rgba(74,23,56,0.8)', shadowY: 2, blur: 6 }).setDepth(60).setVisible(false);
this.plates = this.add.graphics().setDepth(90);
var t = function (size, color, w) { return UI.text(self, 0, 0, '', size, color, { weight: w || '800' }).setDepth(100); };
this.lblLevel = t(13, '#8A4E6E');
this.valLevel = t(44, BD.INK, '700');
this.lblSection = t(13, '#FF4F87');
this.lblPop = t(13, '#8A4E6E');
this.valPop = t(36, '#FF4F87', '700');
this.lblTaps = t(13, '#8A4E6E');
this.valTaps = t(30, '#1FA8FF', '700');
this.lblGoal = t(13, '#FF4F87');
this.valGoal = UI.text(this, 0, 0, '', 15, BD.INK, { weight: '700', wrap: 220 }).setDepth(100);
this.lblBoost = UI.text(this, 0, 0, 'BOOSTERS', 13, '#8A4E6E', { weight: '800' }).setDepth(100);
this.nudgeText = UI.text(this, 0, 0, 'Stuck? Try a hint', 15, '#8A4E6E', { weight: '700' }).setDepth(100).setAlpha(0);
var b = function (o) { return UI.button(self, o).setDepth(100); };
this.btnMenu = b({ label: 'Menu', icon: 'back', w: 150, h: 52, fontSize: 18, onPress: function () { self.leave('Home', {}); } });
this.btnHint = b({ label: 'Hint (H)', icon: 'bulb', primary: true, w: 200, h: 60, fontSize: 20, onPress: function () { self.useHint(); } });
this.btnTap = b({ label: '+1 Tap', icon: 'tap', w: 200, h: 60, fontSize: 20, onPress: function () { self.bonusTap(); } });
this.btnRestart = b({ label: 'Restart (R)', icon: 'restart', w: 200, h: 52, fontSize: 18, onPress: function () { self.retry(); } });
this.btnHelp = b({ label: 'How to play', icon: 'help', w: 200, h: 52, fontSize: 18, onPress: function () { self.showInfo(BD.RULES, false); } });
this.btnMute = b({ icon: VPC.Audio.muted ? 'mute' : 'sound', w: 52, h: 48, onPress: function () {
VPC.Audio.setMuted(!VPC.Audio.muted);
self.btnMute.setIcon(VPC.Audio.muted ? 'mute' : 'sound');
} });
this.unsub = VPC.Portal.onChange(function () { self.refresh(); });
this.events.once('shutdown', function () { self.unsub(); if (self.nudgeTimer) self.nudgeTimer.remove(); });
VPC.Keys.bind(this, {
R: function () { if (self.canAct() && (self.g.tapsUsed > 0 || self.g.status !== 'playing')) self.retry(); },
H: function () { if (self.canAct() && self.g.status === 'playing' && !self.handOn && !self.tutorial) self.useHint(); },
Enter: function () { self.keyNext(); },
Space: function () { self.keyNext(); },
});
VPC.onResize(this, function (v) { self.layout(v); });
var section = lv.section[0];
var firstOfSection = this.idx > 0 && BD.LEVELS[this.idx - 1][1] !== BD.LEVELS[this.idx][1];
if (this.daily) {
} else if (this.idx === 0 && st.brandNew) {
this.handOn = true;
this.setHighlight(lv.solution[0]);
this.time.delayedCall(250, function () { if (self.handOn) self.placeHand(); });
} else if (this.idx === 1 && !st.goalCardSeen && st.unlocked <= 2) {
this.showGoalCard();
} else if (this.idx === 0 && !st.tutorialDone) {
this.showInfo(BD.RULES, true);
} else if (firstOfSection && BD.INTROS[section] && !st.introSeen(section)) {
this.showInfo(BD.INTROS[section], false, section);
}
this.armNudge();
VPC.Portal.gameplayStart();
this.refresh();
this.cameras.main.fadeIn(180, 255, 241, 226);
try { performance.mark('vpc-created'); } catch (e) {}
this.game.events.once('postrender', VPC.ready);
},
makeBalloon: function (b, i) {
var c = this.add.container(0, 0);
var body = this.add.image(0, 0, BD.art.balloonKey(b, i)).setOrigin(BD.BCX / BD.BW, BD.BCY / BD.BH);
c.add(body);
var ring = null;
if (b.armour) { ring = this.add.image(0, 0, 'bd-ring2'); c.add(ring); }
var self = this;
b.arrows.forEach(function (d) {
c.add(self.add.image(0, 0, 'bd-arrow').setOrigin(0, 0.5).setRotation(Math.atan2(BD.DIRS[d][0], BD.DIRS[d][1])));
});
if (b.arrows.length) c.add(this.add.image(0, 0, 'bd-hub').setScale(BD.R * 0.2 / 20));
this.board.add(c);
return { c: c, ring: ring, alive: true };
},
/** Balloon i centre in cell units, with the Flutter game's stable jitter. */
cellCentre: function (i) {
var b = this.level.balloons[i];
var jx = ((i * 37 + 11) % 13) / 13 - 0.5, jy = ((i * 53 + 7) % 11) / 11 - 0.5;
return [b.c + 0.5 + jx * 0.16, b.r + 0.5 + jy * 0.16];
},
/** Balloon i centre in scene px. */
balloonXY: function (i) {
var p = this.cellCentre(i);
return [this.sky.x + p[0] * this.cell, this.sky.y + p[1] * this.cell];
},
layout: function (v) {
var u = v.s, W = v.w, H = v.h;
this.v = v;
this.bg.layout(v);
var sky;
if (v.wide) {
var h = H - 28 * u, w = h * BD.COLS / BD.ROWS, pw = Math.min(260 * u, (W - w) / 2 - 36 * u);
if (pw < 150 * u) { pw = 150 * u; w = Math.max(160 * u, W - 2 * (pw + 36 * u)); h = w * BD.ROWS / BD.COLS; }
sky = { x: (W - w) / 2, y: (H - h) / 2, w: w, h: h, pw: pw };
} else {
var top = 118 * u, bottom = 104 * u, side = 14 * u;
var aw = W - side * 2, ah = H - top - bottom;
sky = { x: side, y: top, w: aw, h: ah };
}
var cell = Math.min(sky.w / BD.COLS, sky.h / BD.ROWS);
var sw = cell * BD.COLS, sh = cell * BD.ROWS;
sky.x += (sky.w - sw) / 2;
sky.y += (sky.h - sh) / 2;
sky.w = sw;
sky.h = sh;
this.sky = sky;
this.cell = cell;
var rad = 26 * u;
this.skyImg.setDisplaySize(sw, sh);
this.board.setPosition(sky.x, sky.y);
this.shadow.clear().fillStyle(0x9CC3E6, 1).fillRoundedRect(sky.x, sky.y + 8 * u, sw, sh, rad);
this.cloudMask.clear().fillStyle(0xffffff).fillRoundedRect(sky.x, sky.y, sw, sh, rad);
this.hitZone.setPosition(sky.x, sky.y).setSize(sw, sh);
if (this.hitZone.input) this.hitZone.input.hitArea.setTo(0, 0, sw, sh);
var k = cell * 0.4 / BD.R, self = this;
this.views.forEach(function (bv, i) {
bv.c.setScale(k);
var p = self.cellCentre(i);
bv.c.setPosition(p[0] * cell, p[1] * cell);
bv.home = [p[0] * cell, p[1] * cell];
});
this.hintRing.setScale(k);
this.cloudList.forEach(function (c, i) { c.setScale(cell / 160 * [1, 0.8, 1.1][i]); });
this.comboText.setPosition(sky.x + sw / 2, sky.y + sh * 0.225);
this.comboSub.setPosition(sky.x + sw / 2, sky.y + sh * 0.225 + 44 * u);
this.placeHand();
this.layoutHud(v);
},
layoutHud: function (v) {
var u = v.s, s = this.sky, g = this.plates;
g.clear();
var plate = function (x, y, w, h) {
g.fillStyle(0x000000, 0.12).fillRoundedRect(x, y + 6 * u, w, h, 22 * u);
g.fillStyle(0xFFF6EC, 0.95).fillRoundedRect(x, y, w, h, 22 * u);
g.lineStyle(2.5 * u, 0xFF4F87, 0.55).strokeRoundedRect(x, y, w, h, 22 * u);
};
this.refresh(); // texts first: the goal plate is sized from its text
var all = [this.lblLevel, this.valLevel, this.lblSection, this.lblPop, this.valPop, this.lblTaps, this.valTaps, this.lblGoal, this.valGoal, this.lblBoost];
all.forEach(function (o) { o.setScale(1).setOrigin(0.5).setVisible(true); });
if (v.wide) {
var pw = s.pw, lx = s.x - 24 * u - pw, rx = s.x + s.w + 24 * u, cxl = lx + pw / 2, cxr = rx + pw / 2, bw = pw / u;
this.btnMenu.setSize2(bw, 52).setLabel('Menu').setPosition(cxl, s.y + 26 * u);
plate(lx, s.y + 66 * u, pw, 132 * u);
this.lblLevel.setPosition(cxl, s.y + 88 * u);
this.valLevel.setPosition(cxl, s.y + 128 * u);
this.lblSection.setPosition(cxl, s.y + 172 * u);
plate(lx, s.y + 212 * u, pw, 156 * u);
this.lblPop.setPosition(cxl, s.y + 236 * u);
this.valPop.setPosition(cxl, s.y + 272 * u);
this.lblTaps.setPosition(cxl, s.y + 310 * u);
this.valTaps.setPosition(cxl, s.y + 342 * u);
this.valGoal.setWordWrapWidth(pw - 28 * u);
var goalH = this.valGoal.text ? this.valGoal.height + 48 * u : 0;
this.lblGoal.setVisible(!!goalH);
this.valGoal.setVisible(!!goalH);
if (goalH) {
plate(lx, s.y + s.h - goalH, pw, goalH);
this.lblGoal.setPosition(cxl, s.y + s.h - goalH + 20 * u);
this.valGoal.setPosition(cxl, s.y + s.h - goalH / 2 + 12 * u);
}
this.lblBoost.setPosition(cxr, s.y + 10 * u);
this.btnHint.setSize2(bw, 60).setLabel('Hint (H)').setPosition(cxr, s.y + 64 * u);
this.btnTap.setSize2(bw, 60).setVisible(true).setPosition(cxr, s.y + 142 * u);
this.btnRestart.setSize2(bw, 52).setLabel('Restart (R)').setPosition(cxr, s.y + s.h - 96 * u);
this.btnHelp.setSize2(bw, 52).setLabel('How to play').setPosition(cxr, s.y + s.h - 30 * u);
this.btnMute.setPosition(cxr, s.y + 214 * u);
this.nudgeText.setPosition(cxr, s.y + 106 * u + 14 * u);
} else {
var W = v.w, top = 12 * u;
this.btnMenu.setSize2(52, 48).setLabel('').setPosition(14 * u + 26 * u, top + 26 * u);
this.lblLevel.setOrigin(0, 0.5).setPosition(80 * u, top + 12 * u);
this.valLevel.setOrigin(0, 0.5).setScale(0.62).setPosition(80 * u, top + 38 * u);
this.lblSection.setVisible(false);
this.btnHelp.setSize2(52, 48).setLabel('').setPosition(W - 40 * u, top + 26 * u);
this.btnMute.setPosition(W - 100 * u, top + 26 * u);
var py = top + 84 * u;
plate(W / 2 - 150 * u, py - 22 * u, 300 * u, 44 * u);
this.lblPop.setPosition(W / 2 - 92 * u, py);
this.valPop.setScale(0.7).setPosition(W / 2 - 38 * u, py);
this.lblTaps.setPosition(W / 2 + 46 * u, py);
this.valTaps.setScale(0.75).setPosition(W / 2 + 100 * u, py);
this.lblGoal.setVisible(false);
this.valGoal.setVisible(false);
this.lblBoost.setVisible(false);
var by = v.h - 48 * u, bw2 = Math.min(180, (v.cssW - 44) / 2);
this.btnRestart.setSize2(bw2, 60).setLabel('Retry').setPosition(W / 2 - (bw2 / 2 + 6) * u, by);
this.btnHint.setSize2(bw2, 60).setLabel('Hint').setPosition(W / 2 + (bw2 / 2 + 6) * u, by);
this.btnTap.setVisible(false);
this.nudgeText.setPosition(W / 2 + (bw2 / 2 + 6) * u, by - 50 * u);
}
this.refresh();
},
/** Texts, badges and enabled states. */
refresh: function () {
if (!this.sky) return;
var st = BD.Store, g = this.g, P = VPC.Portal, wide = this.v.wide;
var playing = g.status === 'playing';
this.lblLevel.setText(this.daily ? 'DAILY CHALLENGE' : 'LEVEL');
var d = new Date();
this.valLevel.setText(this.daily ? d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] : String(this.level.number));
this.lblSection.setText(this.daily ? '' : this.level.section[1].toUpperCase() + ' SKIES');
this.lblPop.setText(wide ? 'TO POP' : 'TO POP');
this.valPop.setText(String(this.liveRemaining()));
this.lblTaps.setText('TAPS LEFT');
this.valTaps.setText(String(g.tapsLeft));
var goal = this.nextGoal();
this.lblGoal.setText(goal && wide ? 'NEXT GOAL' : '');
this.valGoal.setText(goal && wide ? goal : '');
var free = this.levelHintsLeft() + st.daily.freeHints;
this.btnHint.setBadge(free > 0 ? (wide ? '×' + free : free + ' free') : P.rewardedSupported ? 'AD' : '×0');
this.btnHint.setEnabled(playing && !this.busy && !this.handOn && !this.tutorial && !this.card && (free > 0 || P.rewardedReady() || !P.rewardedSupported));
var lost = g.status === 'lost';
this.btnTap.setBadge(P.rewardedSupported ? 'AD' : this.freeTapUsed ? '×0' : '×1');
this.btnTap.setEnabled(lost && (P.rewardedSupported ? P.rewardedReady() : !this.freeTapUsed));
this.btnTap.setPrimary(lost);
this.btnHint.setPrimary(playing);
this.btnRestart.setEnabled(!this.busy && (g.tapsUsed > 0 || !playing));
},
liveRemaining: function () {
return this.views.filter(function (v) { return v.alive; }).length;
},
levelHintsLeft: function () { return VPC.Portal.rewardedSupported ? 0 : 1 - this.hintsUsed; },
setHighlight: function (i) {
this.highlight = i;
this.hintRing.setVisible(i >= 0);
},
/** The hand on level 1's answer; drawn from above when the balloon is near the bottom edge. */
placeHand: function () {
if (!this.handOn || !this.sky) return;
var p = this.balloonXY(this.level.solution[0]), flip = p[1] > this.v.h - 120 * this.v.s;
if (this.hand && this.hand.__flip !== flip) { this.hand.destroy(); this.hand = null; }
if (!this.hand) {
this.hand = VPC.UI.hand(this, p[0], p[1], 1, flip);
this.hand.__flip = flip;
}
this.hand.setPosition(p[0], p[1]);
},
update: function (time, dt) {
if (!this.sky) return;
var t = time / 1000, cell = this.cell, self = this;
this.views.forEach(function (bv, i) {
if (!bv.alive || !bv.home) return;
bv.c.y = bv.home[1] + Math.sin(t * 1.7 + i) * cell * 0.04;
bv.c.x = bv.home[0];
});
if (this.highlight >= 0 && this.views[this.highlight]) {
var hv = this.views[this.highlight].c;
this.hintRing.setPosition(hv.x, hv.y).setAlpha(0.6 + 0.4 * Math.sin(t * 7));
}
var w = this.sky.w + cell * 2;
this.cloudList.forEach(function (c, k) {
var s = [1, 0.8, 1.1][k];
c.x = ([0.2, 0.75, 0.35][k] * self.sky.w + t * 9 * s * self.v.s) % w - cell;
c.y = [0.12, 0.32, 0.78][k] * self.sky.h;
});
if (this.kickAmp > 0.2) {
this.kickAmp *= Math.pow(0.0008, dt / 1000);
var a = this.kickAmp * this.v.s;
this.board.setPosition(this.sky.x + (Math.random() * 2 - 1) * a, this.sky.y + (Math.random() * 2 - 1) * a);
} else if (this.kickAmp) {
this.kickAmp = 0;
this.board.setPosition(this.sky.x, this.sky.y);
}
},
canAct: function () { return !this.busy && !this.card && !VPC.Portal.busy; },
onSkyDown: function (p) {
if (!this.canAct() || this.g.status !== 'playing') return;
var best = -1, bestD = Infinity, self = this;
this.views.forEach(function (bv, i) {
if (!bv.alive) return;
var c = self.balloonXY(i), d = Math.hypot(c[0] - p.x, c[1] - p.y);
if (d < bestD) { bestD = d; best = i; }
});
if (best >= 0 && bestD < this.cell * 0.6) this.tap(best);
else {
VPC.Juice.ripple(this, p.x, p.y, this.cell * 0.5);
VPC.Audio.play('tick', { volume: 0.8 });
}
},
tap: function (i) {
var self = this, st = BD.Store;
var chain = this.g.tap(i);
if (!chain) return;
if (this.nudgeTimer) this.nudgeTimer.remove();
this.nudge(false);
if (this.hand) { this.hand.destroy(); this.hand = null; }
this.handOn = false;
this.setHighlight(-1);
this.combo = 0;
this.busy = true;
this.refresh();
this.playChain(chain, function () {
self.busy = false;
self.time.delayedCall(1400, function () { if (!self.busy) self.hideCombo(); });
if (self.g.status === 'playing') {
if (self.tutorial) self.setHighlight(self.g.hint());
self.refresh();
return;
}
var won = self.g.status === 'won';
if (won) {
VPC.Portal.gameplayStop();
VPC.Portal.levelWon();
if (self.daily) {
self.dailyResult = st.daily.complete();
} else {
st.recordWin(self.level.number, self.g.stars);
if (self.tutorial || self.idx === 0) { st.markTutorialDone(); self.tutorial = false; }
}
VPC.Audio.play('win', { volume: 0.8 });
VPC.Juice.confetti(self, null, 96);
} else {
VPC.Audio.play('lose');
}
self.refresh();
self.time.delayedCall(450, function () { self.showResult(); });
});
},
/** Plays the chain tick by tick (darts fly 125 ms per cell). */
playChain: function (chain, done) {
var self = this, k = 0;
var step = function () {
if (!self.sys.isActive() && !self.sys.isPaused()) return;
if (k >= chain.ticks.length) {
self.dartLayer.removeAll(true);
done();
return;
}
var tick = chain.ticks[k];
self.flyDarts(tick.darts);
var apply = function () {
tick.events.forEach(function (e) { e[1] === 'pop' ? self.popBalloon(e[0]) : self.crackBalloon(e[0]); });
self.valPop.setText(String(self.liveRemaining()));
k++;
step();
};
if (k === 0) apply(); else self.time.delayedCall(BD.DART_MS, apply);
};
step();
},
flyDarts: function (moves) {
var self = this, cell = this.cell, sc = cell / BD.art.CELL;
this.dartLayer.removeAll(true);
moves.forEach(function (m) {
var d = self.add.image((m[1] + 0.5) * cell, (m[0] + 0.5) * cell, 'bd-dart')
.setOrigin(BD.art.CELL * 0.27 / BD.art.DW, 0.5).setScale(sc).setRotation(Math.atan2(m[2] - m[0], m[3] - m[1]));
self.dartLayer.add(d);
self.tweens.add({ targets: d, x: (m[3] + 0.5) * cell, y: (m[2] + 0.5) * cell, duration: BD.DART_MS });
});
},
popBalloon: function (i) {
var bv = this.views[i], b = this.level.balloons[i];
if (!bv.alive) return;
bv.alive = false;
var p = this.balloonXY(i), c = bv.c, self = this;
this.tweens.add({ targets: c, scale: c.scale * 1.35, alpha: 0, duration: 110, onComplete: function () { c.setVisible(false); } });
VPC.Juice.burst(this, p[0], p[1], { color: BD.art.colorOf(b, i), count: 16, size: 0.8, speed: Math.min(1.2, this.cell / 90 / this.v.s + 0.2) });
VPC.Juice.burst(this, p[0], p[1], { key: 'vpc-dot', color: 0xffffff, count: 5, size: 0.6, speed: 0.5, gravity: 0 });
this.combo++;
this.kickAmp = Math.max(this.kickAmp, Math.min(9, 2.5 + this.combo * 0.6));
VPC.Audio.play('pop', { volume: 0.6, rate: 0.92 + Math.min(this.combo, 12) * 0.025 });
if (this.combo >= 2) {
var t = this.comboText;
var k = Math.min(30 + this.combo * 2, 52) / 34;
t.setText('CHAIN ×' + this.combo).setVisible(true);
this.tweens.killTweensOf(t);
t.setScale(k * 1.45).setAlpha(1);
this.tweens.add({ targets: t, scale: k, duration: 220, ease: 'Back.easeOut' });
}
if (this.combo === 6 || this.combo === 9) {
var sub = this.comboSub;
sub.setText(this.combo >= 9 ? 'MEGA CHAIN!' : 'GREAT CHAIN!').setVisible(true).setAlpha(1);
VPC.Juice.popIn(this, sub, 0, 1);
VPC.Audio.play('chime', { volume: this.combo >= 9 ? 1 : 0.7 });
}
void self;
},
crackBalloon: function (i) {
var bv = this.views[i];
if (bv.ring) bv.ring.setTexture('bd-ring1');
var p = this.balloonXY(i);
VPC.Juice.burst(this, p[0], p[1], { color: 0xC9D3E0, count: 8, size: 0.6, speed: 0.7 });
VPC.Juice.punch(this, bv.c, 0.12);
VPC.Audio.play('crack', { volume: 0.8 });
},
hideCombo: function () {
var self = this;
this.tweens.add({ targets: [this.comboText, this.comboSub], alpha: 0, duration: 250, onComplete: function () {
self.comboText.setVisible(false);
self.comboSub.setVisible(false);
} });
},
useHint: function () {
var self = this, st = BD.Store, P = VPC.Portal, UI = VPC.UI;
if (!this.canAct() || this.g.status !== 'playing') return;
if (!P.rewardedSupported && this.g.hint() < 0) { UI.toast(this, 'No win from here. Tap Retry to start over.'); return; }
var go = function (msg) {
if (msg) UI.toast(self, msg);
self.nudge(false);
var i = self.g.hint();
if (i < 0) { UI.toast(self, 'No win from here. Tap Retry to start over.'); return; }
self.setHighlight(i);
VPC.Audio.play('chime', { volume: 0.5 });
self.refresh();
};
if (this.levelHintsLeft() > 0) { this.hintsUsed++; go('Free hint for this level'); return; }
if (st.daily.useFreeHint()) { go('Free hint used  ·  ' + st.daily.freeHints + ' left'); return; }
if (!P.rewardedSupported) { UI.toast(this, 'No hints left. Try Retry'); return; }
P.showRewarded('a hint').then(function (ok) {
if (!self.sys.isActive()) return;
if (ok) go(null); else UI.toast(self, 'No ad available right now. Try again in a minute.');
self.refresh();
});
},
bonusTap: function () {
var self = this, P = VPC.Portal;
if (VPC.Portal.busy) return;
var give = function () {
self.g.addBonusTap();
if (self.card) { self.card.close(); self.card = null; }
VPC.Portal.gameplayStart();
VPC.Juice.floatText(self, self.sky.x + self.sky.w / 2, self.sky.y + self.sky.h * 0.5, '+1 TAP', { fontFamily: VPC.UI.theme.font, fontStyle: '700', fontSize: Math.round(40 * self.v.s) + 'px', color: '#ffffff', stroke: '#1FA8FF', strokeThickness: 8 * self.v.s });
VPC.Audio.play('unlock', { volume: 0.7 });
self.refresh();
};
if (P.rewardedSupported) {
P.showRewarded('an extra tap').then(function (ok) {
if (!self.sys.isActive()) return;
if (ok) give(); else { VPC.UI.toast(self, 'No ad available right now. Try again in a minute.'); self.refresh(); }
});
} else if (!this.freeTapUsed) {
this.freeTapUsed = true;
give();
}
},
retry: function () {
if (this.busy) return;
if (this.card) { this.card.close(); this.card = null; }
var replay = this.g.status === 'won';
if (replay) this.g = new BD.Game(this.level); else this.g.retry();
this.resetSky();
this.setHighlight(this.tutorial ? this.g.hint() : -1);
VPC.Audio.play('whoosh', { volume: 0.7 });
VPC.Portal.gameplayStart();
this.armNudge();
this.refresh();
},
resetSky: function () {
var self = this, k = this.cell * 0.4 / BD.R;
this.views.forEach(function (bv, i) {
var alive = self.g.hits[i] > 0;
if (bv.ring) bv.ring.setTexture('bd-ring2');
if (alive && !bv.alive) {
bv.c.setVisible(true).setAlpha(0).setScale(k * 0.4);
self.tweens.add({ targets: bv.c, alpha: 1, scale: k, duration: 260, delay: i * 18, ease: 'Back.easeOut' });
}
bv.alive = alive;
});
this.dartLayer.removeAll(true);
this.hideCombo();
},
armNudge: function () {
var self = this;
if (this.nudgeTimer) this.nudgeTimer.remove();
this.nudge(false);
this.nudgeTimer = this.time.delayedCall(30000, function () {
if (!self.tutorial && !self.card && !self.handOn && self.g.status === 'playing' && self.g.tapsUsed === 0) self.nudge(true);
});
},
nudge: function (on) {
if (!this.nudgeText) return;
this.tweens.killTweensOf(this.nudgeText);
this.tweens.add({ targets: this.nudgeText, alpha: on ? 1 : 0, duration: 300 });
if (on) VPC.Juice.punch(this, this.btnHint, 0.15);
},
/** The closest goal after this level ("4 MORE LEVELS TO UNLOCK THE DAILY CHALLENGE"). */
nextGoal: function () {
if (this.daily) return null;
var st = BD.Store, playable = st.playable;
var cur = this.g.status === 'won' ? this.idx + 1 : this.idx;
if (cur >= playable) return null;
var lv = function (n) { return n === 1 ? '1 MORE LEVEL' : n + ' MORE LEVELS'; };
var goals = [];
if (!st.dailyUnlocked && BD.DAILY_UNLOCK_AFTER < playable) {
var n = BD.DAILY_UNLOCK_AFTER + 1 - st.unlocked;
goals.push([n, lv(n) + ' TO UNLOCK THE DAILY CHALLENGE']);
}
for (var j = cur + 1; j < playable; j++) {
if (BD.LEVELS[j][1] !== BD.LEVELS[cur][1]) { goals.push([j - cur, lv(j - cur) + ' TO ' + BD.SECTIONS[BD.LEVELS[j][1]][1].toUpperCase() + ' SKIES']); break; }
}
if (VPC.build.demoLevels) goals.push([playable - cur, lv(playable - cur) + ' LEFT IN THE DEMO']);
goals = goals.filter(function (g) { return g[0] > 0; }).sort(function (a, b) { return a[0] - b[0]; });
return goals.length ? goals[0][1] : null;
},
keyNext: function () {
if (VPC.Portal.busy) return;
if (this.card && this.card.primary) this.card.primary.press();
},
showGoalCard: function () {
var self = this, UI = VPC.UI;
this.card = UI.card(this, 320, function (card, u) {
var p = card.panel;
[[1, -60, 18, [2]], [0, 0, 0, [2, 6]], [2, 60, 18, [6]]].forEach(function (a) {
var h = BD.heroBalloon(self, a[0], a[3]).setScale(0.22 * u * 100 / BD.R).setPosition(a[1] * u, 52 * u + a[2] * u);
p.add(h);
});
p.add(UI.text(self, 0, 150 * u, 'CLEAR THE\nWHOLE SKY', 30, BD.INK, { lineSpacing: -4 }));
var pill = self.add.graphics().fillStyle(0xFFC23D, 1).fillRoundedRect(-82 * u, 196 * u, 164 * u, 36 * u, 18 * u);
p.add(pill);
p.add(UI.text(self, 0, 214 * u, 'WITH ONE TAP', 18, '#4A2A00'));
card.primary = UI.button(self, { label: 'Play', icon: 'play', primary: true, w: 260, h: 60, fontSize: 22, onPress: function () {
BD.Store.markGoalCardSeen();
card.close();
self.card = null;
self.refresh();
} }).setPosition(0, 276 * u);
p.add(card.primary);
return 310 * u;
}, { border: '#FF4F87' });
this.refresh();
},
/** Rules or a section intro. firstTime: the old "Show me" walkthrough. */
showInfo: function (info, firstTime, section) {
var self = this, UI = VPC.UI;
if (this.card) return;
this.card = UI.card(this, 360, function (card, u) {
var p = card.panel, y = 26 * u;
var title = UI.text(self, -150 * u, y, info[0], 28, BD.INK, { ox: 0, oy: 0 });
p.add(title);
y += title.height + 16 * u;
info[1].forEach(function (line) {
var dot = self.add.image(-146 * u, y + 11 * u, 'vpc-icon-star').setDisplaySize(18 * u, 18 * u).setTint(0xFF4F87);
var t = UI.text(self, -126 * u, y, line, 16, BD.INK, { ox: 0, oy: 0, weight: '600', wrap: 270, align: 'left', lineSpacing: 2 });
p.add([dot, t]);
y += t.height + 12 * u;
});
card.primary = UI.button(self, { label: firstTime ? 'Show me' : 'Got it', icon: firstTime ? 'play' : 'check', primary: true, w: 320, h: 56, onPress: function () {
if (section) BD.Store.markIntroSeen(section);
card.close();
self.card = null;
if (firstTime) { self.tutorial = true; self.setHighlight(self.g.hint()); }
self.refresh();
} }).setPosition(0, y + 34 * u);
p.add(card.primary);
return y + 66 * u;
}, { dimAlpha: 0.75 });
this.refresh();
},
showResult: function () {
var self = this, UI = VPC.UI, g = this.g, st = BD.Store, P = VPC.Portal;
if (this.card) { this.card.close(); this.card = null; }
this.hideCombo();
var won = g.status === 'won', r = this.dailyResult, goal = won ? this.nextGoal() : null;
var hasNext = !this.daily && this.idx + 1 < st.playable;
var demoOver = VPC.build.demoLevels > 0 && !this.daily && this.idx + 1 >= st.playable;
this.card = UI.card(this, 340, function (card, u) {
var p = card.panel, y = 22 * u, title, body;
if (won && self.daily) {
var flame = self.add.image(0, y + 38 * u, 'vpc-icon-flame').setDisplaySize(76 * u, 76 * u).setTint(0xFFC23D);
p.add(flame);
VPC.Juice.popIn(self, flame, 150);
y += 84 * u;
title = 'Streak: ' + r.streak + (r.streak === 1 ? ' day!' : ' days!');
body = r.streak >= st.daily.best && r.streak > 1 ? 'Daily Challenge solved. Your best streak yet! Come back tomorrow to keep it going.'
: 'Daily Challenge solved. Come back tomorrow for a new sky. Best streak: ' + st.daily.best + '.';
} else if (won) {
for (var k = 0; k < 3; k++) {
(function (k) {
var s = self.add.image((k - 1) * 66 * u, y + (k === 1 ? 34 : 42) * u, 'bd-star').setTint(k < g.stars ? 0xFFC23D : 0xF1D9C6);
var size = (k === 1 ? 70 : 54) * u / 128;
s.setScale(size);
p.add(s);
VPC.Juice.popIn(self, s, 200 + k * 180, size);
if (k < g.stars) self.time.delayedCall(200 + k * 180, function () { VPC.Audio.play('star', { rate: 1 + k * 0.12 }); });
})(k);
}
y += 84 * u;
title = 'Sky cleared!';
body = g.usedBonusTap ? 'Cleared with an extra tap. Clear it with ' + g.level.taps + ' for more stars.'
: g.attempt === 1 ? 'First try. Brilliant!' : 'Solved on try ' + g.attempt + '. First-try clears earn 3 stars.';
} else {
title = g.remaining + ' left!';
body = 'So close. Try a different starting balloon, or take one extra tap.';
}
var tt = UI.text(self, 0, y, title, 30, BD.INK, { oy: 0 });
p.add(tt);
y += tt.height + 8 * u;
var bt = UI.text(self, 0, y, body, 16, '#8A4E6E', { oy: 0, weight: '600', wrap: 290, lineSpacing: 3 });
p.add(bt);
y += bt.height + 12 * u;
if (won && r && self.daily && r.hintsAdded) {
var gift = '+' + r.hintsAdded + ' free hint' + (r.hintsAdded > 1 ? 's' : '') + '  ·  ' + r.freeHints + ' saved';
var nm = st.daily.nextMilestone();
if (nm && nm.hints) gift += '\nDay ' + nm.day + ': +' + nm.hints + ' more hints';
var gt = UI.text(self, 0, y + 4 * u, gift, 15, '#4A2A00', { oy: 0, wrap: 280 });
var gb = self.add.graphics().fillStyle(0xFFC23D, 1).fillRoundedRect(-150 * u, y - 4 * u, 300 * u, gt.height + 16 * u, 14 * u);
p.add([gb, gt]);
y += gt.height + 26 * u;
}
if (goal) {
var gl = UI.text(self, 0, y + 4 * u, goal, 14, '#4A2A00', { oy: 0, wrap: 270 });
var gg = self.add.graphics().fillStyle(0xFFC23D, 1).fillRoundedRect(-145 * u, y - 4 * u, 290 * u, gl.height + 16 * u, 14 * u);
p.add([gg, gl]);
y += gl.height + 26 * u;
}
y += 34 * u;
var left, right;
if (won) {
left = UI.button(self, { label: 'Replay', icon: 'restart', w: 140, h: 56, fontSize: 18, onPress: function () { self.retry(); } });
right = UI.button(self, { label: self.daily ? 'Done' : hasNext ? 'Next' : 'Done', icon: self.daily ? 'check' : 'next', primary: true, w: 140, h: 56, fontSize: goal ? 21 : 18,
onPress: function () { self.leaveWin(hasNext, demoOver); } });
} else {
var adOk = P.rewardedSupported ? P.rewardedReady() : !self.freeTapUsed;
left = UI.button(self, { label: 'Retry', icon: 'restart', w: 140, h: 56, fontSize: 18, onPress: function () { self.retry(); } });
right = UI.button(self, { label: '+1 Tap', icon: 'tap', primary: true, w: 140, h: 56, fontSize: 18, enabled: adOk,
badge: P.rewardedSupported ? 'AD' : self.freeTapUsed ? '0' : 'FREE', onPress: function () { self.bonusTap(); } });
}
left.setPosition(-76 * u, y);
right.setPosition(76 * u, y);
p.add([left, right]);
card.primary = won || right.isEnabled() ? right : left;
return y + 36 * u;
}, { dimAlpha: 0.55 });
this.refresh();
},
leaveWin: function (hasNext, demoOver) {
var self = this;
if (this.leaving) return;
this.leaving = true;
VPC.Portal.afterLevel().then(function () {
if (!self.sys.isActive()) return;
if (self.daily) self.leave('Home', {});
else if (demoOver) self.showDemoEnd();
else if (hasNext) self.leave('Play', { idx: self.idx + 1 });
else self.leave('Home', {});
});
},
showDemoEnd: function () {
var self = this, UI = VPC.UI, url = VPC.build.fullGameUrl;
if (this.card) { this.card.close(); this.card = null; }
this.card = UI.card(this, 340, function (card, u) {
var p = card.panel;
p.add(UI.text(self, 0, 40 * u, 'That\'s the demo!', 30, BD.INK));
var t = UI.text(self, 0, 76 * u, 'Thanks for playing. The full game has 400 skies, armour, bombs and a Daily Challenge.', 16, '#8A4E6E', { oy: 0, weight: '600', wrap: 290 });
p.add(t);
var y = 76 * u + t.height + 44 * u;
if (url) {
var get = UI.button(self, { label: 'Get the full game', icon: 'play', primary: true, w: 290, h: 58, onPress: function () { window.open(url, '_blank', 'noopener'); } }).setPosition(0, y);
p.add(get);
y += 72 * u;
}
card.primary = UI.button(self, { label: 'Menu', icon: 'home', primary: !url, w: 290, h: 54, onPress: function () { self.leave('Home', {}); } }).setPosition(0, y);
p.add(card.primary);
return y + 36 * u;
});
},
leave: function (key, data) {
var self = this;
VPC.Portal.gameplayStop();
if (this.card) this.card.close();
this.cameras.main.fadeOut(160, 255, 241, 226);
this.cameras.main.once('camerafadeoutcomplete', function () { self.scene.start(key, data); });
},
});
'use strict';
VPC.UI.setTheme({
font: 'Fredoka, system-ui, sans-serif',
ink: '#4A1738', muted: '#8A4E6E', panel: '#FFF6EC', page: '#FFE7CF',
primary: '#FF4F87', primaryLip: '#C92E62', primaryInk: '#FFFFFF',
button: '#FFFFFF', buttonLip: '#E9B894', buttonInk: '#4A1738',
star: '#FFC23D', starInk: '#4A2A00', badge: '#3A1230', badgeInk: '#FFD84D', free: '#14B886',
});
VPC.qaState = function () {
var p = VPC.game && VPC.game.scene.getScene('Play');
if (!p || !p.sys.isActive() || !p.g) return 'menu';
return p.g.status === 'won' ? 'win' : p.g.status === 'lost' ? 'fail' : 'play';
};
VPC.Audio.load('pop', 'sounds/pop.mp3');
VPC.Audio.load('win', 'sounds/win.mp3');
VPC.boot({
background: '#FFE7CF',
fonts: ['700 20px Fredoka', '600 20px Fredoka'],
beforeStart: function () { BD.Store.migrate(); },
textures: function (scene) { BD.art.textures(scene); },
scenes: [BD.Home, BD.Levels, BD.Play],
first: function () { return BD.Store.brandNew ? 'Play' : 'Home'; },
});
