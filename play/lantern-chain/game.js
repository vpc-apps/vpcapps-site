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
var SONG = {
bpm: 96, steps: 32, voice: 'sine',
chords: [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]],
melody: [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 5, 4, 2, 1, -1],
scale: [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5],
};
function renderMusic() {
var beat = 60 / SONG.bpm / 2, steps = SONG.steps, rate = 22050, dur = beat * steps;
var O = window.OfflineAudioContext || window.webkitOfflineAudioContext;
if (!O) return Promise.reject(new Error('no OfflineAudioContext'));
var off = new O(1, Math.ceil(rate * dur), rate), out = off.destination;
for (var step = 0; step < steps; step++) {
var chord = SONG.chords[Math.floor(step / 8) % SONG.chords.length], at = step * beat;
if (step % 8 === 0) {
chord.forEach(function (f) { tone(off, out, f / 2, { at: at, type: 'sine', volume: 0.035, attack: 0.08, decay: beat * 7 }); });
tone(off, out, chord[0] / 4, { at: at, volume: 0.05, attack: 0.02, decay: beat * 3 });
}
var n = SONG.melody[step % SONG.melody.length];
if (n >= 0 && (step < steps - 8 || step % 2 === 0)) tone(off, out, SONG.scale[n], { at: at, type: SONG.voice, volume: 0.03, attack: 0.01, decay: beat * 1.6 });
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
/** Replaces the default music tune (call before boot). */
setSong: function (song) { Object.assign(SONG, song); },
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
if (ctx && !blurred) {
if (ctx.state === 'running') unlock();
else ctx.resume().then(function () { if (!unlocked && ctx.state === 'running') unlock(); }).catch(function () {});
}
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
gloss: 0.6, primaryGloss: 0.18, // top highlight alpha (dark themes: lower)
gloss: 0.6, // highlight band on plain buttons (dark themes: lower)
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
g.fillStyle(0xffffff, st.primary ? 0.18 : theme.gloss).fillRoundedRect(-w / 2 + 6 * u, -h / 2 + off + 4 * u, w - 12 * u, h * 0.32, Math.min(r, h * 0.16));
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
VPC.DailyUnlock = (function () {
var cfg = {
unlocked: function () { return false; },      // the Daily is open
daily: function () { return { doneToday: false, streak: 0 }; },
milestones: [],                                 // [{ day, hints, badge }]
lockedNote: 'Clear level 5 to unlock',          // string or function
saveKey: 'daily_card',
label: 'Daily Challenge', goal: 'DAILY CHALLENGE UNLOCKED!',
title: 'DAILY CHALLENGE\nUNLOCKED!', blurb: 'A new puzzle every day. Solve it to grow your streak.',
badgeWord: 'badge', play: 'Play Daily', next: 'Next level',
titleInk: '#FFFFFF', titleGlow: null, blurbInk: '#666666', headInk: '#FF4F87', dayInk: '#C98A00', rewardInk: '#222222',
goalInk: '#FFD34D', icon: 0xFFC23D, cardOpts: {}, noteInk: '#666666',
};
var api = {
setup: function (o) { Object.assign(cfg, o); return api; },
get cfg() { return cfg; },
get unlocked() { return !!cfg.unlocked(); },
get seen() { return VPC.Save.get(cfg.saveKey, false); },
markSeen: function () { VPC.Save.set(cfg.saveKey, true); },
/** The card is still owed: the Daily is open and the card was never shown. */
get pending() { return api.unlocked && !api.seen; },
/** Call before recording a win; the returned function says whether that win opened the Daily. */
watch: function () {
var was = api.unlocked;
return function () { return !was && api.unlocked; };
},
get goal() { return cfg.goal; },
/** The Daily Challenge button: locked (lock icon) until it opens, then the streak badge. */
button: function (scene, w, h, fontSize, onPress, extra) {
var on = api.unlocked, d = cfg.daily();
return VPC.UI.button(scene, Object.assign({
label: cfg.label, icon: on ? 'calendar' : 'lock', w: w, h: h, fontSize: fontSize, enabled: on,
badge: on ? (d.doneToday ? 'DONE' : d.streak > 0 ? d.streak + ' DAY' + (d.streak > 1 ? 'S' : '') : 'NEW') : '',
onPress: onPress,
}, extra || {}));
},
/** The line under a locked button ('' once open). */
note: function (scene, fontSize) {
var t = api.unlocked ? '' : typeof cfg.lockedNote === 'function' ? cfg.lockedNote() : cfg.lockedNote;
return VPC.UI.text(scene, 0, 0, t, fontSize || 15, cfg.noteInk, { weight: '600' });
},
/**
* The one-time card. Marks it seen. Returns the UI.card with .dailyUnlock,
* .primary (Play Daily, for Enter) and .btnLevel (Next level).
*/
card: function (scene, onPlay, onNext) {
var UI = VPC.UI;
api.markSeen();
var card = UI.card(scene, 330, function (card, u) {
var p = card.panel, y = 46 * u;
var cal = scene.add.image(0, y, 'vpc-icon-calendar').setTint(cfg.icon).setDisplaySize(64 * u, 64 * u);
p.add(cal);
VPC.Juice.popIn(scene, cal, 150, cal.scaleX);
y += 58 * u;
var glow = cfg.titleGlow ? { shadow: cfg.titleGlow, shadowY: 0, blur: 14, lineSpacing: -4 } : { lineSpacing: -4 };
p.add(UI.text(scene, 0, y, cfg.title, 26, cfg.titleInk, glow));
y += 56 * u;
var t = UI.text(scene, 0, y, cfg.blurb, 15, cfg.blurbInk, { wrap: 280, oy: 0, weight: '600' });
p.add(t);
y += t.height + 18 * u;
p.add(UI.text(scene, 0, y, 'STREAK REWARDS', 12, cfg.headInk));
y += 24 * u;
[['Every day', '+1 free hint']].concat(cfg.milestones.map(function (m) {
return ['Day ' + m.day, m.badge ? cfg.badgeWord : '+' + m.hints + ' bonus hints'];
})).forEach(function (r) {
p.add(UI.text(scene, -12 * u, y, r[0], 15, cfg.dayInk, { ox: 1 }));
p.add(UI.text(scene, 12 * u, y, r[1], 15, cfg.rewardInk, { ox: 0, weight: '600' }));
y += 24 * u;
});
y += 10 * u;
var play = UI.button(scene, { label: cfg.play, icon: 'calendar', primary: true, w: 260, h: 60, fontSize: 22, onPress: onPlay });
play.setPosition(0, y + 30 * u);
p.add(play);
card.primary = play;
y += 74 * u;
var lvl = UI.button(scene, { label: cfg.next, icon: 'next', w: 200, h: 50, fontSize: 18, onPress: onNext });
lvl.setPosition(0, y + 25 * u);
p.add(lvl);
card.btnLevel = lvl;
return y + 58 * u;
}, cfg.cardOpts);
card.dailyUnlock = true;
return card;
},
};
return api;
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
rewardedReady: function () {
var be = backend();
return api.rewardedSupported && !api.busy && Date.now() >= cooldownUntil && (!!fake || !be.rewardedReady || be.rewardedReady());
},
onChange: function (f) { listeners.push(f); return function () { listeners = listeners.filter(function (g) { return g !== f; }); }; },
init: function () {
var be = backend();
if (be.onQuiet) be.onQuiet(function (quiet) { VPC.Audio.duck('platform', quiet); });
if (be.onAdState) be.onAdState(notify);
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
var LC = window.LC || (window.LC = {});
LC.WEB_LEVEL1 = ['aaa,bbba,cccb,c',3,3,1,[1,0,2,1,3,2]];
LC.LEVELS = [
['caac,bbac,bbac,,',3,8,1,[0,3,0,4,0,3,1,3,1,4,2,3,2,4,1,2]],
['abca,accb,acbb,,',3,9,1,[1,3,1,4,0,1,0,4,0,3,0,1,2,3,2,4,1,2]],
['cbab,caca,abcb,,',3,10,1,[0,3,1,0,2,3,1,2,0,1,0,3,2,0,2,3,1,2,0,1]],
['dbba,bacb,cdda,cdac,,',4,11,1,[0,4,1,0,2,4,3,1,3,4,2,3,1,2,1,4,0,1,3,0,2,3]],
['badd,cbca,badd,cbca,,',4,12,1,[0,4,0,5,1,5,2,4,2,5,0,2,3,5,1,3,1,2,3,1,3,2,1,3]],
['cbba,ddba,cbda,cdac,,',4,12,1,[0,4,0,5,1,4,1,5,2,4,2,1,2,5,0,2,3,2,3,4,3,1,2,3]],
['abda,bcca,cbda,cddb,,',4,12,1,[0,4,0,5,1,4,2,4,2,5,0,2,0,4,3,2,3,5,1,3,2,1,2,3]],
['aadc,ebac,ddbe,babd,ecce,,',5,14,1,[0,5,1,5,3,0,0,6,1,0,3,1,3,0,1,3,2,1,2,3,2,6,4,1,4,5,1,4]],
['aeac,bdcb,ecbc,aedd,bdae,,',5,16,1,[0,5,2,5,1,2,1,5,1,6,2,1,2,5,3,6,3,2,0,3,0,2,0,3,4,2,4,3,4,6,1,4]],
['bacd,deae,cdab,edcc,aebb,,',5,15,1,[4,5,1,4,2,5,1,2,4,1,2,4,0,2,3,6,0,6,0,4,0,5,3,2,1,3,2,1,2,6]],
['abcd,bded,ebcb,cdac,eaae,,',5,15,1,[0,5,1,5,3,0,4,1,3,4,3,5,0,3,2,0,2,3,0,2,4,0,1,4,1,5,2,1,2,4]],
['abcc,bbcd,dcbe,aeda,eade,,',5,15,1,[0,5,4,6,1,4,1,5,0,1,2,6,2,1,2,5,3,0,3,2,3,6,0,3,4,2,4,3,4,6]],
['ddef,aaea,fbab,cccd,fdbe,fceb,,',6,16,1,[2,6,1,2,1,7,2,1,2,6,0,2,0,7,3,0,4,7,4,6,4,0,2,4,5,6,5,7,5,3,4,5]],
['bcac,abff,edfc,dbfd,aeac,bdee,,',6,18,1,[0,6,1,7,2,6,2,7,3,2,3,7,1,3,0,1,0,6,0,3,4,6,4,1,5,4,5,2,3,5,2,3,4,2,1,4]],
['aaed,abcc,febc,adbe,cfef,dfdb,,',6,18,1,[3,6,3,7,0,3,0,6,5,7,5,3,4,5,4,6,4,5,1,4,1,7,0,1,2,4,2,7,2,6,5,2,3,5,1,3]],
['eafc,dbba,ebdf,eafc,cdef,abcd,,',6,19,1,[2,6,4,6,5,2,0,5,0,6,1,0,1,7,2,1,2,7,4,2,4,1,3,4,3,6,0,3,0,2,5,4,5,7,3,5,2,3]],
['acdb,fced,edac,bfca,edba,bfef,,',6,20,1,[1,6,2,7,3,2,3,7,5,3,1,5,1,7,3,1,0,3,0,6,0,7,2,0,2,6,4,0,4,3,4,6,2,4,5,4,5,1,3,5]],
['afbd,acea,edec,bfdd,facb,fcbe,,',6,19,1,[0,6,2,7,3,6,4,0,4,7,1,4,2,1,2,6,1,2,1,7,4,1,3,4,0,3,0,4,0,1,5,2,5,3,5,7,4,5]],
['bffa,fgca,cdce,cgbe,egad,bdae,dfbg,,',7,23,1,[0,7,1,7,2,8,1,2,3,8,5,8,5,7,4,5,4,7,1,4,0,1,3,0,3,4,2,3,2,5,2,3,4,2,4,8,6,2,6,0,6,1,5,6,0,5]],
['bcef,ggbf,gfdc,dbed,aebd,faec,caag,,',7,21,1,[0,7,0,8,1,7,2,0,3,2,3,8,1,3,5,0,5,8,6,1,6,5,0,6,3,0,2,3,2,7,1,2,4,3,4,0,4,8,5,4,5,7]],
['cbcg,bgea,ddac,adaf,fegg,febd,cebf,,',7,22,1,[0,7,2,0,4,7,4,8,3,4,3,2,5,3,6,4,6,5,6,8,0,6,5,0,5,8,4,5,3,4,1,3,1,8,1,7,0,1,0,6,2,3,2,4]],
['cbdb,ffge,daca,dceg,egaa,fbeg,dbcf,,',7,22,1,[0,7,2,8,4,8,3,4,1,3,1,4,6,1,2,6,2,8,0,2,0,7,6,0,6,7,2,6,4,2,3,4,3,0,3,6,5,2,5,4,5,7,1,5]],
['dgdf,baef,agbg,fbce,ddac,bgcf,eaec,,',7,23,1,[2,7,4,8,6,8,3,6,3,8,3,2,0,3,1,3,5,3,5,8,5,7,2,5,2,7,4,2,0,4,0,7,0,4,1,0,1,2,1,5,6,0,6,2,0,6]],
['cega,fdbf,fefc,cdaa,gddb,agbc,bgee,,',7,21,1,[6,7,0,8,0,6,0,7,2,0,1,2,3,8,4,1,3,4,0,3,4,0,5,3,6,4,1,6,1,0,2,1,2,7,1,2,5,6,5,4,5,8]],
['fdgg,ebgd,efda,gbce,cfca,adcb,fabe,,',7,23,1,[5,7,0,8,1,0,1,8,1,7,3,1,6,1,6,7,2,6,2,0,4,6,4,3,2,4,1,2,0,1,4,0,3,4,3,7,3,8,5,4,5,1,6,5,0,6]],
['ehcf,ggce,cfha,ebfg,bdgh,acfd,ddah,abbe,,',8,23,1,[0,8,4,9,3,4,3,8,6,9,2,6,2,9,2,8,0,2,0,9,1,0,1,2,4,1,5,4,5,8,5,2,6,5,4,6,3,4,0,3,7,3,7,4,5,7]],
['acce,fbac,ehdd,fdhg,ecfg,behb,ggaa,dfbh,,',8,22,1,[1,8,7,9,5,7,5,9,0,5,0,8,1,0,6,0,3,6,3,9,2,3,2,9,2,5,4,6,7,1,4,7,4,8,5,4,1,5,7,1,3,7,1,3]],
['adcd,gbga,fhed,begg,facb,dfhe,hcce,fabh,,',8,25,1,[5,8,6,8,7,5,4,7,4,6,1,4,1,9,3,9,3,8,1,3,1,9,6,1,5,6,7,3,4,7,5,4,0,5,0,1,0,5,2,5,2,8,2,6,2,4,7,0,4,7]],
['achg,caab,cedd,befb,aefc,egdd,ghhf,ghbf,,',8,23,1,[2,8,5,8,0,5,0,9,4,0,6,4,6,9,5,6,2,5,2,0,4,2,4,5,7,2,3,7,3,2,3,5,1,3,1,4,0,1,0,4,7,3,7,9,6,7]],
['efhg,bbeg,ahgg,acff,cbda,bdce,ahdh,cfde,,',8,25,1,[0,8,0,9,1,8,2,8,2,9,3,0,4,2,5,1,3,5,2,3,0,2,1,0,6,9,4,6,1,4,6,1,6,9,3,6,7,0,7,1,7,2,5,7,5,1,4,5,4,7]],
['cgef,ahdb,dagb,cacf,afeh,fgeh,cebd,hgdb,,',8,27,1,[1,8,2,8,7,8,1,7,4,1,4,9,0,4,0,9,0,2,3,4,0,3,2,0,5,1,5,9,5,0,4,5,2,4,6,2,6,8,6,9,3,6,3,4,3,6,7,2,7,0,1,7,1,4]],
['eggf,dhcb,aggb,adeh,ebah,dfda,cfbh,cfec,,',8,26,1,[0,8,3,9,4,9,5,4,6,9,1,6,7,1,3,7,3,5,4,3,6,4,6,8,1,6,1,9,5,1,5,8,1,5,0,1,7,0,7,8,6,7,2,6,2,1,2,3,4,6,0,4]],
['ciha,dffg,gbhe,ceaf,cbci,daea,giib,bdhf,ehgd,,',9,29,1,[0,9,0,10,5,9,2,5,2,10,6,2,6,0,1,6,7,1,7,10,8,7,8,6,8,10,5,8,5,9,5,7,0,5,4,5,0,4,1,0,3,0,3,9,3,8,4,3,2,4,2,6,7,1,4,7,3,4]],
['ahig,bacf,cied,fgch,dabi,dbef,eedh,hbag,fgci,,',9,28,1,[0,9,0,10,3,0,4,10,6,0,2,6,7,9,8,10,3,8,3,9,1,3,5,3,2,5,2,10,1,2,1,7,4,1,7,4,7,1,0,7,4,0,6,4,5,6,5,1,4,5,8,2,8,9,3,8]],
['dbac,gdgc,egia,ihef,ihci,ghbf,dfdh,efae,bbac,,',9,30,1,[0,9,0,10,1,9,2,10,4,2,4,9,6,4,8,9,8,10,0,8,0,6,3,0,5,0,5,8,4,5,2,4,1,2,6,1,6,0,1,6,1,2,5,1,2,5,3,2,3,1,3,4,7,2,7,10,7,0,2,7]],
['bchg,beig,abdf,haeg,deed,fgii,facc,icad,bhfh,,',9,28,1,[0,9,1,9,3,9,8,0,2,8,7,2,6,10,7,6,7,10,1,7,1,3,5,7,5,9,8,5,0,8,0,10,0,1,3,0,3,6,8,3,1,8,2,1,2,8,4,1,4,0,1,4,6,2,5,6]],
['faeh,eibg,cfgb,afhb,heih,agcg,dfdc,adce,diib,,',9,29,1,[1,9,1,10,2,10,2,9,3,10,4,3,8,10,5,9,6,5,8,1,6,8,6,2,6,8,1,6,4,6,4,1,0,4,0,1,3,4,2,3,5,2,5,9,0,5,3,0,3,5,7,1,7,2,7,8,5,7]],
['bdag,hgea,hedg,cadi,feic,bibc,fife,dgbh,hcfa,,',9,31,1,[0,9,0,10,1,10,2,9,0,2,6,1,8,10,8,6,4,8,3,4,5,8,5,0,4,5,1,4,1,9,7,1,7,0,7,9,2,7,3,7,3,10,8,3,1,8,2,1,2,8,4,1,5,2,0,5,6,4,6,2,4,6]],
['ahdi,ebhf,bdih,fgci,dcbi,egca,dbgf,fecg,ahea,,',9,31,1,[0,9,7,10,3,9,3,7,3,10,1,3,2,1,2,9,0,2,1,0,4,9,1,4,6,3,6,10,4,6,7,4,1,7,0,1,5,0,8,0,8,7,8,1,0,8,4,0,2,4,5,0,5,10,6,2,4,6,7,5,3,7]],
['fdid,hiae,ceba,fbdc,fhgh,habg,cgfi,cedi,geab,,',9,32,1,[0,9,0,10,0,9,6,10,0,6,1,0,2,1,7,10,7,9,7,0,3,7,3,9,2,3,2,0,2,7,1,2,1,10,4,1,5,4,5,3,5,2,1,5,3,1,6,3,4,6,4,5,3,4,8,1,8,2,8,0,6,8,6,7]],
['ebha,deic,afhd,hfdb,gebi,ccab,gagi,gdhf,ecfi,,',9,29,1,[3,9,2,3,4,10,4,9,5,9,0,5,0,2,0,9,0,4,6,10,7,0,8,10,8,0,1,8,1,10,1,4,3,1,3,0,2,3,2,0,5,2,7,3,7,1,6,7,6,2,6,7,8,5,4,8,4,7]],
['igid,cbbi,bhae,edgf,fghc,cacd,ghbh,ffid,eeaa,,',9,26,1,[0,9,7,9,0,7,5,9,4,5,4,10,0,4,1,0,6,10,6,1,6,10,4,6,3,4,3,6,3,9,2,3,7,0,4,7,2,4,2,10,1,2,5,1,5,4,1,5,8,4,3,8]],
['cfga,ibea,ciga,fahf,dhbe,fchd,egci,hbbg,idde,,',9,28,1,[0,9,0,10,1,9,2,9,2,10,3,0,4,1,6,2,7,10,4,7,3,4,3,9,0,3,0,6,7,0,4,7,5,4,5,7,6,5,6,10,1,6,1,0,1,2,8,6,8,4,2,8,5,2,3,5]],
['caif,ifhb,daeg,bdbi,eadh,gfde,ceih,fgcc,ahbg,,',9,28,1,[4,9,6,9,1,10,1,9,0,1,6,0,5,6,5,4,5,1,2,5,2,6,8,5,8,10,8,9,2,8,4,2,4,8,6,4,7,6,7,5,1,7,0,1,0,8,0,6,3,1,3,10,3,2,3,10]],
['gbfc,iafa,dbea,edib,ihdh,ecbf,dhhc,figa,ggce,,',9,29,1,[0,9,1,10,0,1,2,10,3,0,6,9,4,6,7,10,8,2,8,9,7,8,3,7,3,4,2,3,0,2,0,8,6,0,4,6,4,0,7,4,1,7,1,10,1,4,2,1,2,6,5,7,5,1,5,9,3,5]],
['bede,cghf,faaf,hiih,dghb,fbcb,aiae,cgec,igdd,,',9,27,1,[0,9,6,9,0,10,0,9,4,0,3,4,5,0,7,5,7,9,8,10,7,8,5,7,5,0,1,5,2,5,6,2,3,6,1,3,1,8,1,7,4,3,4,1,4,10,8,1,6,8,2,6,2,5]],
['dcde,ceih,afdg,iacg,gihf,hfha,bdbf,ecbb,aieg,,',9,29,1,[4,9,6,9,2,10,3,10,8,10,0,8,0,2,3,0,5,3,5,4,5,9,1,5,4,5,1,4,8,1,8,4,3,8,4,3,4,10,7,4,6,4,2,6,2,9,2,8,7,0,1,7,0,1,6,0,4,6]],
['ebac,dcah,bagc,ffih,eidh,baci,eigg,dbhg,ffed,,',9,29,1,[0,9,0,10,2,9,7,2,3,7,5,3,5,9,5,10,5,0,1,5,1,10,1,9,4,5,1,4,2,1,2,10,0,2,6,1,3,6,7,5,7,2,4,7,8,7,0,8,4,0,6,0,4,6,8,6,3,8]],
['hgbe,idea,ihaf,bafc,egig,ehdc,fcbg,ihdc,dfba,,',9,30,1,[1,9,0,1,3,10,2,3,2,9,5,10,7,10,5,7,2,5,8,9,8,0,3,8,3,9,0,3,4,0,2,4,0,2,5,0,1,5,6,2,6,3,6,10,7,1,7,0,4,7,4,2,4,5,8,6,1,8,1,7]],
['dbfi,aggi,fcfd,haba,fchi,eeda,higb,dhec,egbc,,',9,29,1,[0,9,1,9,1,10,3,1,4,9,5,1,2,5,0,2,3,0,3,1,3,4,0,3,5,0,6,3,6,10,6,9,4,6,7,4,7,5,7,6,0,7,4,0,2,4,2,0,2,4,8,0,8,3,8,10,5,8]],
['bffc,eeig,chci,cidh,baeg,ddie,bhbh,gaaf,gdfa,,',9,27,1,[7,9,3,10,6,10,8,7,8,9,3,8,2,3,0,2,0,9,0,6,3,0,2,3,2,10,2,3,7,2,1,7,1,0,4,7,4,1,4,2,5,1,5,0,6,4,6,10,4,6,8,5,7,8]],
['bhei,bgca,aeeg,fdch,cifi,adfh,ddef,cbih,gabg,,',9,29,1,[0,9,7,10,3,10,4,7,5,10,7,9,6,5,0,6,0,10,7,0,7,3,5,7,4,7,4,9,3,4,3,5,3,7,6,3,5,6,1,5,1,4,2,1,2,3,2,5,8,1,8,0,8,5,1,8,0,1]],
['cafh,aedf,hbcd,idge,bifc,aacd,ebfg,iegh,ghbi,,',9,29,1,[1,9,5,1,4,5,4,9,8,4,0,10,0,9,7,10,6,7,6,9,8,6,8,10,7,8,3,7,3,8,1,3,1,7,0,1,5,0,1,5,2,1,2,0,2,6,2,10,3,1,4,3,6,4,7,6,3,7]],
['dagh,iice,dbhe,fabd,hich,bcag,dieg,ecaf,gfbf,,',9,30,1,[1,9,1,10,2,9,4,2,4,10,4,1,0,4,2,4,6,0,6,9,6,1,3,6,2,3,2,6,0,2,5,2,0,5,0,6,5,0,5,10,3,5,3,0,7,3,7,0,7,10,7,9,8,3,8,5,8,3,2,8]],
['hige,bcfh,gcfe,adbd,feda,hdah,aibc,gicf,gibe,,',9,32,1,[0,9,2,9,3,10,7,2,8,9,3,8,3,10,4,3,4,10,4,9,2,4,2,7,2,0,1,2,1,4,5,2,5,3,5,10,2,5,1,2,6,2,6,1,7,2,6,7,3,6,7,3,0,7,0,3,0,5,8,1,8,3,7,8]],
['afgg,face,ibbd,hjjc,heia,bebj,fgjh,dgei,fdac,icdh,,',10,31,1,[0,10,8,11,3,11,4,8,5,3,7,4,1,7,1,11,8,1,2,8,5,2,7,5,7,10,8,7,0,8,1,0,1,8,3,1,6,3,6,1,6,10,6,8,5,6,2,5,4,2,4,6,3,4,9,4,9,7,9,11,2,9]],
['eafb,ehgd,chcj,dfhd,gcei,icda,ggba,iajb,fifb,ehjj,,',10,32,1,[0,10,2,11,7,10,7,11,5,7,9,11,3,5,3,9,0,3,0,7,8,10,8,3,4,8,0,4,6,0,6,10,7,0,8,7,3,8,1,3,1,6,1,9,4,1,2,4,5,3,4,5,4,6,2,4,5,2,5,7,9,4,1,9]],
['eeji,aebc,jbfi,fceb,hhjf,ggag,ciah,gbja,dfdh,cidd,,',10,29,1,[0,10,2,10,4,2,4,0,6,4,7,6,8,4,8,11,2,8,3,2,9,11,9,10,1,9,1,2,1,3,6,1,6,10,6,9,2,6,0,2,3,0,3,9,7,2,7,6,5,7,5,1,5,7,8,3,8,11]],
['jdhe,ghaf,hiji,dcfi,gahb,cdde,bffb,bece,jaig,cgja,,',10,32,1,[0,10,7,10,2,11,3,11,1,3,5,10,9,1,2,9,2,11,0,2,0,5,9,0,8,9,8,11,1,8,1,2,1,9,3,1,3,7,5,3,7,5,7,10,4,7,4,2,6,7,6,1,6,7,4,6,8,6,0,8,9,4,5,9]],
['begg,gefc,jdfc,ahie,dcfh,jihb,fagc,bidh,ejjd,iaba,,',10,31,1,[1,10,2,10,1,2,3,1,6,10,1,11,0,1,0,11,5,0,4,5,6,1,9,6,9,0,6,9,2,6,4,6,4,10,2,4,8,4,2,8,5,2,3,5,3,2,7,2,7,4,5,7,8,5,8,11,9,3,7,9,0,7]],
['gjeh,haig,ifce,deaj,acea,fdhf,iibf,gdcj,gbbd,hbcj,,',10,32,1,[2,10,2,11,5,2,0,5,0,10,3,0,4,3,4,10,4,11,3,4,3,10,6,2,7,0,7,11,7,3,1,7,8,3,6,8,1,6,1,4,5,1,5,3,2,5,2,6,0,2,0,7,8,0,7,8,9,2,9,11,9,0,1,9]],
['hjgf,cdei,chgh,fjje,gdgj,hfdi,eabb,becd,cfaa,ibai,,',10,31,1,[8,10,0,8,5,11,1,11,3,1,4,3,9,11,4,0,4,5,0,4,9,10,6,9,6,10,1,6,5,1,5,8,2,5,2,4,5,2,0,5,2,0,3,5,8,3,2,8,1,2,1,8,7,2,7,8,7,6,9,7,9,11]],
['bcbj,ajeh,ebbg,gdca,ficc,dfij,ifea,hdad,hhjg,fieg,,',10,30,1,[0,10,5,10,2,11,0,2,4,0,4,5,8,11,8,10,1,8,9,11,9,1,5,9,4,5,0,4,2,0,1,2,1,10,3,1,3,4,6,1,6,2,7,3,6,5,7,1,3,7,3,11,9,6,5,9,7,5,7,8]],
['fece,fedb,hjgf,jgfh,chdb,cdhi,jgai,jbdc,aibe,igaa,,',10,34,1,[0,10,1,11,4,11,1,4,1,10,8,10,7,0,8,11,5,8,3,5,1,3,4,1,5,4,5,1,0,5,0,10,2,0,3,0,2,3,6,8,7,1,7,11,2,7,4,2,4,5,3,4,3,7,6,3,6,4,6,7,9,3,9,4,8,9,3,8]],
['acbj,jffc,hhag,hdhd,efbg,cibe,efjg,ejcg,ibai,idad,,',10,32,1,[2,10,3,11,4,10,6,10,0,6,0,4,7,10,0,7,2,0,3,2,3,11,2,3,4,2,9,11,9,0,9,11,8,9,8,0,8,2,8,9,4,8,5,4,5,2,5,9,1,5,1,8,6,1,6,8,4,6,7,5,7,1,6,7]],
['gghb,beaj,fiai,gjec,badc,ihfd,caej,ghid,hfed,jfcb,,',10,33,1,[5,10,7,10,2,7,8,10,0,11,9,11,3,9,3,8,1,3,1,2,6,3,1,6,1,11,6,1,2,6,7,2,0,7,8,1,5,8,5,7,2,5,8,2,7,8,0,7,6,0,4,6,4,10,4,0,4,11,9,6,9,2,3,9,3,7]],
['fdch,cibh,ddbj,gagf,abdb,ijfc,iiee,cegj,ahah,fjeg,,',10,31,1,[0,10,1,10,8,10,2,11,1,2,5,0,3,5,7,11,3,7,3,8,7,3,6,7,6,1,2,6,4,6,4,2,4,6,8,4,8,10,4,8,7,4,0,7,0,2,5,0,5,11,1,5,1,7,9,3,9,4,9,11,0,9]],
['jadc,deei,cbfg,bfhe,djij,abcg,hfai,jahc,hgei,dfbg,,',10,33,1,[1,10,1,11,3,11,6,10,8,10,8,11,2,8,5,8,0,5,0,1,0,6,4,0,4,10,0,4,8,0,3,8,2,3,9,0,2,9,5,2,7,2,7,8,6,7,3,6,5,3,7,5,4,7,1,4,6,1,6,8,9,3,9,1,4,9]],
['cgea,jbid,bieh,dgfc,iaja,gbah,fhbf,deji,cfje,hcdg,,',10,33,1,[0,10,8,0,4,10,4,8,4,10,7,4,7,11,0,7,8,11,6,8,9,0,1,9,1,4,1,6,1,11,7,1,9,7,3,9,3,8,0,3,9,0,2,9,2,1,2,4,5,9,5,10,5,2,3,5,3,7,6,2,6,9,8,6,0,8]],
['aefd,ecdb,jahi,jacf,gijj,gefb,aefh,bddc,ghib,ghic,,',10,33,1,[0,10,0,11,3,11,7,3,7,10,1,7,1,10,3,1,5,7,5,11,0,5,0,3,1,0,5,1,8,7,2,8,6,2,6,11,6,1,3,6,4,3,8,4,2,8,2,6,2,3,4,2,4,5,8,4,5,8,9,0,9,2,9,4,8,9]],
['ibdc,jcai,gjhj,fafb,decj,iedd,aegh,chgb,bhie,fagf,,',10,33,1,[7,10,3,10,9,3,7,9,6,7,4,11,0,4,2,11,2,7,2,11,6,2,8,6,1,8,9,2,1,9,4,1,4,6,0,4,5,4,10,0,5,10,6,10,8,5,9,6,3,9,3,6,3,9,7,3,1,7,1,11,8,3,0,8,0,5]],
['jgch,eadj,fcch,gdca,egaj,bibi,ihfj,badh,gife,fdeb,,',10,34,1,[0,10,7,10,2,10,0,2,6,11,1,11,1,7,3,1,4,11,4,1,0,4,0,11,1,0,8,1,6,8,6,10,5,6,9,5,9,1,7,9,7,0,5,7,5,6,5,7,2,5,3,5,8,2,8,6,4,8,1,4,3,1,3,8,9,1,2,9]],
['jejj,ghcj,ibdg,dbeg,agad,efad,bfaf,cich,eifh,hibc,,',10,33,1,[3,10,2,10,5,2,1,11,0,11,3,0,9,1,3,9,2,3,4,3,4,5,4,10,5,4,6,5,6,4,5,6,0,5,0,11,6,0,2,6,9,6,9,2,7,9,8,9,8,0,8,2,5,8,1,5,1,9,1,10,7,5,7,2,5,7]],
['cfga,fdhf,efjg,dbja,bihg,ajia,cjih,bcec,bdgd,eieh,,',10,35,1,[2,10,9,11,4,10,4,11,6,11,6,4,2,6,1,2,1,11,8,1,8,10,1,8,2,1,9,2,9,4,2,9,6,2,7,6,7,9,6,7,5,6,0,6,0,10,0,1,3,6,3,2,7,0,3,7,8,3,7,8,4,7,4,8,5,7,5,2,5,6]],
['jhac,dcbc,jheb,aebh,jiif,aice,geia,gjfg,dfdg,dbhf,,',10,35,1,[0,10,1,10,6,0,5,11,5,10,5,6,0,5,3,0,3,1,3,11,3,5,6,3,6,11,7,6,8,6,9,7,9,0,1,9,1,10,1,8,4,1,4,3,7,1,4,7,0,4,0,7,2,0,2,11,2,4,7,2,6,7,9,0,8,9,8,1,8,9]],
['cgeb,bjjd,ahfi,dfjc,gaag,kkhb,daie,kbfi,gdhc,iejk,fech,,',11,33,1,[10,11,8,10,8,11,1,8,1,12,0,1,5,1,5,11,9,5,9,12,9,0,2,9,7,9,7,2,7,1,5,7,0,5,4,0,6,5,6,9,4,6,0,4,3,0,3,12,2,3,2,11,6,2,6,8,10,0,10,5,3,10,8,3,4,8]],
['kggf,efjg,jhbe,acjd,kacb,hbdd,bkei,cidf,iiah,hgje,afck,,',11,33,1,[0,11,5,12,1,0,3,12,1,3,1,11,2,1,2,5,4,5,7,11,7,12,6,7,6,1,8,2,9,1,10,6,4,10,4,8,4,6,0,4,6,0,5,6,2,5,3,2,9,2,9,4,5,9,10,3,10,11,8,10,7,8,3,7,3,10]],
['kbig,gghj,jakk,cega,bihb,fjic,dedf,hdhc,ffdb,keij,ceaa,,',11,32,1,[3,11,0,3,10,11,10,12,5,10,0,5,4,0,7,10,8,0,7,4,8,7,6,8,6,7,6,12,7,6,4,7,5,4,1,5,1,7,3,1,3,12,3,10,4,3,0,4,2,0,2,11,5,2,5,8,9,2,9,3,9,12,0,9]],
['kgdf,acfa,ghhc,edbk,ajji,jhbi,ehje,kbii,dkgf,gbae,fccd,,',11,33,1,[2,11,5,12,4,12,7,12,5,7,5,2,4,5,1,4,0,1,10,0,10,11,1,10,1,11,1,4,2,1,8,10,2,8,7,2,3,7,3,2,0,3,8,0,8,7,3,8,6,3,6,5,6,1,3,6,9,6,9,4,9,2,0,9,0,7]],
['jice,jgea,jcgf,kakj,abhb,kebd,aikg,dcfc,idbg,hhhi,efdf,,',11,35,1,[2,11,2,12,6,12,7,2,7,11,2,7,3,2,3,6,1,3,0,1,8,12,10,11,5,10,5,8,1,5,1,12,1,2,0,1,7,1,9,0,10,7,10,11,5,10,6,5,0,6,0,2,4,0,4,9,4,0,3,4,3,5,8,0,8,7,6,8,4,6]],
['gdaj,hhig,bacc,kfeg,edbb,afef,chdj,hije,ikbf,idjg,kkac,,',11,33,1,[0,11,6,11,0,12,0,6,1,0,3,0,7,3,7,11,1,7,9,0,9,11,6,9,1,6,9,1,7,9,6,7,2,6,2,12,4,2,4,1,3,4,5,3,5,4,3,5,10,6,10,12,3,10,5,3,5,12,8,3,8,2,8,10,8,9]],
['dgcc,ckah,dfkf,bbfk,jeef,jbia,ihhc,hejk,aida,iged,bggj,,',11,33,1,[2,11,2,12,2,11,3,12,3,11,4,11,7,12,9,2,9,4,10,7,10,9,3,10,5,3,8,3,8,2,8,5,3,8,4,3,7,4,7,3,1,7,1,8,1,12,0,1,6,1,6,7,5,6,5,10,4,5,0,4,0,2,9,4,6,9]],
['adjb,kehh,ebha,jefc,khgj,gffk,dbcg,ifec,ajdi,cida,kgib,,',11,35,1,[0,11,10,11,4,0,6,4,7,6,8,10,6,12,3,12,6,11,8,6,0,8,0,6,2,0,9,0,9,6,10,9,4,10,1,4,7,1,3,7,3,1,8,3,0,8,2,0,2,11,1,2,4,0,1,4,5,4,5,1,7,1,9,7,9,12,10,5,4,10]],
['cfhg,jbig,heig,jjak,kcfc,ibcd,aeki,bhjh,aged,abed,kdff,,',11,35,1,[0,11,1,11,2,11,1,2,5,12,4,5,7,0,8,12,9,12,9,8,1,9,1,7,4,1,5,4,5,9,2,5,6,5,3,6,8,2,8,11,3,8,7,3,0,7,0,1,4,0,6,4,10,1,10,12,4,10,2,4,6,4,6,8,7,2,9,7,8,9]],
['abah,dhkd,iijk,bcef,cjad,kjif,abgg,bgfg,kfde,cehe,hcij,,',11,35,1,[3,11,3,12,5,11,8,12,1,8,2,1,9,12,0,9,10,2,5,10,2,5,10,2,10,3,9,10,9,12,9,3,5,9,1,5,1,10,4,1,0,4,8,1,8,11,5,8,6,5,0,6,4,0,4,9,3,4,3,6,7,5,7,11,7,5,6,7,0,6]],
['ebhi,agdk,hagk,ebid,khbe,ecac,ciff,bgjj,kadj,ffgc,ijhd,,',11,34,1,[3,11,0,3,10,11,10,0,8,10,8,11,9,12,5,12,8,5,1,8,1,11,1,9,2,8,5,1,12,5,2,12,2,1,0,2,9,12,6,9,3,6,0,3,4,0,4,3,4,2,4,8,7,4,7,12,3,7,0,3,10,4,6,10,5,6,3,5]],
['kffk,ajfa,kehh,egcb,dgab,kade,igjg,ihbi,hcdi,cfed,cbjj,,',11,34,1,[3,11,4,11,1,4,1,12,10,1,10,11,10,3,1,10,4,1,6,4,6,10,4,6,9,4,5,9,5,4,5,1,0,5,0,12,0,5,6,0,7,6,7,11,2,7,8,6,8,4,3,8,3,0,2,3,2,5,9,3,9,12,8,9,7,8,6,7]],
['gaba,hjjh,cdfa,kkbd,eief,gcih,ccek,akjg,deif,bfih,djgb,,',11,34,1,[1,11,1,12,1,11,9,11,5,11,5,1,9,1,4,9,8,9,8,1,4,8,4,1,8,4,3,8,10,3,7,10,7,12,6,7,6,4,5,6,10,5,10,12,8,10,9,8,3,9,7,3,0,7,0,9,0,7,0,5,2,7,2,8,2,10,2,6]],
['dikh,fafa,kdfi,heei,jbcb,bjah,dakg,ccgg,djke,cgfe,ihjb,,',11,34,1,[7,11,6,11,10,12,4,12,4,7,4,12,10,4,0,10,0,6,2,0,3,0,5,10,1,5,1,2,5,1,5,4,5,12,1,5,2,1,9,3,9,1,9,11,7,9,3,7,8,7,10,3,0,10,2,0,6,2,6,5,0,6,8,2,8,4,6,8]],
['cfjk,chbc,gbdj,dadk,aiif,kigg,jahe,kjeh,fbcf,beie,dagh,,',11,35,1,[6,11,9,11,7,6,7,11,2,7,7,12,0,7,0,12,3,7,2,3,4,0,8,0,1,8,2,1,5,2,5,4,5,7,4,5,9,5,9,11,1,9,6,1,6,4,6,12,1,6,8,1,8,9,0,8,0,1,10,6,10,2,10,4,3,10,3,4,3,10]],
['ckcf,hbgf,cdke,ekhd,faih,ijgj,dbed,aaka,bjhb,igjg,ceif,,',11,36,1,[5,11,5,12,5,11,9,12,9,11,9,12,5,9,10,5,0,5,1,5,1,12,8,1,4,8,4,9,7,4,10,9,2,10,2,7,3,2,6,2,6,10,1,6,3,1,7,3,4,7,4,5,3,4,8,1,8,11,6,8,2,6,0,2,0,4,0,2,10,3,2,10]],
['fkhe,agei,bfjj,fhcj,hggb,bded,ikcg,aibe,jakd,caid,fchk,,',11,35,1,[0,11,5,12,5,11,5,12,4,5,6,4,7,11,7,5,9,12,8,12,7,9,10,8,10,0,6,10,8,6,7,8,6,7,1,6,1,11,9,6,8,9,2,8,3,8,3,10,0,3,0,7,0,2,1,0,4,0,3,4,2,3,2,5,9,1,10,9,3,10]],
['feab,dbfb,chih,gdji,ejde,jgfi,ickg,cbak,akkf,hhjd,ceag,,',11,35,1,[7,11,6,12,6,11,10,12,7,10,0,7,1,7,8,1,8,11,0,8,4,0,9,4,10,8,10,0,6,10,3,6,3,9,4,3,5,6,9,4,2,9,2,6,2,9,2,10,7,2,7,10,4,7,0,4,1,0,1,2,3,1,3,12,5,0,5,12,5,7]],
['cjbj,fbbg,fehk,hbdi,kifk,ggda,eajc,ejci,dkge,hihf,daca,,',11,35,1,[0,11,10,12,5,12,6,10,6,11,6,12,8,6,1,8,0,1,0,11,10,0,10,12,5,10,8,5,2,8,4,8,9,4,2,9,2,6,4,2,3,4,3,10,7,4,7,0,7,11,6,7,1,6,1,2,3,6,4,1,8,4,8,10,9,3,9,1,3,9]],
['hgdg,jddi,jgjb,akfc,cigb,edkh,fikc,baif,hhae,ekba,ecjf,,',11,36,1,[1,11,9,12,4,9,0,4,0,1,4,0,4,11,3,4,6,4,7,3,7,11,7,12,2,7,9,7,6,9,6,11,3,6,3,9,3,12,0,3,5,0,10,6,2,10,2,3,10,2,10,4,8,10,8,12,0,8,1,0,1,2,5,1,5,0,5,10,9,1,9,10]],
['fech,cfac,kakh,jbgb,gkhc,gjfd,bdad,hjae,egdi,bijf,kiei,,',11,37,1,[5,11,6,11,9,5,8,12,8,11,10,12,7,10,6,7,6,11,3,6,3,8,3,6,9,3,9,12,6,9,7,6,7,3,0,7,1,0,1,6,2,7,5,1,5,3,8,5,10,8,10,12,2,10,2,6,2,10,4,2,0,2,0,8,1,0,1,2,4,7,4,10,4,5]],
['ehbi,gkhd,iagj,djhk,ebag,ccge,fkde,chij,baic,jfkf,bfda,,',11,36,1,[10,11,1,10,10,12,9,10,3,9,3,1,2,3,4,2,4,11,7,3,0,7,4,0,5,4,6,4,6,12,9,6,9,10,3,9,3,12,6,3,10,6,0,10,1,0,1,3,2,1,2,11,5,1,7,2,8,5,8,2,8,11,8,10,0,8,0,4,7,8,5,7]],
['jhag,gcec,adhf,cdhc,bdek,abai,kjef,gbif,fbgi,jehj,kkid,,',11,38,1,[5,11,8,11,0,8,0,5,7,12,2,12,7,11,2,0,6,12,10,2,10,11,4,10,4,6,2,4,5,2,5,7,2,5,0,2,9,0,9,2,6,9,0,6,4,0,7,4,8,7,8,4,8,12,9,8,6,9,6,10,3,6,1,6,1,8,1,6,1,7,3,2,3,0,3,6]],
['gifb,hdfb,hfhb,igcd,ggad,jeae,ibac,jcei,kakf,jcje,hdkk,,',11,38,1,[0,11,0,12,1,11,1,12,2,11,3,1,4,1,6,3,6,4,6,11,8,12,6,0,1,6,7,0,2,1,2,12,1,2,4,1,5,7,5,1,7,5,3,7,3,4,0,3,0,4,5,0,9,0,5,9,7,5,9,7,9,5,7,9,8,7,8,1,7,8,10,8,10,6,2,10]],
['bgfc,cbhe,ijhg,efch,kekd,kadb,jigd,cagi,kaje,jfdb,iahf,,',11,39,1,[4,11,6,11,10,12,3,10,0,3,0,12,0,6,5,0,5,11,9,0,9,11,12,9,2,12,6,12,7,6,7,12,5,7,4,5,1,4,2,1,8,4,2,8,2,6,1,2,1,0,3,1,10,2,7,10,1,7,3,1,4,3,4,5,9,1,8,9,8,4,5,8,10,4,6,10,6,9]],
['iake,jafi,dhcf,dkha,jhge,hbje,kibj,ccgg,ifgd,befk,dabc,,',11,35,1,[0,11,2,12,4,11,5,11,6,5,9,0,9,12,9,11,6,9,1,6,1,12,3,1,10,2,10,9,10,1,8,10,8,4,8,12,8,6,1,8,5,1,5,9,3,5,0,3,0,8,6,0,3,6,3,10,4,3,4,5,1,4,7,3,2,7,2,5,2,10]],
['cffg,aadd,dcee,cgag,gfka,jihe,kibc,jbhi,bfkh,kjbh,ijed,,',11,33,1,[2,11,5,11,5,12,6,2,7,5,7,12,6,7,5,6,8,12,9,12,9,7,9,5,9,8,1,9,4,1,10,9,10,11,10,5,6,10,4,6,8,6,4,8,0,4,3,4,3,1,3,4,2,3,2,9,0,2,0,3,8,2,7,8,5,7]],
['ejgf,dicb,kgkh,jfci,fhjk,djhc,fabi,abba,dkdc,ieha,egge,,',11,35,1,[1,11,1,12,3,1,3,12,0,3,5,12,2,5,4,2,6,1,6,11,7,6,7,11,6,7,3,6,4,3,5,4,5,3,8,12,5,8,0,5,0,3,9,7,10,0,10,5,0,10,4,0,4,6,9,0,9,10,1,9,8,1,2,8,2,5,8,2,1,8]],
['gihj,feca,hiaa,hfgc,jkec,ddib,fkke,kbad,bgih,jfjd,gceb,,',11,34,1,[1,11,1,12,2,11,3,12,4,12,6,1,4,1,4,6,0,4,8,0,8,2,8,3,5,8,5,2,7,5,7,11,7,8,6,7,9,5,9,4,6,9,1,6,9,1,4,9,2,4,0,2,0,4,3,0,3,1,2,3,10,8,10,6,10,12,0,10]],
['fgkh,bcee,hadc,ffib,ijhh,kaec,dcjb,ajkg,bdgd,eafj,igik,,',11,34,1,[2,11,5,11,8,2,7,8,10,7,1,12,1,11,3,1,3,10,5,12,6,1,9,6,9,3,5,9,7,5,6,7,6,11,2,6,2,9,0,2,0,5,4,2,8,0,8,6,1,8,0,1,0,3,4,0,7,0,9,7,9,12,10,4,10,1,4,10]],
['haic,hfeb,fikd,gcge,dkck,adjb,bhfg,jhka,cjae,gefb,jidi,,',11,37,1,[3,11,8,11,6,3,7,8,4,7,0,4,10,0,2,10,9,12,1,12,1,11,5,12,6,1,9,1,9,11,3,9,4,3,2,4,0,2,8,0,8,5,3,8,3,9,2,3,1,2,1,6,4,1,7,1,6,7,6,12,10,4,10,3,5,10,5,4,0,5,7,0,7,10]],
['hkej,kfig,kgdh,fcdj,ccce,aajb,befk,adig,ifji,dbhb,aghe,,',11,33,1,[0,11,0,12,3,11,4,12,6,0,10,12,2,10,2,3,1,2,7,2,8,7,8,11,8,6,1,8,6,1,6,12,5,6,5,11,7,8,3,7,3,4,1,3,0,1,9,6,9,0,9,6,7,9,5,7,2,5,1,2,10,0,10,5,7,10]],
['fcab,bjbk,kgce,khih,fbif,gdai,ddie,jeah,khag,ejfj,cgdc,,',11,35,1,[3,11,3,12,3,11,1,3,0,1,5,12,7,11,7,0,2,7,6,7,6,12,10,2,10,6,8,10,5,8,5,6,10,5,2,10,2,5,2,3,0,2,0,10,4,0,4,12,1,4,8,2,8,11,3,8,9,1,9,0,9,1,7,9,1,7,4,1,0,4]],
['chie,dfhd,dgac,efkg,hafe,khij,dgik,egjc,aafk,bbij,jbbc,,',11,34,1,[7,11,2,11,9,7,9,12,10,11,10,9,5,10,5,12,7,10,3,7,6,3,6,12,6,7,1,6,5,1,3,5,8,5,3,8,0,3,0,12,1,0,4,3,1,4,1,6,4,1,2,4,8,1,4,8,0,4,0,11,2,0,2,6,7,0,3,7]],
['ccea,aefi,ikgk,kdfh,gkjb,bceh,ifhe,jgad,bidg,dcjf,bajh,,',11,35,1,[3,11,3,12,5,11,6,5,6,11,6,12,1,6,1,12,9,12,7,3,0,7,1,0,7,1,8,7,8,3,6,8,0,6,5,6,5,0,4,5,4,9,2,4,2,7,4,2,7,4,9,7,9,0,3,9,2,3,8,2,5,8,10,11,10,7,10,1,8,10]],
['abfi,keki,hfch,jcid,egcg,deif,fhck,dahj,agbd,kjbj,baeg,,',11,37,1,[0,11,1,11,4,12,5,0,5,11,6,1,10,12,5,10,3,5,3,11,3,4,7,3,2,7,2,6,0,2,8,5,8,0,8,12,9,3,9,0,9,3,1,9,10,1,8,10,4,8,4,12,1,4,1,9,6,8,7,6,10,7,0,10,7,0,5,7,2,1,6,2,1,6]],
['djde,bidc,jahf,jiha,fbfk,egic,chhk,iefc,ajbg,baek,dgkg,,',11,35,1,[4,11,9,11,0,9,6,11,6,12,1,6,1,0,5,6,1,5,7,6,4,7,1,4,8,1,8,4,10,1,10,11,10,1,0,10,8,0,3,8,3,12,5,3,5,1,9,5,9,8,4,9,2,4,2,12,2,8,0,2,0,10,7,4,7,5,3,7,2,3]],
['debj,ecij,hadb,efdc,jhif,iiab,ggak,gfgh,cjkc,ekad,kbhf,,',11,35,1,[10,11,4,11,7,10,1,12,0,12,1,4,2,0,3,1,2,3,8,1,6,8,6,2,7,6,7,11,6,7,0,6,5,6,5,2,4,5,10,4,10,6,8,10,8,12,1,8,0,1,3,0,3,11,1,3,2,1,4,2,4,12,9,0,9,1,9,10,3,9]],
['hcbj,khid,fcha,ifbk,jeia,kaej,gdfa,dhge,jkic,fbeb,cgdg,,',11,36,1,[2,11,4,11,6,11,7,12,10,7,1,10,1,4,1,2,3,1,9,3,9,12,3,9,3,6,4,3,4,12,0,4,5,4,5,12,5,11,1,5,0,1,8,0,8,3,8,5,4,8,9,1,6,9,10,6,7,10,2,7,0,2,7,0,6,7,10,6,2,10,2,9]],
['hidf,egig,bhca,keck,khgg,jaci,efad,dafh,cbdj,fijj,kebb,,',11,34,1,[1,11,5,1,2,12,4,11,5,2,5,12,7,4,0,7,6,0,6,12,7,6,7,12,0,7,1,0,1,11,8,5,8,7,9,5,10,8,1,10,0,1,4,0,3,4,9,1,6,9,10,6,4,10,2,4,2,0,3,4,3,6,3,10,8,2,4,8]],
['jcek,ckik,gcjh,gbaj,hfhg,bfcd,iedk,dbaa,adie,ffeh,bgji,,',11,35,1,[0,11,0,12,1,11,6,11,5,6,0,5,3,0,8,12,8,1,6,8,6,12,1,6,1,11,5,1,10,6,10,0,4,10,2,4,2,0,2,1,2,10,8,2,3,8,7,8,3,7,10,3,7,10,2,7,4,2,4,5,2,4,9,4,9,12,5,9,5,10]],
['bbhd,ihad,hhja,fgek,cfeg,kdcj,fifc,bjbi,gdae,kgjc,kaei,,',11,35,1,[8,11,2,12,5,2,6,5,8,12,0,8,1,8,1,12,1,0,7,1,10,1,10,11,10,12,3,10,3,11,4,3,4,11,6,4,6,1,6,4,2,6,0,2,7,0,7,6,0,7,8,0,3,8,4,3,5,4,5,0,5,10,9,4,9,6,9,8,9,10]],
['habi,daif,eaaj,hghb,fefg,gdef,iikc,jdgb,dcck,hkck,ejbj,,',11,35,1,[3,11,6,12,7,11,4,7,1,4,0,1,0,11,9,6,9,12,6,9,1,6,0,1,0,3,8,0,8,12,9,0,3,9,7,3,8,7,1,8,7,1,2,7,2,8,10,7,10,11,10,7,2,10,4,2,4,10,2,4,5,4,5,10,5,1,3,5,3,9]],
['kdac,ebhg,jbkg,igfi,keec,kchf,effa,higd,jbdd,bcji,jaha,,',11,35,1,[0,11,0,12,4,11,6,12,5,6,7,0,2,7,10,12,5,10,5,11,5,2,6,5,6,4,1,6,7,6,3,7,3,5,3,6,7,3,1,7,9,3,10,7,10,12,9,10,9,11,1,9,4,1,2,4,2,9,2,10,0,2,0,4,8,2,8,9,8,10]],
['bhie,cdda,cgfc,jgib,kddk,faej,ifig,kbbf,hkag,jahe,cehj,,',11,35,1,[8,11,1,8,1,12,2,1,6,11,7,2,3,7,6,3,2,6,2,11,1,2,8,1,4,8,4,12,4,8,3,4,3,11,5,3,0,5,0,4,10,3,0,10,7,0,8,7,10,8,5,10,5,1,6,5,4,6,9,4,9,8,9,1,3,9,10,4,2,10]],
['jhbb,ekah,acff,gick,hjgk,adcj,jgfi,dfeh,kedi,bdib,acge,,',11,36,1,[8,11,6,11,9,12,0,12,1,0,7,0,9,11,8,9,7,8,10,8,7,6,9,7,9,12,2,9,6,9,6,10,5,6,2,5,2,1,5,2,5,7,1,5,3,1,3,2,3,11,4,1,4,3,4,6,0,4,0,6,10,3,10,2,5,10,8,0,1,8,0,1]],
['hgdi,egbf,jfhb,kfbk,eaig,cjhj,cddh,fjke,eckg,abai,acdi,,',11,36,1,[0,11,0,12,4,0,4,11,8,0,3,8,2,3,6,2,6,12,9,11,10,11,9,4,3,9,1,3,10,12,6,10,0,6,2,0,3,2,8,3,8,10,7,8,7,3,5,7,5,0,7,5,2,7,5,2,10,5,4,10,4,8,1,4,1,6,1,8,9,4,9,10]],
['bgfb,fddj,acjd,kgji,jece,fibe,eiak,hcad,icbf,ghag,hkhk,,',11,36,1,[5,11,0,5,4,11,8,0,5,12,3,5,1,3,2,1,8,12,4,8,4,11,2,4,3,4,8,2,5,8,0,5,0,3,0,12,1,0,1,5,2,1,7,0,7,2,7,1,9,3,9,2,9,7,3,9,6,3,6,2,6,8,6,11,10,3,10,7,10,3,7,10]],
['akck,gbbd,dbjd,ahfe,khah,gehc,difi,cabg,jifk,efji,jecg,,',11,36,1,[9,11,6,11,6,12,6,11,1,6,2,6,2,9,2,1,2,6,1,2,7,1,7,2,10,1,5,10,4,5,7,4,10,7,3,10,3,12,5,3,5,10,1,5,3,1,4,3,4,1,0,4,0,7,0,4,0,3,8,4,8,12,8,11,9,8,9,12,10,9,8,10]],
['khdg,gjfi,befh,hkbc,debi,kijc,ajik,efga,cjbg,ahcd,faed,,',11,36,1,[1,11,4,11,0,12,8,12,4,8,10,0,4,10,0,4,2,0,1,2,9,4,5,9,1,5,1,12,5,1,5,11,6,5,6,11,6,1,7,6,7,12,2,7,10,2,10,6,7,10,2,7,8,2,8,1,3,8,3,2,3,5,0,3,0,5,9,8,9,3,6,9]],
['giki,acfg,echg,efbe,adik,hcia,jjde,agjc,bkdk,fdbh,jbhf,,',11,36,1,[0,11,0,12,0,11,1,0,2,0,4,12,4,11,8,12,4,8,5,4,5,11,7,5,10,1,2,10,5,2,9,5,10,5,9,10,8,9,8,12,10,8,7,10,7,0,4,7,2,4,3,2,3,8,1,3,1,4,1,7,6,2,6,1,6,10,9,1,3,9,2,3]],
['abek,hcfc,gibb,fgfa,daki,hcih,dabg,jkhg,djej,ikde,jcef,,',11,37,1,[9,11,1,12,10,1,10,11,10,12,8,10,8,11,8,10,8,9,1,8,1,12,5,1,4,5,0,4,0,11,2,0,5,2,5,12,1,5,0,1,3,0,3,8,6,3,6,1,6,0,7,3,7,5,4,7,4,0,4,6,7,4,7,10,9,6,9,4,2,9,3,2,3,8]],
['cgak,gbjk,ihja,ibbc,efhd,ihka,jcdg,idhe,afbd,fkfc,eejg,,',11,37,1,[8,11,4,11,3,12,8,3,9,12,8,9,2,8,5,8,0,5,0,8,6,0,6,11,10,0,2,10,2,4,12,6,3,12,2,3,4,2,9,4,5,9,5,2,3,5,1,3,9,3,4,9,7,4,7,2,7,11,5,7,6,5,1,6,1,12,0,1,0,5,10,6,4,10]],
['ejec,gife,dbgd,ekbb,ijaj,gfka,icfh,djhh,gidf,cahk,cbka,,',11,37,1,[3,11,3,12,1,3,9,12,6,9,6,1,0,6,0,3,4,0,10,4,10,12,10,11,10,6,0,10,0,3,4,0,4,10,5,0,5,12,1,5,4,1,5,4,8,4,2,8,2,5,2,11,8,2,1,8,1,5,7,1,7,10,2,7,9,1,9,0,6,9,8,6,5,8]],
['bacj,cjfh,kied,kcjc,kdbe,dhbk,fahg,giff,eiha,gbej,gdia,,',11,37,1,[0,11,9,11,3,0,3,11,0,3,4,9,8,0,8,12,10,0,8,10,9,8,4,9,2,4,2,8,10,2,4,10,5,4,5,9,12,5,2,12,2,4,0,2,9,0,6,9,6,5,6,2,7,6,7,12,7,9,1,7,1,6,1,11,3,1,3,4,5,7,10,5,9,10]],
['akhd,djck,eecf,lieb,fjdg,ieil,glga,cjda,hfic,klbf,bajb,hgkh,,',12,38,1,[2,12,9,12,10,9,10,13,6,10,4,6,0,4,7,10,11,0,1,11,1,2,1,13,4,1,4,13,4,12,7,1,7,13,2,7,8,7,9,4,3,4,3,2,5,9,5,3,5,2,3,5,8,5,8,12,0,8,9,3,0,9,10,0,4,10,11,9,6,11,6,3,11,6,8,11]],
['hcli,jbcj,daee,igib,efcb,kace,ahgd,fkdj,ikak,lfgg,hdbj,hlfl,,',12,38,1,[3,12,0,3,4,12,9,13,11,0,11,9,0,11,4,0,4,9,2,4,5,4,5,0,5,2,8,5,8,2,8,5,3,8,3,13,3,8,10,3,1,3,7,3,6,7,6,13,10,12,7,10,7,5,9,7,11,9,6,11,2,6,10,2,10,11,0,10,0,11,1,10,1,12,1,3]],
['alfb,jahd,ijke,hldj,iigl,khef,ebcc,ghdk,gdfb,jbea,fgac,lick,,',12,37,1,[0,12,6,13,5,0,2,5,6,12,5,6,7,2,1,7,10,13,5,1,2,5,3,2,8,12,9,10,9,6,9,12,2,9,11,5,11,13,2,11,3,2,4,3,7,2,1,7,10,1,4,10,11,4,3,11,7,3,10,7,0,10,0,11,1,0,1,9,8,10,8,2,7,8]],
['cbha,kfge,bdef,hkjc,cjii,jfbl,hfkg,llld,gaae,igai,cedk,bjhd,,',12,37,1,[7,12,1,13,5,7,6,1,8,13,0,8,10,6,10,12,10,13,3,10,11,12,0,11,0,5,0,10,2,0,2,13,2,12,5,2,5,0,3,5,6,3,6,0,11,6,11,5,2,11,8,2,1,8,1,0,3,1,3,6,9,3,4,3,4,5,4,10,9,2,9,8,3,9]],
['hddb,eiik,dlee,agbj,cjbc,kghg,ibcj,allf,cjfg,hlka,iefh,adfk,,',12,37,1,[0,12,3,13,3,12,5,3,6,13,4,6,4,12,4,13,6,4,6,12,8,3,10,5,8,10,8,13,4,8,10,4,2,10,7,4,7,2,9,7,1,9,1,6,10,1,6,10,3,6,3,7,2,3,0,2,5,0,5,6,9,5,9,3,0,9,11,5,11,4,11,2,7,11]],
['lejb,idbc,afhc,laka,jgld,dhff,bkjj,beeg,ifhg,liai,hkgd,kcce,,',12,37,1,[8,12,7,12,5,13,8,5,8,13,9,8,3,9,11,7,2,11,2,5,2,13,9,2,8,9,1,8,0,1,11,8,11,3,7,11,1,7,4,1,10,1,10,12,3,10,3,2,3,4,10,3,5,10,1,5,9,1,4,9,4,12,0,4,0,11,0,9,6,4,6,3,6,7]],
['eifc,gjac,iche,kfgl,dlbd,fajl,hdie,ebda,hhgc,gbfk,bakl,jkji,,',12,38,1,[0,12,1,12,8,12,3,13,3,8,0,3,5,13,7,1,4,7,10,13,9,10,9,3,4,9,4,13,7,4,7,9,2,7,6,7,0,6,0,7,1,0,5,1,5,0,3,5,10,3,10,0,9,10,8,9,2,8,2,12,6,2,6,4,6,8,11,2,11,1,11,3,1,11,1,9]],
['jlie,dkjf,hlbj,bhgl,bchc,akki,adlg,jegi,ebhe,cffc,fidg,akad,,',12,39,1,[3,12,3,13,6,13,6,12,10,13,11,10,10,6,7,10,7,13,0,7,0,10,0,12,2,0,8,7,3,8,2,3,2,12,8,2,8,3,7,8,0,7,5,0,10,0,1,10,1,7,1,5,6,1,6,11,5,6,11,5,11,6,5,11,4,5,4,2,4,5,3,4,9,5,9,10,5,9]],
['hbej,aljc,ciga,gghc,dfbl,iehk,djfe,hkki,gblf,jfbd,laac,iked,,',12,38,1,[8,12,1,13,0,1,3,13,6,0,6,12,1,6,1,8,2,1,10,13,10,1,4,10,8,10,4,8,4,12,9,4,9,8,9,12,6,9,4,6,5,4,3,5,2,3,7,2,7,4,5,7,11,6,5,11,2,5,2,13,0,2,11,2,11,4,5,11,0,5,0,7,8,5,3,8]],
['icdd,ikac,khfj,ehhi,jdde,bbke,jfgh,ljag,lacl,bcaf,ibel,kfgg,,',12,37,1,[0,12,7,13,1,0,7,1,2,7,11,13,2,11,6,2,6,13,6,11,7,6,8,7,8,0,1,8,10,7,4,10,4,12,4,6,9,4,11,4,11,1,2,11,1,2,3,1,3,11,5,3,5,2,10,3,5,10,0,5,0,1,8,0,7,8,9,0,9,5,10,9,1,10]],
['kklb,bhic,dcaf,iged,kied,adhb,gjkl,glfa,fafe,lbih,ccjh,jegj,,',12,38,1,[10,12,9,12,11,10,7,13,2,7,2,13,1,2,1,9,1,12,0,1,5,1,5,12,3,5,4,5,3,4,6,0,11,3,4,11,9,4,9,1,0,9,6,0,10,6,2,10,5,2,5,13,8,5,11,5,6,11,3,6,4,3,0,4,7,0,7,9,6,7,8,0,8,13,0,8]],
['alkc,beke,jidb,gflf,kihl,icfd,hhdi,cahk,jgcd,ejlb,ebfa,gajg,,',12,38,1,[3,12,5,13,4,3,5,12,0,5,7,0,4,7,6,4,6,13,7,6,8,13,8,5,10,7,10,12,2,10,2,13,2,4,9,10,11,8,2,11,3,2,3,12,3,8,9,2,11,9,7,11,5,7,4,5,0,4,0,2,11,0,8,11,9,8,1,9,1,4,1,9,10,1,9,10]],
['afif,hjed,dbcb,falf,jalb,ajgk,ckkg,hhgk,icdl,eieb,gdcj,hiel,,',12,38,1,[2,12,4,12,8,4,1,8,5,13,6,5,6,13,2,6,2,12,7,13,8,2,8,6,9,12,9,1,9,8,1,9,10,1,10,6,10,2,5,10,1,5,7,10,1,7,4,1,11,1,11,9,11,8,7,11,3,7,0,7,0,8,0,7,0,4,3,1,4,3,5,4,3,5,3,7]],
['cffk,iehl,aajd,fbkk,ledg,lfad,cgie,kjbh,caig,bghl,bcjd,hiej,,',12,37,1,[2,12,6,13,5,12,10,12,11,2,11,13,6,11,4,6,4,12,4,13,1,4,9,4,1,9,1,13,11,1,7,11,9,11,9,6,7,9,7,10,0,7,3,7,9,3,2,9,5,2,0,5,10,9,0,10,6,0,6,10,8,0,8,1,8,2,10,8,3,10,5,3,4,5]],
['dbkg,hchk,illh,galj,bkgb,ikdc,lced,fefb,heaa,fjaj,eici,jfdg,,',12,38,1,[1,12,2,1,11,13,0,13,0,12,4,0,4,13,4,12,0,4,6,0,7,4,11,0,7,11,6,7,5,6,5,0,5,12,10,5,10,6,5,10,6,5,2,6,10,2,7,10,11,7,3,11,3,6,8,3,8,10,1,8,1,5,1,8,3,1,3,13,9,11,9,1,9,11,7,9]],
['jdcl,kkbd,hgch,bgbg,edia,egal,kafd,kiie,ffie,lbfj,jchl,chaj,,',12,38,1,[1,12,6,12,10,13,0,13,2,10,0,2,0,12,5,13,4,5,9,0,6,9,5,6,3,5,3,1,5,3,7,5,4,7,4,12,4,5,7,4,8,5,8,4,9,8,1,9,1,7,3,1,9,3,9,13,6,9,6,7,11,0,11,9,10,11,2,10,2,1,11,2,10,11,0,10]],
['gcdi,jihk,dfeg,lljb,afai,bjfb,aiac,jglk,ghee,ekfc,dhdk,hlcb,,',12,39,1,[0,12,1,13,4,12,7,13,10,13,0,10,6,0,4,6,9,0,9,4,9,13,8,9,8,1,2,8,2,9,4,2,6,4,6,12,4,6,0,4,0,8,3,0,5,0,11,0,11,4,7,11,7,8,3,7,11,3,1,11,1,12,1,7,2,1,5,1,5,7,0,5,10,2,10,11,2,10]],
['laca,ihbb,gbed,kahj,dekl,iiab,glej,dihf,hefc,fkcl,gjdk,jfcg,,',12,38,1,[0,12,0,13,0,12,4,0,8,13,7,8,9,0,9,13,4,9,10,9,2,10,4,2,10,4,3,10,3,7,3,12,6,10,9,3,8,9,6,8,6,0,11,6,11,13,11,9,10,11,6,10,1,6,5,6,5,12,7,1,5,7,2,5,2,6,2,10,8,5,1,8,7,1,4,7]],
['lecc,keib,ehcg,gali,dadk,baca,dfhd,ffbj,ifei,gbjg,lhjk,jkhl,,',12,38,1,[0,12,8,13,0,8,3,13,3,0,5,3,5,12,3,5,2,3,2,12,9,3,7,9,1,7,1,13,8,1,11,0,11,2,4,11,6,4,6,2,8,6,8,13,2,8,1,2,10,1,11,1,9,11,7,9,6,7,4,6,10,11,10,8,0,10,4,0,4,6,5,0,9,5,3,9]],
['ebfj,cdag,ihgb,hfel,affb,jhki,eakc,jkdi,kgcl,gdaj,bcll,idhe,,',12,38,1,[3,12,8,12,11,3,10,12,10,8,2,10,1,2,4,10,6,13,8,13,2,8,2,11,5,2,5,6,7,2,11,5,7,11,6,7,1,6,1,11,1,13,4,1,6,4,3,6,3,1,5,3,0,5,0,1,0,10,0,6,9,5,9,4,9,0,8,9,7,8,5,7,11,0,2,11]],
['gkjf,jkfc,ilbi,dabg,cidi,dheb,alla,fegg,khab,fchj,ejhd,ckel,,',12,38,1,[5,12,8,12,6,8,11,6,5,11,4,13,2,13,2,12,10,4,5,10,4,5,13,4,2,13,4,2,1,4,0,1,6,13,8,6,9,0,9,8,4,9,8,4,10,4,0,10,0,8,3,0,3,12,3,6,3,5,7,0,11,7,11,8,9,11,1,9,1,8,10,1,7,10,7,9]],
['ckbh,lelh,fkjg,lgii,jfia,khhj,cdae,ijeg,dcff,bdbk,lbga,dcae,,',12,38,1,[7,12,11,7,2,12,5,2,0,5,6,13,7,13,2,7,9,2,0,9,0,2,11,6,0,11,4,0,6,0,10,0,10,12,9,10,6,9,11,6,11,9,1,11,5,11,2,5,8,2,8,6,9,8,10,9,1,10,1,13,1,10,4,1,3,1,3,12,3,10,4,2,7,4,1,7]],
['heac,lbfk,kjgj,cffj,aake,jehd,lacb,lgfe,gbhi,hkil,bigd,dicd,,',12,38,1,[4,12,1,4,7,12,1,7,6,1,5,13,10,13,11,13,11,6,8,11,5,8,5,12,2,5,3,5,10,2,11,10,11,13,3,11,0,3,6,3,0,6,0,12,7,11,2,7,2,5,4,2,6,4,8,0,1,8,1,6,9,6,9,1,9,2,0,9,10,1,8,10,7,8,6,7]],
['lfeb,iaci,ieag,fjbj,gfll,hkkd,chak,jbgd,hchj,ligd,fkbc,deea,,',12,38,1,[6,12,11,6,11,13,5,11,9,11,7,11,7,9,0,7,0,13,12,5,7,12,3,7,3,12,3,7,0,3,4,0,3,4,5,3,8,7,8,5,10,8,10,12,10,3,4,10,2,4,9,4,1,9,1,8,1,2,1,9,2,1,2,13,6,1,6,5,8,6,5,8,9,2,0,9]],
['aecg,ijlk,bffb,chic,agfe,hdlj,gbej,ahfk,adle,ljgk,ddih,bick,,',12,38,1,[1,12,4,13,7,12,4,7,0,4,3,0,8,13,1,8,5,1,9,12,9,4,9,1,5,9,8,9,5,8,10,5,3,10,3,5,0,3,0,13,11,12,11,3,10,11,8,10,0,8,1,0,6,0,6,13,2,6,11,1,6,11,4,6,4,8,2,4,2,11,7,4,7,5,7,8]],
['heag,ajib,ecdb,fiaj,fidk,fcbh,klea,clkc,dhil,jfgg,behj,dklg,,',12,38,1,[0,12,6,0,11,12,8,11,8,13,5,8,1,5,1,13,3,1,9,12,10,1,10,8,10,6,2,10,5,10,7,5,4,7,2,4,5,2,5,9,11,5,7,11,7,5,2,7,6,2,6,5,11,6,4,11,4,13,9,4,1,9,0,1,0,2,3,1,3,13,3,4,8,0,8,11]],
['beig,bhgh,kcaa,kflj,abjk,fdec,ehej,lgdl,fiik,hjdb,cglc,iafd,,',12,38,1,[3,12,6,12,7,3,11,7,3,13,11,3,2,11,5,2,5,6,7,5,0,7,10,2,10,13,7,10,7,13,5,7,3,5,4,3,4,12,8,3,0,8,6,0,1,6,9,4,9,7,9,12,6,9,0,6,0,4,1,0,1,9,4,1,10,0,2,10,2,3,11,4,8,11,5,8]],
['dgfj,hike,bekg,gcli,ahic,fldl,jahb,cffe,jbda,kdli,beaj,kchg,,',12,39,1,[1,12,7,12,10,13,0,13,0,7,2,0,1,2,3,1,5,3,8,10,5,8,3,5,4,3,4,1,11,0,11,4,3,11,0,3,8,0,6,8,6,4,10,6,10,12,8,10,8,13,1,8,4,1,6,4,6,13,5,6,7,5,9,8,9,6,9,0,2,9,2,12,2,10,11,7,9,11]],
['ajli,hgdl,aehl,eggd,dcbe,diea,cbbf,kcjf,jfgj,lbfk,aiih,kckh,,',12,38,1,[0,12,2,0,11,2,9,11,7,9,8,7,2,13,10,13,10,12,5,10,2,5,2,10,6,2,9,2,9,6,0,9,1,9,3,1,7,0,8,3,8,2,0,8,0,10,3,0,4,3,5,3,5,12,1,5,1,0,1,13,4,1,4,7,4,5,6,1,7,6,11,7,11,6,7,11]],
['gjkc,bich,ddfl,ckgg,jafh,eblh,gkfk,bjil,hiae,jddi,lfea,caeb,,',12,38,1,[10,12,8,10,8,12,8,13,1,8,0,1,4,8,5,8,7,5,6,0,4,6,4,12,7,13,4,7,9,13,10,4,6,10,0,6,7,0,11,7,11,4,11,12,1,11,1,13,1,7,6,1,3,6,3,1,3,11,10,3,2,10,2,3,5,10,5,7,4,5,9,2,0,9,0,6]],
['fgch,kfdk,jiba,dblk,gcjd,jhfc,bgfk,hbij,gihl,elel,iace,edaa,,',12,39,1,[8,12,0,8,9,12,10,9,10,0,11,10,4,11,7,4,6,13,1,13,1,11,1,6,1,13,2,1,3,13,3,12,2,3,2,7,4,2,0,4,10,1,7,10,3,7,11,3,9,11,9,12,9,11,4,9,0,4,5,9,5,0,6,0,4,6,8,5,8,10,6,8,7,6,5,7,2,5]],
['kkhb,hegf,eahd,dgdg,hkbc,ifcg,bdaf,efai,clil,jalj,lejc,kibj,,',12,39,1,[5,12,3,12,2,3,10,5,9,10,8,9,7,8,7,13,1,7,1,12,6,7,6,13,3,6,3,12,6,3,0,6,2,0,2,13,2,1,9,2,9,13,10,9,1,10,0,1,11,9,11,6,8,11,2,8,7,2,10,7,8,10,4,8,4,6,0,4,5,8,5,2,11,5,4,11,1,4]],
['ibhg,badj,leab,klkd,ifab,kche,lihd,dgfj,cfak,ehcf,jcil,ejgg,,',12,39,1,[0,12,0,13,2,0,4,0,2,4,5,2,5,13,11,12,1,11,3,1,7,11,8,3,9,7,9,5,9,13,9,2,4,9,7,4,7,12,1,7,1,8,0,1,6,7,6,13,0,6,4,0,6,4,8,9,8,0,5,8,3,5,3,6,3,5,10,6,10,4,10,8,11,10,2,11,2,6]],
['defh,ijhb,gkgh,jkei,ahdk,cjdl,claa,eidb,gkgl,ebfa,ffji,clbc,,',12,39,1,[0,12,5,13,2,12,8,13,2,8,4,2,4,5,4,12,6,4,6,13,9,4,9,0,1,9,1,12,11,6,11,9,11,13,6,11,2,6,8,2,8,6,2,8,10,2,1,10,1,2,3,2,7,1,9,1,3,9,3,6,10,3,0,10,0,9,5,0,5,3,5,11,7,0,7,2,7,9]],
['gbia,ckgh,jeeb,biah,bfec,cfjj,gklh,gida,jlfk,lcfd,eakd,ihdl,,',12,39,1,[0,12,1,13,3,13,3,12,0,3,2,0,6,13,7,12,11,6,7,11,3,7,0,3,0,1,9,0,10,0,8,10,8,9,6,8,11,0,11,13,7,11,1,7,1,6,4,1,4,2,9,4,1,9,4,1,3,4,6,3,6,7,10,3,10,12,2,10,5,2,5,1,9,5,8,9,2,8]],
['djgj,hhcf,cidj,bhek,bfia,lbcd,lghe,lgle,cgak,fdik,biek,jfaa,,',12,39,1,[3,12,3,13,6,13,3,6,7,13,8,12,4,8,9,12,4,9,1,4,10,12,10,13,9,10,5,9,5,1,3,5,8,3,11,3,11,4,0,11,0,8,0,11,2,11,2,0,9,0,4,9,4,5,2,4,1,2,6,1,6,8,6,7,8,6,2,8,10,4,5,10,7,5,7,6,5,7]],
['ecfj,fiee,kdcb,ifdc,aaia,lcgh,iebl,dgkj,kbjh,dbhg,hkgl,jlfa,,',12,39,1,[9,12,8,9,7,8,6,13,2,6,10,13,10,12,10,7,5,10,5,12,5,2,5,13,9,10,6,9,1,6,11,5,4,5,4,1,4,5,2,4,3,4,2,3,7,2,7,12,3,7,3,11,1,3,11,1,11,13,0,11,0,1,0,4,6,0,3,6,8,11,8,3,2,8,9,3,7,9]],
['ceie,ibgf,hdcb,fgdk,fibf,jjil,ljba,dckl,eack,lghg,dhaj,keah,,',12,39,1,[9,12,11,9,6,11,2,6,9,13,9,12,5,9,7,9,8,7,8,2,11,8,0,11,0,5,11,0,3,11,7,11,2,7,2,3,2,13,8,2,0,8,7,0,3,7,3,12,1,3,1,12,4,3,1,4,5,1,10,5,10,2,10,13,7,10,4,7,4,1,3,4,6,7,6,5,6,9]],
['fjgk,iaab,eckg,fjai,bhfl,hjcl,fddl,bjia,cege,kdid,lhkc,hebg,,',12,39,1,[7,12,3,7,3,12,5,13,4,13,6,13,9,6,10,5,0,10,11,0,1,11,1,12,7,1,3,7,3,4,6,3,4,6,9,1,9,3,10,9,4,10,11,4,8,11,2,8,2,9,5,2,5,7,5,10,0,5,8,5,8,11,2,8,11,2,10,11,10,13,0,10,0,6,7,10,4,7]],
['fidj,hkcf,kajh,efkj,glce,ecjb,beic,ldhb,ifld,badl,kghg,gaai,,',12,39,1,[8,12,6,13,9,8,9,12,11,6,9,11,5,9,0,5,0,12,6,0,4,6,4,13,7,9,2,7,3,2,8,4,1,8,1,13,1,3,7,1,7,12,4,7,10,4,10,1,4,10,2,4,5,4,5,13,5,6,2,5,3,2,11,5,8,3,0,8,3,0,6,3,6,9,10,11,2,10]],
['gcgj,jaed,jbhe,hhii,kilf,ieca,ffbg,dkdk,dacc,kelj,lhbl,fabg,,',12,39,1,[6,12,11,12,11,6,5,11,9,13,0,13,0,12,0,5,0,12,5,0,2,5,8,0,11,8,4,11,4,9,3,4,2,3,6,2,6,11,2,6,2,13,8,2,1,8,1,5,1,2,1,13,5,1,4,5,7,4,7,8,7,4,7,8,10,7,9,7,9,1,4,9,10,6,10,3,7,10]],
['glha,iclg,kcjj,hfei,diae,dcdb,hgaf,jdje,blbk,egki,kbfc,fahl,,',12,39,1,[0,12,10,13,6,10,6,12,1,6,11,1,0,11,1,0,1,13,3,1,4,3,4,12,4,1,9,1,8,9,5,8,5,4,5,13,4,5,0,4,6,0,11,6,11,12,10,11,8,10,8,4,10,8,9,10,9,0,3,9,3,11,3,6,7,9,2,3,2,13,2,10,7,3,7,5,3,7]],
['hkli,ckka,hbea,lced,beib,jgjl,achf,fejl,cidg,dihj,gbff,agkd,,',12,39,1,[10,12,4,10,0,4,7,0,6,12,0,13,5,13,5,7,8,5,11,8,11,0,5,11,7,5,9,5,9,6,4,9,7,4,7,12,9,7,3,9,3,4,8,9,8,7,3,8,3,13,0,3,6,0,6,8,1,6,1,3,1,8,2,6,2,1,2,10,0,2,4,1,10,4,11,10,6,11]],
['bgkf,dcbh,kceb,gfka,bihj,elai,dgcl,ddli,hkle,ghac,jajf,jefi,,',12,40,1,[0,12,3,13,0,3,10,12,4,10,1,4,2,1,8,2,6,8,9,6,9,13,4,9,5,4,5,13,7,4,8,5,3,8,3,12,0,3,1,0,6,1,3,6,4,3,0,4,1,0,11,3,11,12,2,11,2,0,8,2,9,8,6,9,1,6,5,1,7,1,6,7,11,5,10,11,10,13,10,11]],
['clfk,ilhf,ddlj,aaba,ggei,cgib,jefk,ghfj,hlke,jehd,cbka,ibdc,,',12,39,1,[0,12,8,13,8,12,6,12,6,0,6,13,2,6,2,8,7,6,1,7,9,2,1,9,8,1,9,8,9,13,6,9,3,6,5,3,4,5,4,13,10,6,10,12,3,10,3,6,0,3,7,3,7,8,4,7,0,4,1,4,5,1,5,7,0,5,10,0,5,10,11,10,11,2,11,0,1,11]],
['cfla,adbc,dkjl,lbjf,efhi,fbaj,ceed,hkgi,abjg,kgci,dgeh,khli,,',12,39,1,[4,12,5,13,0,5,2,0,2,13,7,12,8,7,8,13,9,12,1,9,1,8,6,1,10,4,10,6,7,10,2,7,1,2,5,1,11,12,8,5,1,8,5,1,3,5,3,13,3,1,0,3,0,5,9,0,11,3,4,11,4,5,6,4,0,6,9,0,7,9,10,0,2,10,11,7,9,11]],
['aaii,gjdg,dbcb,jcki,haec,hidj,flgk,gaff,hecl,dkjb,lkfe,belh,,',12,39,1,[0,12,3,12,6,3,1,6,9,13,2,13,4,2,5,9,1,5,9,1,3,9,2,3,13,2,3,13,1,3,6,1,8,6,8,13,4,8,4,0,11,4,11,6,8,11,4,8,9,4,5,9,5,12,5,8,10,5,11,5,2,11,2,9,10,2,7,2,7,0,1,7,10,4,6,10,2,6]],
['dfgl,kiea,jfed,bjhh,dfkl,ihhb,jcel,gieg,gljc,abad,acbc,ikfk,,',12,39,1,[0,12,3,13,4,12,6,12,7,0,6,7,8,6,8,3,8,12,0,8,10,6,5,10,5,13,11,4,0,11,2,0,9,0,1,9,1,2,1,5,4,1,11,4,11,1,5,11,2,5,7,5,7,11,7,8,2,7,2,3,4,7,0,4,6,0,3,6,10,3,10,0,9,10,9,3,9,10]],
['kdge,dhfh,efld,dclg,bkka,ljab,iacf,gkhf,alje,igej,cjib,bcih,,',12,39,1,[7,12,1,7,1,12,6,12,11,1,5,13,4,5,10,13,11,10,11,6,11,13,1,11,2,1,7,11,4,7,4,13,9,4,0,9,3,0,2,3,2,12,8,2,8,4,3,8,6,3,5,6,5,4,8,5,6,8,9,2,0,9,0,1,7,0,9,7,6,9,10,9,10,4,3,10,1,3]],
['fijh,kfif,cidj,eafa,cgjc,gegh,elba,dblj,aeck,kghb,kilh,bdld,,',12,41,1,[0,12,0,13,2,13,5,12,7,13,10,12,11,2,11,7,2,11,2,0,4,2,4,13,4,5,2,4,7,2,9,7,9,12,5,9,10,2,10,0,8,10,8,4,8,5,3,8,1,3,6,8,6,7,6,2,5,6,9,5,9,10,0,9,1,9,1,0,1,10,3,0,3,8,3,6,11,1,7,11,1,7]],
['aklk,ebdc,jhdf,ifec,jfjl,igjb,gkac,dheb,lcga,eili,hdfa,ghkb,,',12,40,1,[3,12,1,12,2,13,1,2,5,1,6,12,7,1,3,7,3,13,8,6,9,3,4,9,4,5,4,13,5,4,8,5,8,12,9,8,3,9,0,3,0,8,0,3,6,0,6,3,5,6,9,5,7,9,10,0,10,13,2,10,2,7,2,4,1,2,1,9,11,2,11,3,7,11,10,7,11,10,6,11]],
['kehk,icec,ghjb,aleb,gigj,lbfi,kefd,aclf,falc,hdai,jdbk,hgdj,,',12,40,1,[1,12,1,13,1,12,5,1,7,5,8,12,8,7,9,1,8,9,5,8,3,5,3,13,7,3,7,12,9,7,6,9,6,8,6,13,0,6,10,6,10,5,9,10,0,9,0,13,0,6,2,0,4,2,5,0,3,5,3,7,10,3,2,10,2,9,2,4,11,10,11,3,4,11,4,1,11,4,9,11]],
['eifh,ejjl,cjlk,cajd,kbld,cafa,ghge,hkka,ldbi,hfib,igde,cbgf,,',12,40,1,[3,12,7,13,2,7,5,13,4,12,4,2,9,4,8,9,8,4,8,12,1,8,2,8,1,2,6,1,10,1,10,12,6,10,0,6,0,5,9,0,5,9,13,5,4,13,7,4,6,7,10,6,0,10,0,1,9,0,7,9,2,7,3,7,11,0,11,6,11,13,2,11,3,2,3,11,5,2,5,11]],
['blki,adid,cfcj,cflh,bgij,fiag,kecj,hbjk,gabd,heek,gehl,flda,,',12,40,1,[0,12,1,13,1,12,1,13,7,0,8,13,4,7,4,12,5,4,5,1,5,12,11,1,11,13,10,11,3,10,3,11,5,3,2,5,6,5,2,6,2,3,6,2,7,5,7,8,10,7,10,6,4,10,8,4,8,1,8,10,6,8,0,6,9,6,9,8,7,9,0,7,0,4,11,7,3,11,2,3]],
['jili,fbbc,djhc,fkeg,jldj,aieb,cgda,hgik,elfk,ehch,dalk,fbga,,',12,40,1,[0,12,7,13,7,12,3,7,8,13,10,13,10,0,6,10,11,10,11,7,5,11,3,5,3,13,3,8,0,3,0,12,4,0,4,6,4,3,0,4,7,0,9,7,2,9,2,7,2,4,6,2,6,0,1,6,9,6,9,7,5,9,5,12,10,5,2,10,1,2,8,1,8,3,8,9,11,2,1,11]],
['gded,cgac,ekba,ehfa,fcaj,lfhk,hjei,bili,dcjg,bfbi,hkkd,ljlg,,',12,40,1,[2,12,3,12,4,13,4,12,1,4,1,12,8,1,11,1,13,8,6,13,7,13,7,11,7,13,2,7,5,2,9,13,9,7,3,9,3,5,3,6,2,3,6,2,8,6,8,4,0,8,0,2,0,8,1,0,4,1,9,4,7,9,6,7,5,6,5,4,10,8,10,3,6,10,11,5,11,7,5,11]],
['cedj,acaf,kibh,bibk,eghd,iglk,ejaj,lhac,hdlc,jfdg,gblf,ekif,,',12,40,1,[1,12,11,12,10,12,8,13,7,13,1,7,1,13,7,1,2,7,8,10,4,8,4,7,9,4,9,8,9,12,6,9,6,1,9,6,8,9,7,8,10,7,2,10,2,11,3,2,3,10,5,2,5,7,5,4,3,5,10,3,4,10,11,5,11,2,4,11,0,4,0,9,0,11,0,13,6,4,6,11]],
['jidl,aglh,hghe,ebcj,ddbh,klib,gcgk,afid,iacl,ecff,kbfk,ajej,,',12,40,1,[0,12,8,12,7,0,3,13,3,8,11,13,2,11,4,2,3,4,11,3,13,11,4,13,0,4,5,13,5,0,5,12,6,5,7,0,10,5,10,7,10,13,5,10,7,5,9,5,8,9,8,7,0,8,11,0,7,11,9,7,3,9,2,3,1,3,1,12,1,2,1,11,6,2,6,7,2,6,2,3]],
['elbc,dfhc,dgbh,gdca,diai,lelf,jelg,gcab,fjik,kbih,ajhj,kefk,,',12,40,1,[4,12,2,13,3,4,0,3,9,13,7,0,9,12,9,2,8,9,8,12,10,8,10,13,10,8,4,10,4,12,7,10,3,7,4,3,0,4,2,4,6,2,6,0,11,9,5,11,5,0,5,6,0,5,6,0,8,6,11,8,11,0,9,11,1,9,1,13,1,8,1,3,7,9,2,7,3,2,3,7]],
['clfl,cjbd,kagc,dgii,bhci,dbfe,faih,eede,bhjl,hlfj,kgak,kgja,,',12,40,1,[4,12,2,4,3,12,2,3,2,13,10,2,10,13,10,3,2,10,11,13,9,11,5,2,5,9,7,2,1,7,5,1,7,5,2,7,3,2,3,5,11,3,11,2,10,11,0,10,8,10,8,3,6,8,6,12,6,13,0,6,0,10,4,0,4,8,1,4,1,3,0,1,9,6,9,10,8,9,4,8]],
['igal,lkac,gfef,dadh,gjji,iakf,hbkh,clgb,ekej,lihc,cbfj,dedb,,',12,40,1,[2,12,5,12,8,13,2,8,2,12,10,13,10,12,7,10,2,7,10,2,1,10,9,10,6,9,5,6,1,5,6,1,6,2,3,6,9,6,4,9,4,13,7,4,0,7,0,5,0,4,0,9,1,0,1,7,5,1,9,5,7,9,7,10,11,2,3,11,3,1,11,3,8,11,8,0,11,8,3,11]],
['kfgc,ibdh,hafh,abdl,ijfj,kdlg,aeef,jkgl,lkgd,iacc,beih,jebc,,',12,40,1,[5,12,8,13,7,5,7,8,8,12,8,7,3,8,3,13,5,8,5,13,5,7,0,5,0,12,6,0,9,5,11,5,11,3,6,11,6,9,0,6,7,0,4,7,4,6,7,4,2,7,1,7,1,13,1,3,2,6,2,9,2,7,10,7,1,10,11,1,4,11,10,4,10,1,3,10,9,3,4,9]],
['jcfj,jddb,ehld,kfgk,liba,kdal,ilei,hfbk,eaig,bhjc,cghc,eagf,,',12,40,1,[2,12,8,13,5,2,4,5,1,4,1,12,0,1,6,8,11,0,11,13,5,11,5,12,3,5,3,13,0,3,7,5,9,0,9,1,10,0,10,9,10,13,0,10,0,1,3,0,3,5,11,3,6,11,2,6,9,2,4,9,7,9,7,0,2,7,2,11,8,4,8,3,8,11,4,2,6,4,2,6]],
['kfbk,hbci,jdif,kieg,ldha,jglf,chdc,eaha,fljb,eacd,kebl,ijgg,,',12,40,1,[3,12,8,13,11,12,8,11,10,8,10,13,10,3,0,10,0,13,2,0,1,2,5,0,5,8,5,12,5,11,4,5,7,5,4,7,9,4,1,9,1,13,7,1,7,5,3,7,2,3,2,4,11,2,3,11,3,10,4,3,8,4,0,8,0,10,6,0,6,3,6,1,0,6,9,6,9,5,7,9]],
['khja,adjg,dcfi,bhkh,jdik,dbeb,fhcf,kgjg,ilei,flcb,elal,gcea,,',12,41,1,[5,12,9,12,9,13,10,9,11,10,5,11,12,5,11,12,11,13,1,11,7,11,7,1,7,11,4,7,8,4,8,12,8,9,2,8,4,8,6,2,6,13,3,6,3,7,3,6,5,3,4,5,1,4,5,1,6,5,2,6,2,13,1,2,0,1,0,4,0,5,0,7,9,0,6,9,10,1,10,0,10,12]],
['lidf,fcbj,hfhi,iikl,cbgj,bcdf,gekb,ahla,ahca,kgdg,lejd,jeke,,',12,41,1,[11,12,7,13,3,7,8,13,11,3,11,12,1,11,4,11,6,1,9,4,10,9,10,11,12,10,9,12,4,9,1,4,1,8,0,1,0,12,2,0,5,1,5,12,8,5,2,8,2,1,8,2,8,13,10,8,7,10,7,2,7,13,3,7,0,3,0,10,6,7,6,8,9,6,7,9,5,0,4,5,0,4]],
['fhfd,fhgj,abhd,fjjk,ilkc,jceb,idca,lele,lbik,gbea,ahcd,gkig,,',12,41,1,[0,12,2,12,10,12,3,13,1,3,4,10,4,13,8,13,11,1,8,11,5,8,7,5,4,7,11,4,11,13,1,11,1,2,1,0,5,1,10,5,2,10,8,2,7,8,7,1,7,8,2,7,6,2,9,2,9,1,9,7,9,11,5,9,3,5,0,3,6,9,6,12,4,6,0,4,0,3,10,4,2,10]],
['egia,bkec,lihl,jdjc,jech,lbjg,baeg,hbcd,ifga,ldaf,kfkh,idfk,,',12,41,1,[0,12,8,12,6,13,5,8,8,13,9,8,9,12,7,9,1,7,1,6,11,1,11,8,11,9,11,0,3,11,5,3,7,11,7,5,4,7,4,11,6,4,6,12,6,5,8,6,0,8,0,13,4,0,3,4,10,7,10,1,10,6,1,10,5,1,2,5,2,7,2,8,2,5,3,2,3,4,9,2,5,9]],
['cbfc,hgae,lbjd,dgla,kfbj,cefe,iehi,hgji,ajbl,filk,dgak,dckh,,',12,42,1,[4,12,7,13,6,13,7,12,11,6,10,11,3,10,8,3,8,4,8,12,10,8,7,10,6,7,1,6,1,8,1,10,1,7,5,1,6,1,6,13,4,6,5,4,5,1,0,5,0,4,0,6,0,5,10,0,2,10,2,12,2,6,3,2,3,0,3,10,11,3,9,3,9,2,9,13,4,9,3,4,11,5,10,11]],
['fhak,fbdg,echd,fjci,eiah,lial,ekfb,djbh,cbik,dcjg,kega,lgjl,,',12,43,1,[10,12,1,10,2,1,4,2,4,12,3,4,5,13,5,12,5,4,5,13,2,5,3,2,7,5,6,7,11,13,3,11,3,6,11,3,9,11,9,3,9,2,1,9,7,1,7,3,7,9,1,7,6,1,0,6,0,12,0,5,0,1,4,0,8,6,8,0,8,7,2,8,2,4,10,2,10,4,6,10,4,6,11,2,11,13]],
];
LC.DAILY = [
['dccb,eeed,daac,ebdc,abba,,',5,12,1,[0,5,0,6,1,0,2,6,3,6,3,0,3,5,1,3,4,2,4,5,2,4,0,2]],
['fcec,fbea,adfe,bdad,dbca,befc,,',6,20,1,[0,6,0,7,0,6,2,7,5,6,5,0,2,0,3,2,5,7,4,3,4,6,4,5,2,4,1,2,1,7,1,5,0,1,3,2,3,4,3,5]],
['bfab,beef,fdde,gcdc,gega,fdaa,gbcc,,',7,21,1,[2,7,4,8,5,8,2,5,1,2,1,7,0,1,0,8,0,2,0,1,3,0,6,0,6,1,4,6,4,7,4,6,3,4,3,0,3,6,5,4,2,5]],
['baba,ddef,fcaf,ccee,dbad,fecb,,',6,17,1,[0,6,3,7,5,0,5,3,5,7,1,5,1,7,2,5,2,6,2,3,2,5,4,1,4,6,0,4,0,6,4,0,1,4]],
['fggb,babe,ddcd,cfhe,cheb,gfac,dghh,aeaf,,',8,24,1,[1,8,6,9,3,8,3,9,4,1,4,8,4,9,5,4,7,3,7,5,7,8,5,7,5,3,6,5,2,6,2,4,2,6,1,2,0,2,0,5,1,7,1,2,3,0,3,4]],
['agbe,dabd,dfef,cgdf,cgcb,aebf,eagc,,',7,24,1,[2,7,0,2,0,8,3,7,1,3,1,8,4,8,5,7,5,8,2,5,2,7,3,2,0,3,0,1,3,0,4,3,4,0,3,4,6,4,6,0,6,1,5,6,1,5,1,2]],
['fidh,cbei,ihbg,acaf,gcab,aibe,cghd,hdfe,fedg,,',9,30,1,[4,9,5,10,5,9,1,5,1,10,1,9,7,10,3,7,3,4,1,3,6,1,0,6,0,1,0,5,7,0,7,1,6,7,2,6,2,9,2,7,5,2,4,5,8,6,4,3,6,4,3,6,3,5,8,1,8,10,0,8]],
['dbcb,ebea,cbee,ddaa,dcca,,',5,14,1,[0,5,1,6,3,6,4,6,0,4,0,5,0,3,1,0,1,5,0,1,2,1,2,5,4,2,3,4]],
['fbda,abff,eefc,eacb,dcca,eddb,,',6,16,1,[2,6,3,7,3,6,0,3,4,3,4,6,0,4,0,7,1,0,1,7,2,0,3,1,2,3,5,7,5,4,3,5]],
['fcfb,gbfc,eecc,dafg,deaa,bdgg,deba,,',7,20,1,[1,7,2,7,4,8,4,2,6,8,0,6,0,1,0,7,1,0,6,1,6,2,4,6,1,4,3,1,3,0,3,8,3,6,5,1,5,6,4,5]],
['ceac,bebb,daec,ffcd,dfaf,bade,,',6,18,1,[5,6,3,5,0,3,0,7,0,6,2,0,2,6,2,7,3,0,4,3,4,7,4,3,2,4,5,4,5,7,1,5,1,6,1,5]],
['dgba,febb,achf,gahe,bcga,fefd,gech,cdhd,,',8,26,1,[3,8,6,3,5,9,2,5,7,9,7,2,9,7,2,9,6,2,3,9,0,3,4,3,6,8,4,6,4,2,0,4,0,6,1,4,1,8,5,1,5,8,1,5,7,0,2,7,3,2,3,6]],
['adce,babc,edfa,cgbc,egda,beff,dgfg,,',7,23,1,[5,7,0,5,1,0,0,8,3,8,1,3,2,1,2,7,0,2,1,0,3,1,4,0,4,2,3,4,3,8,4,3,4,5,6,3,6,7,6,3,2,6,5,2,1,5]],
['idhe,bfdi,cafb,dfda,ehgg,egic,fcch,ibgh,baea,,',9,28,1,[3,9,4,10,6,4,5,6,1,5,1,3,7,4,7,10,2,7,1,2,1,7,4,1,0,4,0,1,3,0,2,3,2,9,6,2,3,6,0,3,5,0,5,10,4,5,8,9,8,5,8,9,7,8,0,7]],
['ecbe,cded,acba,dade,abcb,,',5,17,1,[4,5,0,6,0,5,0,4,0,6,3,6,1,3,1,6,3,1,2,3,2,5,4,2,4,5,3,4,1,3,2,1,2,4]],
['dcec,aabe,dbff,fabe,dbef,cdca,,',6,18,1,[1,6,1,7,3,6,3,7,3,1,2,3,2,7,4,3,4,6,4,7,2,4,5,1,0,5,0,6,5,0,5,4,0,5,0,4]],
['fecg,fefd,edce,fbdc,gaba,bdgg,baca,,',7,23,1,[1,7,4,8,6,8,3,6,3,7,3,4,3,1,6,3,6,8,4,6,4,8,0,4,0,3,2,0,2,3,2,7,0,2,1,0,1,2,0,1,5,4,5,7,5,6]],
['deda,aefc,cbfb,ecfa,fcad,bbed,,',6,19,1,[0,6,3,6,4,0,4,6,1,4,3,1,4,3,1,4,5,7,0,7,0,1,0,7,5,1,2,5,2,4,2,5,3,2,1,3,1,6]],
['hfaa,cade,fcbh,fgdd,hbgg,cbed,bagf,cehe,,',8,25,1,[0,8,3,9,6,0,3,6,0,3,5,9,7,5,0,7,4,0,6,0,6,8,4,6,2,4,2,6,7,4,1,7,1,9,1,8,1,2,5,1,5,6,2,5,2,3,7,1,5,7]],
['feag,ebaf,cgbg,abbf,cdcc,dfae,egdd,,',7,20,1,[0,7,2,7,2,8,2,7,4,2,6,4,6,7,5,6,0,5,0,6,1,0,3,0,3,8,1,3,1,8,1,6,5,3,5,0,4,5,2,4]],
['ebea,dfgi,caia,igcd,iegh,ffdf,hbbg,cabh,hecd,,',9,29,1,[6,9,6,10,4,6,4,9,7,6,7,10,0,7,0,4,0,10,2,7,4,0,4,2,3,4,8,4,3,8,3,9,1,3,1,9,2,3,5,1,5,4,1,5,1,4,2,1,7,1,2,7,8,7,8,0,6,8]],
['cacd,dcaa,bbac,edbe,ebed,,',5,15,1,[1,5,2,1,2,5,0,6,0,1,0,5,1,0,1,6,4,6,3,4,3,2,3,6,4,3,4,2,3,4]],
['cadb,bfbe,dcac,afed,eaff,bcde,,',6,19,1,[4,6,4,7,1,4,0,1,5,4,0,5,0,7,2,0,2,7,2,0,3,2,3,4,3,6,3,7,5,2,5,0,1,5,1,6,1,5]],
['egfc,dgae,bcae,gabf,ffcd,beda,dbcg,,',7,22,1,[0,7,3,0,5,8,4,5,4,7,0,4,6,0,6,7,3,6,3,8,0,3,1,0,1,8,1,3,2,0,2,8,2,7,2,6,5,1,5,0,6,5,1,6]],
['efba,edff,cdce,dbda,eabb,ccaf,,',6,18,1,[0,6,0,7,1,0,3,6,1,3,2,1,4,7,4,6,1,4,0,1,0,4,5,1,5,6,2,5,3,2,3,7,2,3,2,5]],
['bghe,gdbc,hbad,eahf,aghe,ccfd,cgaf,bfde,,',8,26,1,[2,8,5,8,6,5,2,6,7,9,0,9,4,9,0,4,7,8,5,7,1,5,1,2,1,8,0,1,0,2,3,0,7,0,2,7,3,2,4,2,4,1,3,4,3,9,6,4,6,1,5,6]],
['agac,ccba,gbbe,fcdd,gdfb,gdfe,eafe,,',7,21,1,[3,7,0,3,1,0,2,8,1,2,3,1,5,8,5,3,5,7,6,8,6,3,0,6,0,5,6,0,6,8,2,6,2,5,4,6,4,3,4,7,4,5]],
['gbcf,fage,eedh,ahid,diha,baif,bgei,bcfg,hccd,,',9,27,1,[6,9,1,6,7,1,5,7,5,9,4,5,2,4,3,2,3,9,4,3,4,9,2,4,6,2,1,6,1,5,0,1,0,10,7,1,7,10,0,7,6,0,6,7,8,4,8,10,3,8,5,3,5,7]],
['eedd,babc,aecd,cbcb,aeda,,',5,15,1,[0,5,2,5,1,2,3,1,2,6,2,0,3,6,1,3,1,2,3,1,3,6,4,2,4,5,4,0,2,4]],
['bcca,fded,edca,beab,ebaf,dcff,,',6,18,1,[0,6,0,7,2,6,2,7,1,2,3,0,3,6,1,3,1,2,4,1,4,6,0,4,5,1,5,7,2,5,3,2,4,3,2,4]],
['dgfa,deeb,ccgg,beaa,fgfc,dcbb,afed,,',7,19,1,[2,7,4,2,0,8,0,4,0,7,3,8,6,0,3,6,1,3,5,3,5,2,0,5,1,0,1,5,6,0,4,6,4,7,6,4,6,8]],
['fdda,affb,abcc,fdee,cebc,bead,,',6,17,1,[3,6,3,7,5,7,0,5,0,7,0,3,2,0,1,2,1,3,4,0,4,2,4,6,0,4,5,1,5,6,2,5,1,2]],
['ecfc,ahef,gahe,bgdc,gbdc,abdh,dfab,ehgf,,',8,27,1,[0,8,0,9,0,8,1,9,0,1,3,8,4,8,3,4,5,0,7,9,7,3,7,0,1,7,1,0,2,7,2,0,2,1,3,2,6,3,6,1,6,9,4,6,4,3,2,4,5,6,5,3,1,5]],
['ebbg,cfga,agdb,eadc,cbca,dede,ffgf,,',7,21,1,[0,7,0,8,2,8,5,0,5,2,5,0,2,5,2,7,1,2,1,7,4,2,3,4,3,5,3,2,0,3,6,1,6,7,1,6,4,1,4,8,1,4]],
['dhhb,eaie,cbdf,ibdf,cage,bgih,efgg,afid,chca,,',9,28,1,[2,9,3,9,2,3,0,2,0,10,3,0,7,0,3,2,5,10,5,3,6,5,6,9,1,6,1,3,4,6,7,3,7,9,1,7,1,6,4,1,4,7,5,1,2,5,2,4,8,7,8,4,8,10,4,8]],
['eace,adbd,dbce,aecc,adbb,,',5,15,1,[3,5,0,3,0,5,2,3,2,5,2,6,1,2,1,6,1,2,0,1,3,0,1,3,4,6,4,2,3,4]],
['cdbf,ecaf,dacf,afed,bdae,cebb,,',6,19,1,[0,6,1,6,2,6,0,7,3,0,4,3,1,4,1,2,3,1,3,6,4,3,0,4,2,0,2,3,4,2,4,7,5,7,5,1,0,5]],
['dbee,gbca,adaf,ffdg,ggcb,abcf,deec,,',7,20,1,[0,7,0,8,4,8,6,4,6,7,0,6,4,0,3,4,3,6,2,3,1,2,1,0,1,8,1,4,5,3,5,0,5,8,2,5,2,6,2,5]],
['cdbf,aeae,fdab,efcd,dbec,cbaf,,',6,20,1,[2,6,0,7,0,6,3,0,4,3,1,4,1,2,4,1,4,6,0,4,3,0,3,7,1,3,2,1,2,4,2,7,5,7,5,1,5,6,0,5]],
['afhe,cfdd,dhgg,gbef,aeeb,baga,hbdh,cfcc,,',8,23,1,[3,8,0,3,6,0,1,9,1,8,6,9,4,6,7,1,7,8,1,7,3,1,3,6,2,3,0,2,0,8,4,1,0,4,5,4,5,3,5,4,6,5,2,6,2,9]],
['bcgd,fgba,dbfa,gged,aaee,eccf,cbdf,,',7,19,1,[4,7,1,4,2,4,6,2,3,6,3,7,0,8,0,3,6,8,1,6,1,3,2,1,2,6,2,8,5,1,0,5,6,0,5,6,5,7]],
['aeei,fehe,fgga,bfbd,cgcb,biag,dcdi,hcdh,iafh,,',9,28,1,[1,9,5,10,2,5,2,10,8,1,2,8,1,2,1,9,7,2,8,1,5,8,0,5,0,9,6,5,6,7,8,0,5,8,4,5,4,6,4,10,6,4,3,6,3,5,3,1,3,5,7,6,7,4,2,7]],
['cbad,cbad,ebca,dbde,eace,,',5,18,1,[2,5,0,6,0,5,1,6,1,5,0,1,0,2,1,0,2,1,2,0,3,2,3,6,3,0,3,6,4,2,4,1,4,5,2,4]],
['aded,fcae,fabb,cadc,febe,fbcd,,',6,20,1,[0,6,0,7,0,6,1,7,1,0,3,1,3,6,3,0,1,3,4,7,5,6,5,3,2,5,2,0,1,2,4,1,4,7,2,4,5,1,4,5]],
['ddfa,bagb,feeg,dfea,bcdc,gcbg,eacf,,',7,21,1,[0,7,3,7,4,8,6,0,6,8,6,7,3,6,0,3,4,0,4,8,1,4,5,1,5,4,5,8,1,5,1,7,1,4,2,5,2,6,3,2,0,3]],
['ddcb,fece,beaa,acbe,dcbd,fffa,,',6,17,1,[1,6,3,6,0,3,0,1,4,0,2,7,2,6,3,2,1,3,1,6,4,2,5,7,1,5,3,1,3,7,4,1,0,4]],
['fgaa,fbbe,hdcd,fbcb,hecd,hhag,gagd,efec,,',8,25,1,[0,8,2,9,4,9,2,4,2,9,5,0,5,8,2,5,3,2,6,9,6,0,6,8,0,6,7,3,1,7,1,2,0,1,3,0,3,2,1,3,4,0,7,4,7,3,4,7,4,5]],
['cdfb,agbf,cbad,addf,eeec,gecb,gfag,,',7,21,1,[0,7,0,8,1,8,1,7,2,0,3,8,5,7,4,5,6,1,2,6,2,7,5,2,5,4,1,5,6,1,6,8,5,6,0,5,0,2,3,5,1,3]],
['gigb,iacb,cdec,bcia,geih,ehgd,ffad,bffh,hdea,,',9,28,1,[6,9,3,6,5,9,0,10,0,5,1,10,2,1,3,0,1,3,8,1,2,8,2,9,3,2,3,10,1,3,0,1,5,0,4,5,4,1,6,3,7,5,7,6,7,10,8,4,8,9,5,8,4,5,0,4]],
['ccae,ecbd,ebbd,abce,aadd,,',5,13,1,[1,5,1,6,2,5,2,6,0,2,3,2,1,3,1,2,4,5,0,4,3,0,3,6,3,4]],
['bcba,abcb,feae,dedc,adfe,dfcf,,',6,20,1,[2,6,0,2,1,0,1,7,0,1,0,7,1,0,2,1,2,6,3,7,4,6,4,2,3,4,3,6,3,4,5,2,5,7,5,2,4,5,1,4]],
['gbbd,ceda,cgec,dbgf,agfb,face,dfea,,',7,22,1,[4,7,3,4,5,8,2,5,2,8,2,3,5,2,1,5,0,1,0,7,3,0,3,7,1,3,1,8,1,2,6,5,6,8,4,6,4,0,5,4,6,5,3,6]],
['dace,fbde,fdfc,afea,abcb,debc,,',6,21,1,[0,6,0,7,1,6,2,7,3,0,3,6,2,3,1,2,4,1,4,7,1,4,1,3,4,1,0,4,0,2,5,7,5,1,5,6,2,5,3,2,3,4]],
['fefc,ched,aaeb,fhcd,ehhb,ddfg,gaga,cbgb,,',8,23,1,[2,8,4,8,4,9,2,4,6,2,7,8,6,7,6,2,5,6,7,6,7,8,0,7,0,5,0,4,5,0,1,5,1,4,1,9,1,7,3,5,3,7,3,9,0,3]],
['dbee,daae,fggc,fafc,cagb,gdfb,dbec,,',7,22,1,[0,7,1,7,5,0,4,0,6,8,2,8,3,8,3,5,4,2,4,1,4,8,0,4,6,7,6,4,0,6,1,0,1,6,3,0,5,3,5,6,2,5,2,3]],
['cbhg,bfid,fiie,adhc,ggab,gbae,fedd,eicc,ahhf,,',9,25,1,[1,9,1,10,6,9,2,6,2,10,1,2,4,1,5,6,4,5,0,4,8,2,0,8,0,1,3,0,7,0,7,10,6,7,2,6,3,2,3,9,5,3,5,1,4,5,8,2,3,8]],
['acbe,adde,aecb,bcea,bcdd,,',5,16,1,[0,5,1,5,1,6,2,0,3,1,3,5,2,3,2,5,1,2,3,1,0,3,0,1,0,2,4,6,4,1,3,4]],
['cbda,bfca,dece,cedd,fbaf,aebf,,',6,19,1,[2,6,0,7,1,7,2,1,2,6,0,2,3,2,3,6,1,3,4,1,4,7,5,1,4,0,1,4,0,1,0,3,5,1,5,6,5,7]],
['geda,gdaa,febg,abef,bgfc,ebfc,cdcd,,',7,23,1,[6,7,4,6,3,4,1,8,0,8,0,1,1,7,2,1,3,0,2,3,2,0,4,2,4,1,3,4,3,8,5,3,5,2,5,4,0,5,0,1,6,3,6,7,3,6]],
['cfed,ddca,aafb,fbda,cfeb,ceeb,,',6,17,1,[2,6,4,6,4,7,2,4,1,2,3,2,0,3,0,7,0,4,0,1,5,6,5,7,1,5,3,1,3,6,4,3,4,5]],
['habh,fcbe,dcdc,eaah,ghgd,acfb,efgg,febd,,',8,26,1,[5,8,6,9,5,6,2,5,4,2,4,9,0,4,0,8,3,4,0,3,4,0,4,9,5,4,3,5,1,3,1,8,1,4,6,1,3,6,7,3,2,3,2,4,2,3,7,8,7,6,1,7]],
['ddac,bfcc,dcfa,abbe,eede,ffgb,gagg,,',7,18,1,[0,7,1,7,2,0,1,2,5,1,3,8,3,1,0,3,4,8,4,0,4,8,5,4,2,5,2,7,0,2,6,4,6,3,4,6]],
['gcab,hfge,gbdc,fbig,haff,idac,eeid,bhdi,eahc,,',9,28,1,[2,9,2,10,0,2,5,9,0,5,0,9,3,0,6,10,3,6,2,3,0,2,5,0,5,10,6,5,1,6,1,2,4,1,4,0,7,5,7,10,7,4,3,7,1,3,1,4,8,9,8,4,8,0,6,8]],
['dbca,bbcc,ecae,dded,eaab,,',5,13,1,[0,5,0,6,1,6,0,1,3,0,2,3,2,5,2,6,3,2,0,3,4,1,4,5,2,4]],
['beac,afdf,fcac,babd,bdfe,dece,,',6,20,1,[0,6,2,6,0,2,0,7,4,7,1,4,3,1,0,3,5,7,5,6,5,7,1,5,4,1,4,5,3,4,2,3,2,6,1,2,3,1,3,4]],
['ggdb,afbc,feag,fdce,edga,fbce,dcba,,',7,23,1,[1,7,0,1,0,8,2,0,4,2,4,0,4,8,3,4,3,7,3,8,5,4,5,7,1,5,1,3,2,1,2,4,2,3,5,2,3,5,6,1,6,2,6,7,6,8]],
['fcdb,aefd,aabe,bbff,acce,dced,,',6,16,1,[2,6,0,2,5,0,4,5,4,7,5,6,5,7,0,5,0,7,1,5,1,0,1,6,1,4,3,0,2,3,2,4]],
['cgeh,afdg,dahb,bdba,afbd,fegg,cchc,hefe,,',8,25,1,[1,8,4,1,2,4,0,2,0,9,0,8,5,8,5,9,6,0,7,9,7,5,7,9,2,7,3,2,6,7,0,6,3,0,1,3,1,5,1,2,4,0,4,5,2,4,3,2,0,3]],
['afgb,cede,fgea,dgac,bcgd,dfbf,caeb,,',7,23,1,[1,7,4,1,4,8,3,4,2,3,2,7,2,8,5,2,0,5,0,8,0,2,3,0,3,8,1,3,1,7,4,1,5,4,5,2,3,5,6,4,6,7,6,0,1,6]],
['chdg,iafe,aebd,abac,ehic,ggid,gibf,hhff,dceb,,',9,27,1,[6,9,7,9,8,6,1,8,1,9,3,10,1,3,4,10,4,1,4,7,8,4,8,10,2,8,5,8,5,1,0,5,0,8,0,7,0,10,2,0,2,4,3,2,3,0,2,3,6,0,6,1,5,6]],
['dadb,beba,dece,baec,cdca,,',5,17,1,[1,5,0,1,2,6,4,5,4,2,0,4,0,5,4,0,2,4,2,6,0,2,3,4,3,6,3,5,1,3,1,6,1,3]],
['bdbf,bffc,daee,ddfc,acae,cbae,,',6,17,1,[0,6,2,7,4,7,4,2,1,4,1,6,0,1,3,4,3,6,0,3,0,1,5,7,5,2,5,1,4,5,2,4,2,3]],
['fcdg,fbda,gfbg,adeg,ccde,baef,abce,,',7,23,1,[4,7,6,7,2,8,0,8,0,4,0,6,3,8,3,7,4,3,5,0,5,7,1,5,6,4,2,6,0,2,1,0,1,6,2,1,2,8,3,0,5,3,6,5,3,6]],
['affe,cebc,dbae,cadd,fbbe,dfac,,',6,17,1,[0,6,2,6,4,6,4,7,0,4,2,0,2,7,3,2,3,0,1,3,1,7,1,6,1,3,5,3,5,0,5,4,2,5]],
['dfba,gbah,ffba,hecc,hgda,cbhg,eedd,egfc,,',8,22,1,[0,8,0,9,2,8,2,9,0,2,4,8,4,0,5,4,1,5,1,8,1,9,4,1,5,4,5,9,3,5,6,0,3,6,3,4,7,5,7,2,7,1,6,7]],
['fcef,bbgc,gdaf,gead,bbdc,gcda,eaef,,',7,23,1,[1,7,3,8,4,7,4,8,5,3,5,8,5,7,1,5,1,4,2,1,0,1,6,1,0,6,0,7,0,1,2,0,2,8,2,5,3,0,6,3,6,0,3,6,3,5]],
['aegd,fhde,cfcb,ahic,igbh,gfdg,biea,cefh,badi,,',9,30,1,[0,9,1,10,1,9,4,1,2,4,3,2,5,0,5,9,7,1,5,7,0,5,0,10,6,0,6,10,3,6,8,6,8,9,0,8,1,0,3,0,7,1,7,10,2,7,2,1,2,7,8,3,4,8,4,5,6,4,6,8]],
['aecd,aebe,cdea,cbab,dbcd,,',5,17,1,[1,5,1,6,1,5,2,1,2,5,0,2,3,6,3,1,3,6,0,3,0,5,0,1,4,2,4,3,4,6,2,4,2,3]],
['cfee,abaa,efcd,dcad,fbce,dbbf,,',6,18,1,[0,6,4,6,5,0,5,7,2,5,2,4,0,2,3,5,4,0,4,7,2,4,2,6,3,2,1,2,1,7,1,2,3,0,3,5]],
['egeb,ddcg,fcgc,eaed,bdff,aaga,bcfb,,',7,20,1,[1,7,1,8,2,8,2,7,2,8,3,1,4,2,4,1,0,4,0,3,0,7,3,0,5,3,5,7,3,5,0,3,6,4,6,2,6,8,4,6]],
['deca,aedf,bfdc,cebe,ffba,dcab,,',6,19,1,[3,6,5,3,0,5,2,0,1,7,1,2,1,6,4,1,5,1,0,5,0,6,2,0,2,7,3,2,3,6,4,2,4,7,5,3,0,5]],
['abhf,bagh,deaf,fhdd,dfbc,bgee,ccgh,ceag,,',8,24,1,[1,8,1,9,6,8,6,9,4,6,7,9,1,7,1,4,5,1,5,9,4,5,0,4,0,8,0,5,2,4,2,0,2,1,3,2,3,8,4,3,2,4,7,0,7,1,6,7]],
['gbed,gcea,ffaf,agdc,bcdd,begf,bcae,,',7,23,1,[0,7,0,8,4,7,3,4,3,7,6,8,1,6,1,8,1,4,1,3,4,1,0,4,3,0,6,3,6,1,4,6,5,4,2,4,2,3,2,4,5,0,5,8,5,6]],
['diga,hbfh,egah,egfa,bacf,dddh,fcci,bieb,cgei,,',9,28,1,[0,9,6,10,3,9,4,3,4,6,4,9,7,4,8,10,7,8,7,10,4,7,1,4,2,4,2,9,0,2,0,10,5,4,0,5,2,0,8,2,8,0,6,8,1,6,1,7,1,4,3,6,3,0,2,3]],
['eadb,bacc,cdad,aecd,ebeb,,',5,16,1,[2,5,3,5,4,6,0,6,0,5,2,0,2,5,1,2,0,1,0,4,3,2,4,3,4,6,3,4,1,3,1,6]],
['ddfb,cacb,ffae,aedf,deeb,bcca,,',6,16,1,[2,6,5,2,0,7,1,7,1,5,2,1,0,2,3,2,3,0,3,6,1,3,4,7,4,6,0,4,5,1,5,7]],
['accf,efeg,dabg,bgea,gdab,dcfd,efbc,,',7,22,1,[0,7,0,8,3,0,6,8,4,6,4,0,5,4,5,7,5,8,4,5,1,4,1,3,1,7,2,4,3,1,3,4,2,3,2,0,2,5,6,3,6,7,1,6]],
['febd,befc,eebc,cadb,ffca,adad,,',6,18,1,[0,6,5,6,4,5,2,4,3,2,3,6,5,3,5,6,3,5,1,3,4,3,1,4,2,7,0,7,0,1,0,4,1,2,1,7]],
['gfdf,hagc,fdae,bgag,edcb,hhfc,bbea,ched,,',8,25,1,[6,8,2,6,2,8,7,2,6,9,4,6,1,4,3,1,3,8,1,3,1,8,7,9,7,1,4,7,2,4,0,2,5,7,5,2,1,5,0,1,0,2,3,0,3,6,4,1,4,9]],
['afbc,dgcd,bfag,feeb,ccbg,ddfe,egaa,,',7,19,1,[2,7,4,7,3,4,5,3,6,8,2,8,2,5,4,2,0,4,0,2,5,0,1,5,1,4,1,6,1,5,6,7,3,6,0,3,0,8]],
['died,fgbh,cfag,gefb,ched,dacb,ecih,gaha,fibi,,',9,31,1,[1,9,1,10,2,1,3,10,5,10,6,9,7,2,7,9,2,7,2,3,2,5,8,6,7,2,1,7,3,1,8,10,6,8,5,6,5,2,0,5,0,3,4,5,4,3,4,9,6,4,3,6,3,7,0,3,0,5,8,3,1,8]],
['ddbd,bcce,baec,caba,aede,,',5,14,1,[1,5,2,1,2,5,3,2,4,5,0,4,0,3,4,0,4,5,2,4,3,2,3,4,1,3,1,2]],
['afab,fecc,dbbd,efba,aeec,fcdd,,',6,17,1,[0,6,1,7,3,0,3,6,4,7,1,4,3,1,4,3,0,4,0,1,0,4,5,0,2,0,2,6,0,2,5,7,1,5]],
['gegb,dadc,abbe,aeaf,cbgc,gdfc,efdf,,',7,23,1,[3,7,6,7,1,8,1,6,1,3,4,8,5,8,5,7,5,1,4,5,0,4,0,5,2,0,6,1,6,7,0,6,0,5,2,0,3,2,3,6,2,3,4,0,4,8]],
['cafa,cacc,eeaf,edbd,bfbf,dedb,,',6,19,1,[0,6,0,7,0,6,1,0,1,6,0,1,2,7,2,6,4,7,5,4,3,5,3,0,4,0,4,7,0,4,5,3,5,2,3,5,2,3]],
['habd,dffe,agde,cfha,bgce,bced,hgfc,agbh,,',8,26,1,[1,8,1,9,0,1,2,8,2,1,4,8,5,1,5,8,4,5,2,4,3,2,6,5,6,9,4,6,0,4,0,2,0,3,6,0,3,6,3,9,5,3,4,5,7,6,7,5,7,0,2,7]],
['feeg,ddge,ffba,cfgc,baad,cgeb,cdba,,',7,20,1,[0,7,0,8,1,8,1,7,4,1,2,4,5,2,5,8,5,7,3,5,3,7,0,3,4,0,2,4,3,2,3,5,6,0,6,4,6,1,5,6]],
['agcf,ahhi,bcbb,ibde,eifi,hfdc,egdc,adfg,gaeh,,',9,28,1,[0,9,0,10,5,10,6,10,5,6,5,9,7,0,7,9,8,5,3,8,3,7,2,3,2,10,3,2,1,3,1,5,4,3,4,9,4,3,8,4,1,8,6,1,0,6,0,8,7,1,8,7,6,8,4,6]],
['adac,edae,bbcd,eebc,badc,,',5,15,1,[0,5,2,6,2,5,3,5,3,2,1,3,0,1,0,6,1,0,1,6,1,3,4,5,4,6,4,0,2,4]],
['cdfd,bbaf,effb,eead,abac,cdce,,',6,18,1,[0,6,0,7,0,6,1,7,3,6,4,0,4,1,2,4,2,7,5,2,5,0,5,6,0,5,1,0,3,0,2,3,4,1,0,4]],
['dbga,aefb,beeg,abfg,ecfd,cgda,cfcd,,',7,22,1,[2,7,3,7,3,8,1,3,1,8,1,2,0,1,0,7,0,3,4,0,4,8,5,1,5,0,5,7,4,5,2,4,3,2,1,3,6,0,6,5,6,8,5,6]],
['eadb,edff,daef,bdca,bacf,ebcc,,',6,19,1,[1,6,2,6,3,7,4,6,3,4,1,3,1,2,4,1,4,7,0,4,0,3,0,7,2,0,2,7,3,2,3,4,5,1,5,4,0,5]],
['edbh,ggcg,gfba,afbd,aehh,hfae,ddfc,cebc,,',8,24,1,[0,8,0,9,3,0,3,9,4,8,5,4,2,5,2,9,2,3,1,2,7,1,7,9,7,4,1,7,1,2,3,1,5,3,5,1,5,8,6,7,6,1,0,6,4,0,3,4]],
['gdeb,edbc,acfg,bdae,cfag,cbfe,gfda,,',7,24,1,[4,7,2,7,2,8,1,2,0,1,3,0,4,3,4,8,2,4,3,2,6,2,3,6,1,3,6,1,6,8,6,7,1,6,0,1,0,6,0,7,5,1,5,8,5,3,4,5]],
['iffd,cfga,ddbi,hdee,iabh,gbgc,chai,chea,gbef,,',9,28,1,[1,9,3,10,0,3,7,9,7,10,4,7,8,0,8,10,4,8,4,9,2,4,2,8,3,2,6,4,6,9,6,3,5,6,1,5,7,3,6,7,0,6,0,4,1,6,1,7,8,0,5,8,5,0,5,8]],
['deaa,dcee,bebd,bcaa,ccdb,,',5,13,1,[0,5,0,6,1,6,2,0,3,5,1,3,0,1,4,2,4,1,3,4,2,3,2,6,2,3]],
['deab,bdcd,adff,fccb,faeb,acee,,',6,18,1,[5,6,4,7,0,7,3,7,3,5,2,3,1,2,4,6,0,4,0,6,2,0,2,4,1,2,1,0,1,7,5,2,4,5,3,4]],
['dbce,afge,bgdf,caeg,cfga,eddc,babf,,',7,22,1,[2,7,3,8,0,3,5,0,2,5,2,8,6,7,6,2,4,6,4,8,4,7,0,4,0,2,5,0,1,5,1,8,1,7,3,5,3,1,3,4,6,1,2,6]],
['dbfa,faae,deec,cfed,fdbb,ccab,,',6,17,1,[0,6,1,7,1,6,0,1,4,0,3,4,3,7,1,3,0,1,0,4,5,1,5,6,2,5,2,7,4,2,3,4,3,5]],
['bgfc,ebfd,fdgh,behd,daga,cegc,bfac,ehah,,',8,28,1,[2,8,4,9,7,8,4,2,4,7,1,4,3,4,3,8,7,9,7,8,7,3,5,7,0,7,0,1,0,5,6,7,6,9,1,6,0,1,2,0,2,4,5,0,3,5,1,3,5,1,5,7,6,2,3,6]],
['gfcg,fegd,bdgf,edac,bcbd,aeab,acfe,,',7,23,1,[1,7,0,1,0,8,3,8,4,7,5,4,3,5,3,7,6,3,0,6,1,0,1,3,2,1,2,0,2,7,4,2,4,8,2,4,6,1,6,8,5,6,5,3,5,6]],
['hhbd,aiea,ccbe,gidh,igfe,cfdf,dhba,ifea,gcgb,,',9,29,1,[2,9,4,9,5,4,0,5,0,2,3,0,1,10,1,9,6,10,7,10,7,9,4,7,8,6,4,8,1,4,1,10,2,1,6,1,6,0,3,6,3,4,5,6,8,3,2,8,5,2,7,2,4,7,8,5,3,8]],
['baea,aded,ddeb,ccbc,eacb,,',5,14,1,[4,5,2,5,3,4,3,5,4,3,0,4,0,2,4,0,2,4,1,2,1,4,1,2,0,1,0,5]],
['fcdd,fcae,ecbd,aabe,cbfa,fedb,,',6,18,1,[0,6,2,6,2,7,0,2,5,7,5,6,1,5,3,5,3,7,1,3,1,2,0,1,4,3,4,1,4,7,2,4,5,2,1,5]],
['becf,acbb,gaec,adda,bgfe,dgce,gffd,,',7,21,1,[0,7,0,8,2,8,2,0,3,2,4,0,4,7,6,3,6,7,4,6,1,4,1,8,1,2,0,1,0,4,5,1,5,8,5,6,3,5,2,3,2,6]],
['eaec,bead,defb,cfcb,bdaf,dafc,,',6,21,1,[4,6,0,7,5,7,5,6,4,5,1,4,1,5,1,0,2,1,2,6,0,2,3,1,3,7,3,6,3,7,0,3,2,0,2,4,5,3,4,5,1,4]],
['chfd,dfdb,babf,ccgd,ggee,eaca,hhhb,fgae,,',8,22,1,[5,8,1,9,0,1,2,0,2,9,2,8,2,9,6,9,1,2,0,1,0,6,3,2,5,0,5,8,4,5,3,4,0,3,7,5,7,8,7,4,1,7,1,2]],
['cbgd,feac,bgca,defa,egdb,bdfe,acfg,,',7,23,1,[6,7,0,8,0,7,4,0,4,8,4,7,5,4,6,5,1,6,2,1,2,6,2,7,0,2,6,0,1,6,1,4,3,6,3,1,3,4,3,8,5,1,5,8,2,5]],
['cgfh,cahe,ifhb,bega,aebi,gced,icdh,idfd,fgba,,',9,30,1,[0,9,1,10,1,9,3,1,6,9,5,6,5,10,8,1,2,8,2,9,0,2,0,3,0,5,6,0,5,6,3,5,3,10,7,0,7,2,7,0,4,7,4,3,4,10,1,4,6,1,6,7,8,3,8,5,2,8,2,7]],
['bada,edcb,caed,eecb,cadb,,',5,16,1,[0,5,0,6,0,5,1,0,2,6,3,0,1,3,1,6,1,2,4,0,4,6,4,5,3,4,2,3,2,5,2,4]],
['fbec,dfae,abbc,daed,abfc,dcef,,',6,20,1,[0,6,0,7,1,7,2,6,0,2,4,6,4,0,5,0,5,7,5,6,3,5,3,7,1,3,1,0,1,5,2,1,2,3,4,1,3,4,3,5]],
['fdea,bbgf,aeea,dfcg,gfbb,dacd,gcce,,',7,19,1,[6,7,6,8,3,6,3,8,1,3,1,6,4,1,3,4,5,3,5,8,0,5,0,7,0,3,2,5,2,7,4,0,4,6,5,2,3,5]],
['efab,cdfe,cadf,adec,bdfe,abcb,,',6,21,1,[2,6,5,7,0,7,3,5,1,3,1,6,1,2,5,1,5,7,0,5,0,6,3,0,2,3,2,5,1,2,3,1,3,5,4,0,4,6,4,1,4,7]],
['fdeb,ahee,ghfd,aacg,gfcd,hfbe,dcbb,chag,,',8,23,1,[0,8,0,9,1,9,2,0,4,0,5,9,5,8,2,5,1,2,6,8,4,6,4,5,3,4,3,6,1,3,7,4,7,3,7,2,6,7,0,6,5,0,2,5,2,4]],
['fegc,ddea,egfa,fafc,aceb,bgbd,gbcd,,',7,22,1,[0,7,3,7,2,8,1,8,2,3,0,2,1,0,5,1,4,5,4,0,4,7,4,8,6,1,6,7,5,6,5,2,6,5,2,6,0,2,3,0,3,8,0,3]],
['geea,gdha,ffcb,cbii,ehec,adhb,bgdh,igcd,faif,,',9,27,1,[6,9,7,6,2,10,7,2,5,10,5,9,6,5,6,7,6,10,5,6,0,5,1,5,1,9,1,6,7,1,3,7,3,10,2,3,4,3,4,0,4,9,0,4,0,1,8,2,8,7,8,5,2,8]],
['dbcd,eedc,aacb,ecad,abeb,,',5,15,1,[1,5,0,1,0,5,0,6,1,0,2,6,2,5,3,0,3,2,3,5,1,3,4,6,4,3,4,6,2,4]],
['fcbf,fcdc,aceb,dbfe,deba,aeda,,',6,21,1,[1,6,2,7,3,2,0,3,0,7,0,6,3,0,3,7,1,3,1,6,0,1,2,0,2,6,4,2,4,7,4,0,3,4,5,2,5,4,5,0,2,5]],
['gdca,agfc,bafe,bdae,bgbc,fgdd,efec,,',7,23,1,[1,7,4,7,5,8,6,7,3,6,0,3,0,7,0,8,5,0,1,5,1,0,3,1,3,8,4,3,4,0,3,4,6,3,2,3,2,5,2,1,2,4,6,5,3,6]],
['fcea,bbdf,bede,cbef,adcc,adaf,,',6,19,1,[2,6,4,7,4,2,0,4,0,6,0,7,1,0,3,0,3,6,5,0,5,4,1,5,1,3,2,1,2,6,3,2,3,7,5,1,4,5]],
['fdgb,aege,chdc,ceeh,abgf,badh,ffcd,habg,,',8,25,1,[1,8,1,9,1,8,7,9,0,7,0,9,6,0,2,6,2,0,3,2,3,8,5,2,6,3,4,6,4,9,7,4,1,7,0,1,0,6,5,1,5,7,4,5,7,4,2,7,2,3]],
['cdde,baeg,afcb,dega,gacg,cebf,ffbd,,',7,21,1,[0,7,6,0,2,6,1,8,1,7,3,1,3,8,3,7,0,3,2,0,4,8,4,0,1,4,5,2,5,1,5,7,0,5,6,1,2,6,4,2,4,8]],
['hcba,giie,ggaa,gaeh,fdec,ifhd,fced,bihc,dfbb,,',9,26,1,[7,9,1,10,4,9,4,10,5,4,7,5,6,4,6,10,6,9,7,1,8,7,6,8,0,6,0,7,0,9,2,6,3,0,3,10,3,6,2,3,5,0,8,5,4,8,5,4,1,5,1,3]],
['adde,ceca,baae,bedb,cbdc,,',5,15,1,[0,5,0,6,1,0,2,5,2,0,3,2,3,6,3,5,2,3,4,1,4,6,4,3,1,4,1,5,1,4]],
['fedf,fcad,dcbb,edea,baae,bccf,,',6,17,1,[3,6,4,3,4,6,2,4,2,7,1,2,1,6,1,7,0,1,0,2,3,0,3,2,0,3,0,1,5,1,5,7,4,5]],
['gaaf,edag,gdgd,cbaf,fecb,dbec,fbce,,',7,23,1,[4,7,5,4,6,5,0,8,3,8,3,0,3,7,4,3,5,4,5,7,2,5,1,2,6,3,6,7,6,8,0,6,1,6,1,5,2,0,2,5,0,2,4,1,4,8]],
['bfaf,dced,cedf,dbaa,cebb,caef,,',6,19,1,[0,6,0,7,0,6,2,6,1,2,3,7,3,0,2,3,1,2,4,0,2,4,1,2,1,3,4,1,2,4,5,6,5,1,5,7,4,5]],
['baea,dcdh,hged,bagd,egae,bccb,cffh,ghff,,',8,25,1,[0,8,4,0,4,8,7,9,1,7,3,1,4,3,0,4,0,8,5,0,6,7,6,9,5,6,0,5,2,0,1,0,1,6,0,1,2,4,3,2,3,8,3,5,7,0,2,7,0,2]],
['bgeg,cdbe,fadf,ccfe,cfbd,edba,agga,,',7,21,1,[0,7,3,0,2,3,2,8,4,8,5,2,5,4,5,8,0,5,0,7,1,5,1,0,1,8,4,0,3,4,1,3,6,2,6,7,2,6,4,2,3,4]],
['fgai,bhcg,cgce,fdeh,eehg,afbi,fdib,aiab,cdhd,,',9,30,1,[0,9,1,10,4,10,3,4,2,3,1,2,5,9,6,5,6,9,8,6,1,8,5,1,7,1,0,7,0,10,0,5,4,0,3,4,3,6,3,5,6,3,5,6,7,5,7,9,5,7,8,0,8,3,2,8,2,10,2,8]],
['bbaa,cdec,cede,deba,bacd,,',5,15,1,[0,5,2,6,3,5,3,0,3,6,2,3,2,6,1,2,1,6,1,3,1,2,4,3,4,2,4,5,0,4]],
['faba,dcee,cdfb,fcae,fdcb,abde,,',6,19,1,[1,6,2,7,3,6,0,3,0,7,3,0,1,3,4,7,4,3,4,1,2,4,2,1,3,2,3,4,5,6,5,1,5,7,0,5,0,4]],
['gfcc,bbeg,cecf,dada,fgab,adeb,fdeg,,',7,22,1,[1,7,1,8,4,1,3,4,5,1,5,8,3,5,4,3,4,7,2,4,6,7,6,8,5,6,3,5,6,3,4,6,0,4,0,6,0,7,2,4,2,8,2,4]],
['efad,fdea,cebc,cedf,bdca,fbba,,',6,19,1,[0,6,0,7,1,7,3,0,3,6,1,3,1,6,0,1,3,0,2,3,4,7,4,3,4,6,2,4,2,0,2,3,5,7,5,4,1,5]],
['dcgb,abab,eegf,dfhb,cdgd,hcgf,hcfh,eeaa,,',8,25,1,[0,8,0,9,1,8,3,8,6,3,5,6,5,9,0,5,4,0,4,9,0,4,2,0,2,9,6,0,5,6,3,5,3,0,4,3,6,4,5,6,1,5,1,8,1,5,7,5,2,7]],
['defc,geed,acfg,gbca,dgfc,babb,afde,,',7,22,1,[0,7,0,8,4,7,4,8,2,4,2,8,2,7,3,2,3,7,5,3,2,5,0,2,1,0,1,2,1,4,6,2,6,0,6,8,5,6,3,5,4,3,0,4]],
['eccf,cbfh,aibc,iadi,hdea,febh,ahgd,igdb,gegf,,',9,28,1,[6,9,7,10,7,9,6,7,1,6,0,1,2,0,2,10,3,2,3,9,4,3,5,6,5,10,5,4,1,5,1,10,0,1,4,0,4,9,6,4,3,6,2,3,2,6,8,5,8,7,8,0,7,8,3,7]],
['eeac,dedb,ccab,ebda,dabc,,',5,15,1,[1,5,2,5,2,6,0,2,0,6,3,6,1,3,0,1,4,2,4,5,4,6,3,4,3,5,1,3,1,4]],
['cfcb,edef,aabf,ccae,dafd,dbbe,,',6,18,1,[0,6,1,7,2,7,2,6,5,1,5,6,4,5,4,7,4,2,4,5,1,4,1,5,1,4,3,4,3,2,0,3,0,7,0,3]],
['ecag,afbg,cffc,fegd,dabe,gaed,dcbb,,',7,21,1,[6,7,2,6,0,8,1,8,1,7,1,2,0,1,0,6,4,0,4,7,4,1,3,4,3,8,3,0,2,3,5,4,5,0,5,1,5,8,6,2,4,6]],
['daac,efdb,eacc,dcba,febf,fbed,,',6,19,1,[0,6,0,7,2,6,2,7,3,7,1,3,0,1,3,0,3,6,1,3,4,1,4,0,2,4,5,3,5,4,5,0,1,5,4,1,4,5]],
['ecfe,gcbh,ggha,aaec,eafh,fbdh,bbdf,cgdd,,',8,22,1,[1,8,4,8,5,8,5,9,1,5,3,1,0,3,6,4,6,9,5,6,0,5,0,1,3,0,2,3,2,8,4,5,4,3,0,4,7,9,7,2,1,7,1,2]],
['ggeg,dfcg,daee,cedf,abbf,dcac,abfb,,',7,22,1,[2,7,6,8,4,6,4,8,4,2,3,4,6,4,6,8,2,6,3,2,3,7,5,3,5,6,5,3,2,5,1,2,0,2,0,7,0,2,1,3,1,4,1,5]],
['acib,addh,ebei,bihc,fggh,hcgc,bffa,eade,gidf,,',9,27,1,[2,9,3,10,7,2,4,3,5,10,5,4,5,10,1,5,3,5,3,9,0,3,0,9,0,10,6,0,7,1,0,7,1,0,7,1,2,7,2,3,2,7,8,6,8,0,8,9,4,8,6,4,3,6]],
['adee,eacb,dcba,debd,cbca,,',5,16,1,[1,5,0,6,3,0,3,5,3,6,0,3,2,0,2,5,1,2,1,0,1,6,4,0,4,2,4,5,2,4,2,3]],
['bfcf,ceaf,cbfb,daad,cdea,beed,,',6,19,1,[0,6,1,6,1,7,4,7,1,4,0,1,0,6,2,0,2,6,0,2,4,0,3,4,3,7,4,3,1,4,5,3,5,0,2,5,2,4]],
['acdb,gdca,dgae,bfec,ggfd,cffe,ebab,,',7,21,1,[0,7,4,0,4,8,6,7,1,6,3,1,5,3,5,8,1,5,0,1,0,5,6,0,6,7,2,6,2,0,2,4,1,2,1,4,3,6,3,8,3,7]],
['afbd,edbb,befa,cade,edfc,facc,,',6,18,1,[0,6,0,7,1,7,1,6,3,1,3,6,2,3,0,2,3,0,4,3,5,3,5,0,2,5,1,2,4,5,4,6,2,4,2,7]],
['dedb,geaa,feba,fhbg,hehb,cgdg,cfhf,ccad,,',8,25,1,[0,8,1,9,2,9,2,8,1,2,3,1,3,8,4,8,4,3,2,4,5,1,0,5,6,2,6,3,2,6,0,2,4,2,3,4,5,0,5,1,6,3,5,6,7,0,7,9,6,7]],
['gdga,egfd,ecaf,fecc,agbd,bdbf,abce,,',7,22,1,[1,7,2,1,0,2,3,8,4,7,6,3,6,8,4,6,0,4,0,7,4,0,2,4,2,8,3,2,1,3,1,0,1,2,5,3,5,6,5,7,6,5,4,6]],
['iadb,badg,ghfc,ffdc,cghd,aeah,hifb,egic,ieeb,,',9,27,1,[4,9,5,4,2,10,3,10,3,9,2,3,4,2,1,4,1,9,1,5,0,1,0,9,5,0,6,1,6,3,7,10,6,7,2,6,4,2,4,10,8,1,5,8,0,5,7,0,7,2,8,7,0,8]],
['cbde,dcab,dbab,adec,eeca,,',5,16,1,[1,5,2,5,1,2,3,1,0,3,3,6,0,3,0,5,1,0,3,1,2,3,2,5,1,2,4,3,4,0,4,6]],
['cdeb,aabe,fcfb,edcb,adfa,efcd,,',6,19,1,[0,6,1,0,1,6,2,6,3,6,4,1,2,4,5,7,3,2,3,7,0,3,0,7,2,0,4,2,4,7,1,4,5,0,5,2,3,5]],
['cggf,daed,gbca,ceab,dbed,egff,cfba,,',7,23,1,[0,7,2,8,5,7,0,5,0,2,3,0,3,8,6,8,6,0,6,7,2,6,2,0,5,2,3,5,3,6,4,3,1,3,1,4,1,8,1,3,4,5,4,0,3,4]],
['fcbc,fadd,fdbe,cbcd,abee,afea,,',6,19,1,[1,6,2,7,3,6,0,3,0,2,3,0,2,3,2,6,4,7,5,1,5,7,2,5,3,2,0,3,0,5,4,2,1,4,5,1,4,5]],
['accg,cefh,egad,bdbd,hbcf,bdhg,fegf,aaeh,,',8,25,1,[0,8,2,9,3,9,5,8,1,5,4,1,4,0,3,4,3,9,4,3,5,4,5,9,3,5,7,4,1,3,1,7,0,1,0,2,6,3,6,8,7,6,2,7,2,8,6,2,3,6]],
['dbba,dcga,gdcb,debf,fece,ffca,gaeg,,',7,23,1,[0,7,0,8,1,7,2,8,5,7,2,5,0,2,4,0,6,1,6,0,6,7,1,6,1,4,1,2,4,1,4,0,3,4,3,8,3,0,2,3,2,6,5,1,4,5]],
['aadd,hgge,dffa,ehai,hiih,beci,cfed,bfbc,cggb,,',9,24,1,[3,9,2,3,2,10,0,2,3,0,4,3,4,9,3,4,1,3,5,9,6,2,6,3,6,10,5,6,5,3,7,6,7,5,7,10,5,7,1,5,1,4,8,7,8,5,6,8]],
['baac,cceb,beac,bdda,ddee,,',5,12,1,[3,5,4,6,3,4,1,3,1,6,0,1,0,5,0,3,2,1,2,5,2,6,2,3]],
['bbaa,acee,bdde,deff,fcaf,cbcd,,',6,15,1,[1,6,2,6,5,2,1,5,0,1,4,7,3,7,3,6,2,3,0,2,4,1,5,4,5,2,4,5,4,7]],
['dfcg,bdbc,geea,aced,afdc,ggbf,befa,,',7,22,1,[1,7,4,7,3,4,3,8,3,7,2,3,2,8,0,2,0,7,5,0,1,5,4,1,0,4,1,0,5,1,2,5,4,2,3,4,6,4,6,2,6,8,1,6]],
['cdbe,febe,bcdf,accd,bfaa,aefd,,',6,18,1,[0,6,1,6,0,1,0,7,3,7,3,0,4,3,2,4,2,7,2,0,1,2,1,6,4,1,2,4,5,7,5,1,5,6,3,5]],
['fcde,bgeg,gdch,bbha,hdbg,ahef,fcca,eafd,,',8,25,1,[7,8,5,7,0,5,0,8,0,9,7,0,3,7,2,3,2,9,2,8,1,2,4,2,6,7,6,9,0,6,7,0,1,7,1,2,1,4,5,7,3,5,4,3,4,8,5,4,0,5]],
['ffdd,edbd,acbb,caga,ggef,ecec,bgfa,,',7,19,1,[0,7,1,7,4,0,1,8,1,7,4,1,2,8,5,2,5,1,2,5,3,2,3,4,3,2,5,3,1,5,6,2,6,0,6,4,6,8]],
['dhei,geeh,fcfh,gafg,ahaf,dice,cbba,ibdc,ibgd,,',9,28,1,[1,9,1,10,2,9,3,1,2,3,5,10,2,5,3,2,4,2,4,3,4,9,3,4,1,3,6,4,6,1,5,6,0,5,0,10,0,9,7,6,7,0,7,1,5,7,0,5,8,5,8,3,8,1,7,8]],
['ddec,abab,becb,dccd,eeaa,,',5,14,1,[0,5,1,6,2,6,2,5,0,2,3,0,3,5,0,3,4,0,1,0,1,6,0,1,2,4,2,6]],
['adfa,ecef,abdb,efed,bfab,cdcc,,',6,20,1,[1,6,3,7,1,3,5,1,5,7,1,5,3,1,3,6,1,3,4,1,0,4,0,6,0,7,2,1,2,7,1,2,4,0,4,6,2,4,0,2]],
['cade,ggcd,ceaa,bfaf,bfbd,gegf,cedb,,',7,23,1,[0,7,0,8,1,8,2,0,2,7,1,2,4,8,6,4,6,8,6,7,2,6,0,2,0,6,3,0,3,2,3,0,4,3,4,0,3,4,5,0,5,1,5,7,1,5]],
['ffad,aadc,dcab,beeb,bdcc,ffee,,',6,15,1,[1,6,4,6,5,7,4,1,2,4,3,4,3,7,3,4,0,3,0,2,0,5,1,3,2,1,2,6,2,3]],
['hbde,hcch,baga,dfae,egfc,cbah,fdeg,fgbd,,',8,26,1,[6,8,3,6,2,3,2,8,3,2,0,9,6,9,0,6,7,6,0,7,1,0,4,1,3,4,5,0,6,3,4,6,4,8,4,9,2,4,5,4,5,2,1,5,0,1,7,2,7,8,6,7]],
['geec,bcab,fggc,fdgd,edbf,baad,acef,,',7,20,1,[0,7,2,7,3,8,3,2,3,8,4,3,1,4,5,8,1,5,1,7,4,1,4,8,0,4,2,0,2,3,6,3,6,4,6,7,5,6,1,5]],
['cgdb,cfcg,aiie,hdgf,adab,bfac,hdfe,biie,gehh,,',9,28,1,[2,9,2,10,6,9,3,6,1,3,5,1,7,9,5,2,6,5,7,10,0,7,0,6,3,0,4,7,4,2,4,3,2,4,3,2,6,2,3,6,5,3,5,7,8,6,8,9,0,8,1,0,1,3,0,1]],
['ebab,beaa,adcd,ecdb,cdec,,',5,16,1,[2,5,4,2,0,6,3,6,3,5,2,3,2,5,0,2,0,6,0,4,1,2,4,1,4,5,3,4,1,3,1,6]],
['fdcd,fede,ecac,baaf,cabe,fbbd,,',6,19,1,[0,6,2,0,2,7,0,2,0,6,3,0,3,7,5,6,5,3,0,5,1,0,1,6,0,1,4,1,4,3,4,7,2,4,1,2,1,5]],
['cdec,eggf,feaa,fcga,badb,begf,bddc,,',7,21,1,[2,7,3,7,3,8,0,3,0,2,6,3,0,6,3,0,1,3,1,8,2,1,2,3,5,3,5,8,5,1,4,5,4,2,4,7,4,5,6,2,5,6]],
['fbbc,dbaa,ebdf,dccf,deea,eacf,,',6,17,1,[0,6,0,7,2,0,3,0,3,6,2,3,2,7,5,0,5,6,1,5,1,7,1,3,4,1,2,4,5,1,4,5,3,4]],
['hhfb,fgcg,aahc,dfbe,gfce,acbb,head,egdd,,',8,23,1,[0,8,5,8,2,5,3,9,3,8,0,3,2,0,4,9,4,5,3,4,6,3,6,2,6,9,0,6,5,0,2,5,7,3,1,7,1,0,1,7,4,1,7,4,7,9]],
['feeb,adbc,cgef,cedg,fagg,badf,bacd,,',7,22,1,[3,7,3,8,4,7,6,8,1,6,0,1,0,3,2,0,5,0,5,8,4,5,0,4,2,0,2,7,3,0,2,3,6,3,5,6,1,5,1,8,6,1,5,6]],
['cbfd,agcg,eida,bhib,edfg,ciie,hchb,aegf,ahdf,,',9,30,1,[0,9,0,10,3,0,6,0,7,10,1,7,8,10,8,9,6,8,1,6,4,1,4,10,4,9,5,4,3,5,3,8,0,3,0,6,1,0,2,1,2,9,7,0,4,7,2,4,5,4,6,5,7,2,1,7,8,6,7,8]],
['bded,ebae,acbe,acdc,dcab,,',5,17,1,[3,5,0,3,2,0,4,2,0,6,1,6,1,4,2,1,2,5,3,0,3,5,2,3,4,3,4,5,0,4,1,0,1,6]],
['eafa,efcd,fddb,abeb,fcac,bedc,,',6,19,1,[1,6,1,7,4,7,0,4,0,1,4,0,4,7,1,4,5,7,5,6,5,1,2,5,2,6,2,4,3,5,3,1,3,5,0,3,0,1]],
['cecb,cbga,aafe,fadc,dgdg,fdbe,fbeg,,',7,23,1,[0,7,2,8,3,0,5,8,5,7,3,5,1,3,4,1,4,5,1,4,1,7,0,1,0,8,0,1,4,0,5,4,2,5,3,2,3,5,6,0,6,8,6,7,5,6]],
['cfcb,dbda,dabe,afea,cceb,efdf,,',6,19,1,[0,6,4,6,2,4,2,6,1,2,3,2,5,7,1,5,1,6,5,1,5,7,3,5,3,7,2,3,1,2,4,5,0,4,0,7,0,4]],
['dbfg,gchf,acch,efde,bdcg,aeah,bhdf,ebag,,',8,26,1,[1,8,1,9,2,9,1,2,0,1,0,8,4,1,5,9,6,8,7,1,5,7,3,5,3,6,3,8,3,5,2,3,4,3,6,4,6,9,0,6,4,0,4,6,7,2,7,6,5,7,2,5]],
['efda,cbgf,bgcg,dddc,afef,gaca,bbee,,',7,19,1,[1,7,2,1,4,7,4,8,4,7,0,4,5,4,2,5,1,2,6,8,1,6,3,1,0,3,0,7,0,8,5,1,5,4,2,5,2,6]],
['aagi,dbbe,ieae,igcf,gbhg,hcdd,hfhf,feic,badc,,',9,27,1,[8,9,7,9,0,7,4,0,3,10,3,9,0,3,6,10,6,4,10,6,1,10,2,10,2,0,2,10,7,2,7,10,6,7,4,6,1,4,5,1,5,9,5,6,8,1,8,0,4,8,3,4,2,3]],
['ecdc,dccd,baea,abbe,bead,,',5,14,1,[0,5,1,0,1,5,0,1,0,5,3,0,4,1,2,4,2,0,4,2,4,0,3,4,2,3,2,4]],
['effd,daca,abfc,dabe,becb,fecd,,',6,19,1,[2,6,0,7,2,0,4,2,4,6,3,4,3,2,1,3,1,6,1,3,1,7,5,7,5,6,5,4,0,5,4,0,2,4,3,2,3,7]],
['ecdb,fcde,aabe,gagg,fddg,efca,bcbf,,',7,22,1,[4,7,3,7,4,8,5,3,6,4,0,6,0,8,0,5,1,0,1,8,2,0,5,1,4,5,1,4,5,1,0,5,2,0,3,2,3,7,6,0,6,4,0,6]],
['acdf,ebbd,bdbe,cfda,aaef,cfce,,',6,18,1,[0,6,0,7,1,7,4,6,2,4,2,1,2,7,1,2,4,1,3,4,3,7,3,6,0,3,0,4,5,1,5,3,5,6,3,5]],
['ehda,bbcf,ghhc,bafc,ddgf,aahe,efgb,dcge,,',8,23,1,[1,8,1,9,2,9,3,9,3,8,0,3,4,8,6,1,4,6,0,4,2,0,6,2,6,8,5,6,7,6,7,2,7,9,4,7,0,4,0,6,5,4,3,5,1,3]],
['fged,eegc,cabd,ffdg,dbac,ecbg,afab,,',7,21,1,[3,7,0,3,5,7,5,8,1,5,1,7,0,1,0,7,4,5,6,8,4,6,4,8,2,4,2,8,3,4,0,3,6,2,6,3,2,6,5,2,1,5]],
['bhfc,gdeh,ddhe,iaba,cgbe,hdag,feac,iifi,cfgb,,',9,27,1,[2,9,1,2,1,9,3,10,4,9,4,3,5,4,5,10,1,5,4,1,0,4,6,4,6,10,6,9,0,6,2,0,5,2,0,5,3,0,3,10,7,3,7,6,3,7,8,0,8,1,8,6,4,8]],
['ecac,eced,daab,ddbb,aceb,,',5,14,1,[0,5,2,6,0,2,0,5,3,6,1,3,1,0,1,5,0,1,4,6,4,1,4,5,2,4,2,3]],
['dcde,cbda,cabc,efea,fbfd,afbe,,',6,21,1,[1,6,3,6,0,3,0,1,2,0,2,7,2,6,0,2,1,0,1,7,1,2,4,0,5,1,3,1,3,4,1,3,5,7,4,5,4,7,5,4,5,6]],
['dfca,ebea,aecd,dgad,bgce,fgcg,bbff,,',7,22,1,[3,7,2,7,1,3,2,8,1,2,4,2,4,8,5,4,5,8,4,5,1,4,2,1,0,2,0,8,3,2,6,0,4,6,3,4,3,7,5,4,0,5,0,7]],
['cbbc,acdf,efad,bdfe,aadf,ebce,,',6,18,1,[1,6,1,7,0,1,2,7,4,6,4,7,2,4,2,6,3,2,3,6,3,7,0,3,1,0,1,4,5,2,5,0,5,3,2,5]],
['gabc,ddac,gaha,feeg,bbhc,dfbd,gfec,hefh,,',8,24,1,[0,8,1,8,1,9,2,9,4,8,5,1,0,5,0,9,3,0,7,4,6,8,6,3,6,7,0,6,3,0,7,3,7,0,2,7,2,9,2,6,4,7,5,4,5,3,1,5]],
['agfa,ebcc,ffcg,agbg,decd,ddbe,eabf,,',7,21,1,[1,7,1,8,5,1,5,8,4,5,4,7,1,4,2,1,2,7,3,1,3,8,3,1,0,3,0,2,0,1,0,3,6,2,6,8,6,3,4,6,4,5]],
['hibf,ehcg,eaci,ddeg,achf,hdga,biba,ecdi,bgff,,',9,29,1,[0,9,1,10,3,10,4,9,8,9,8,10,0,8,2,0,1,2,1,4,1,3,0,1,4,0,2,4,5,2,5,10,6,2,6,8,6,1,6,8,4,6,2,4,3,2,5,3,0,5,7,1,7,3,7,6,2,7]],
['aedb,dcec,cddb,baba,caee,,',5,15,1,[4,5,3,4,2,3,3,6,0,6,0,2,0,5,3,0,3,6,4,0,1,4,1,5,1,4,2,1,2,4]],
['afde,bebf,aeac,dfab,ecbd,ccdf,,',6,19,1,[1,6,5,6,4,5,4,1,2,4,1,7,0,1,3,7,2,3,2,1,3,2,3,6,0,3,0,6,0,2,5,3,4,5,1,4,1,7]],
['abbf,afde,gcdg,eeba,cfgf,dcae,gdbc,,',7,21,1,[0,7,0,8,3,0,3,8,1,3,4,7,2,4,1,2,1,7,0,1,5,3,5,1,6,5,6,8,2,6,2,5,4,2,4,7,5,4,6,5,2,6]],
['bacf,efbe,ddae,acec,bbda,ffcd,,',6,17,1,[3,6,2,3,4,2,5,4,5,6,0,5,0,6,2,0,4,2,1,7,1,4,1,5,1,7,3,7,3,6,0,3,0,4]],
['afch,bedf,geaf,gdae,cbbh,gheg,hcba,fddc,,',8,25,1,[3,8,6,3,0,9,4,9,6,4,0,6,1,0,2,0,7,6,1,7,1,8,4,1,6,4,6,9,7,6,0,7,2,0,2,8,3,0,3,6,2,3,5,3,5,8,5,9,3,5]],
['aaef,deca,afbg,fdbd,bcef,gdgc,bgec,,',7,22,1,[5,7,2,5,6,7,6,8,5,6,3,5,2,3,0,2,0,8,1,0,1,7,1,8,4,2,4,8,4,7,3,4,3,1,2,3,0,2,5,1,6,5,4,6]],
['caeg,eihb,ahif,gcab,aced,ihde,fbgf,chdd,bgif,,',9,29,1,[4,9,5,4,5,9,7,9,5,7,8,10,2,10,2,5,2,7,6,10,0,6,8,5,6,8,1,6,3,6,2,3,1,2,1,5,0,1,3,0,4,1,3,4,7,2,4,7,0,4,0,7,8,3,6,8,6,10]],
['ceda,ebcd,abde,aacb,ebcd,,',5,16,1,[1,5,3,6,1,3,1,6,2,1,2,5,2,6,0,2,0,5,0,1,3,0,2,3,4,5,4,0,4,6,1,4]],
['dccb,afde,ebff,aeab,dccf,daeb,,',6,18,1,[0,6,0,7,3,6,5,6,1,5,0,1,2,0,2,6,4,0,4,7,1,4,1,0,1,3,5,2,3,5,3,2,5,3,4,5]],
['bcef,bgad,deeb,eabd,fdgc,agcc,gaff,,',7,20,1,[4,7,5,7,4,5,1,4,3,4,2,3,0,8,0,2,0,7,3,0,1,3,1,5,0,1,6,8,6,3,5,6,3,5,2,3,4,2,4,8]],
['ffbf,dcfb,adde,acde,bace,aebc,,',6,18,1,[2,6,3,6,3,2,3,7,4,6,4,7,4,3,1,4,0,1,0,4,1,0,1,7,2,1,2,3,5,7,5,4,5,6,3,5]],
['bhfc,dhgg,cfca,becd,bead,ehfb,adeh,ggfa,,',8,25,1,[3,8,4,8,2,4,2,3,2,9,0,2,0,9,3,2,6,0,3,6,5,3,5,9,0,5,0,3,5,0,6,5,6,8,4,6,4,5,3,4,7,6,7,9,1,7,1,0,1,8]],
['gebe,dcff,ecdg,edca,agda,fbag,cfbb,,',7,21,1,[6,7,1,6,0,8,0,7,0,8,2,0,5,0,4,5,2,4,1,2,4,1,4,0,3,4,3,2,3,1,3,8,5,4,5,7,6,5,2,6,2,8]],
['ahhc,dadg,hidf,abfe,iibc,eebd,cagb,cggh,ffie,,',9,25,1,[6,9,1,6,5,1,5,9,3,5,2,3,8,5,1,10,2,10,8,2,3,8,3,9,1,3,1,10,6,1,6,3,0,6,4,6,4,9,2,4,0,2,0,3,7,2,7,1,6,7]],
['daee,ebcb,ddaa,cbcb,cdea,,',5,14,1,[1,5,2,6,3,5,1,3,1,5,0,1,0,6,0,2,4,6,4,1,4,2,3,4,3,5,3,4]],
['acbd,eecf,cabb,abfd,adfe,fecd,,',6,18,1,[0,6,0,7,2,7,3,6,1,3,0,1,5,6,2,0,1,2,4,1,5,2,5,1,3,5,3,7,0,3,4,5,4,6,3,4]],
['cegd,face,eadg,bcab,bffb,ecgd,dgfa,,',7,23,1,[2,7,0,2,0,7,1,0,4,8,3,8,6,3,6,4,6,7,2,6,3,2,1,3,5,6,5,7,3,5,3,8,1,3,2,3,0,2,4,1,4,8,5,0,2,5]],
['fbdd,bfcd,ecaf,afda,ebce,cabe,,',6,19,1,[0,6,1,6,4,7,1,4,2,1,3,2,3,6,1,3,0,1,3,0,2,3,4,2,4,1,4,7,5,7,5,1,5,3,2,5,2,7]],
['gahd,afgc,bdhb,eafd,efcb,ceed,hagc,fgbh,,',8,25,1,[0,8,3,8,5,8,7,0,2,7,0,9,2,9,2,8,4,2,1,4,7,2,1,7,1,3,0,1,7,0,3,7,3,1,5,3,4,5,4,7,3,4,6,5,6,0,6,1,6,9]],
['cdff,fgag,abbd,bcdd,gcea,eefa,egcb,,',7,19,1,[2,7,3,7,6,2,3,6,2,3,4,2,5,2,1,8,1,2,1,8,0,1,0,7,5,1,4,5,4,0,4,8,6,0,6,8,5,6]],
['ehha,cfhg,gfig,eiia,bdic,adha,bcbg,fddc,feeb,,',9,28,1,[1,9,2,9,6,9,8,6,0,10,1,0,3,10,2,3,2,1,2,9,0,2,0,8,3,0,5,10,5,2,8,3,1,8,4,1,4,0,4,5,6,4,6,1,4,6,5,4,5,10,7,1,7,4,7,8]],
['bcbe,aaeb,cdca,edca,debd,,',5,16,1,[0,5,1,0,1,5,2,1,3,1,2,3,4,2,4,6,0,6,3,0,2,3,0,2,0,6,4,5,3,4,3,5]],
['fdee,aabe,dafa,cdff,cbbc,dbce,,',6,16,1,[0,6,1,6,1,7,2,1,5,6,4,5,4,7,5,4,5,7,0,5,2,0,2,1,2,5,3,0,3,5,3,4]],
['bffe,gddf,dacd,becb,caag,egba,efgc,,',7,20,1,[1,7,2,1,5,8,3,5,2,3,2,8,1,2,4,1,4,8,3,4,0,3,0,7,5,0,5,1,3,5,0,3,6,4,6,1,6,7,5,6]],
['bceb,bffe,dada,acbe,dcde,facf,,',6,19,1,[1,6,3,6,0,3,0,6,0,7,3,0,3,7,2,3,4,6,2,4,2,3,4,2,4,7,2,4,5,1,5,7,5,3,1,5,0,1]],
['eagh,bhga,dbch,afge,bade,cgcf,dcdh,fefb,,',8,27,1,[0,8,0,9,1,0,1,9,1,8,2,8,6,8,7,1,5,7,2,5,2,1,6,2,5,6,5,9,6,5,2,6,0,2,3,0,3,9,4,0,4,6,2,4,7,3,7,0,3,7,4,3,1,4]],
['geec,cdbg,efcd,baag,dgff,edaf,bbca,,',7,19,1,[4,7,1,4,3,4,3,8,1,3,2,1,0,2,5,7,5,8,1,5,2,1,2,7,0,2,4,0,5,4,2,5,6,8,6,1,3,6]],
['bfdi,bdba,ecff,agah,geia,hgcf,dihc,eebh,cdig,,',9,28,1,[0,9,2,10,5,10,5,2,6,2,3,6,8,5,4,3,4,8,8,9,8,0,2,8,4,2,5,4,6,5,6,9,0,6,0,10,7,5,7,0,2,7,3,2,1,2,1,0,1,6,0,1,3,4,2,3]],
['dbed,edab,cebc,ccad,ebaa,,',5,15,1,[1,5,1,6,0,1,3,1,3,6,2,3,2,5,0,2,0,5,1,0,1,2,4,6,4,5,2,4,2,3]],
['ccba,daec,afcb,defd,dbfa,eefb,,',6,18,1,[2,6,1,2,5,6,5,7,1,5,0,1,0,6,2,0,2,7,1,2,3,1,3,7,3,5,1,3,4,2,4,7,4,6,3,4]],
['gfeb,eaea,decg,adfb,fdcb,gccf,badg,,',7,22,1,[0,7,3,7,4,7,4,8,5,3,5,8,2,5,2,8,0,2,3,0,3,4,1,3,1,2,1,3,2,1,4,2,0,4,0,5,6,5,6,2,6,3,6,7]],
['dcbc,ecaf,facd,bdee,adeb,fabf,,',6,19,1,[0,6,4,0,3,7,2,3,2,6,4,7,3,4,0,3,0,6,4,0,2,4,1,2,1,4,1,6,1,7,5,2,5,3,5,4,2,5]],
['eacf,cdba,eahd,adgh,hgfg,cfhb,gbfe,bedc,,',8,26,1,[0,8,2,9,3,2,4,3,4,8,3,4,3,9,1,3,5,1,7,0,7,9,6,7,6,8,1,6,1,9,0,1,0,3,7,0,6,7,4,6,2,4,2,3,0,2,5,4,5,8,1,5]],
['bagd,efbd,dfba,cfgf,cega,dbec,agce,,',7,23,1,[3,7,3,8,3,7,5,3,6,5,6,3,6,8,2,6,4,6,4,8,5,4,2,5,2,7,0,2,0,8,0,6,1,2,1,0,1,7,4,1,3,4,5,0,2,5]],
['iagg,defh,hdie,bcfb,bhbe,fdga,cace,difa,cgih,,',9,29,1,[0,9,7,0,2,10,4,10,3,4,3,7,5,0,5,9,6,10,3,6,4,3,1,4,8,4,2,8,5,2,1,5,1,10,1,2,0,1,7,5,7,0,2,7,4,2,3,4,8,0,8,9,6,8,6,1,6,8]],
['dbda,bcbc,eede,bcaa,dcea,,',5,15,1,[0,5,1,6,3,5,3,6,1,3,1,6,1,3,4,5,2,4,0,2,0,3,2,0,4,2,4,6,0,4]],
['bdde,fddc,fbee,caba,eccb,affa,,',6,16,1,[0,6,0,7,2,6,2,0,4,0,1,4,1,7,1,2,3,1,3,0,1,3,5,3,5,2,3,5,4,3,4,6]],
['bdfc,afed,cbeg,baae,agdf,dfcc,eggb,,',7,20,1,[2,7,4,8,1,4,2,1,6,2,6,7,1,6,1,8,3,6,3,1,2,3,0,2,0,8,4,0,4,7,1,4,5,2,5,8,0,5,0,3]],
['ccbf,deed,dffa,aaeb,bcbd,fcae,,',6,16,1,[5,6,2,5,0,2,3,0,3,6,5,3,0,7,5,0,2,5,1,2,1,6,1,2,4,2,4,7,4,0,4,7]],
['fcah,bead,gbbd,cdfe,echg,fhae,fgah,gbcd,,',8,26,1,[0,8,0,9,6,8,6,9,4,6,4,8,4,0,3,4,5,4,5,9,5,8,3,5,1,3,1,9,1,4,2,3,2,1,2,6,3,2,0,3,0,5,7,2,7,3,7,1,6,7,5,6]],
['babc,egaf,dbgb,cceg,efac,ddfd,eafg,,',7,22,1,[1,7,1,8,3,1,6,1,6,7,6,8,3,6,0,3,2,0,4,3,4,8,4,7,4,6,1,4,1,6,2,4,0,2,0,8,2,0,5,2,5,7,2,5]],
['haef,egib,diag,cchg,cabd,hbgd,cafi,fibd,hfee,,',9,30,1,[1,9,6,1,0,6,7,10,4,10,4,7,5,10,2,5,2,4,7,9,2,7,2,10,5,2,3,2,5,9,5,3,1,5,1,2,0,1,0,4,3,0,7,5,6,7,8,1,8,7,0,8,4,0,3,4,6,0,4,6]],
['aecd,abeb,beca,ddac,bced,,',5,16,1,[3,5,2,3,2,5,2,6,1,2,1,6,1,2,3,1,0,3,0,5,0,6,0,1,4,3,4,6,4,5,2,4]],
['ebdd,afed,abfe,cbcf,bcfc,edaa,,',6,18,1,[0,6,1,6,2,1,2,7,0,2,1,0,1,7,3,7,4,3,4,7,3,4,3,2,4,3,2,4,1,2,5,2,5,6,0,5]],
['bdac,fdcd,afbf,eegb,cgfg,caed,bega,,',7,22,1,[1,7,0,1,4,8,2,4,3,2,3,8,5,7,5,3,0,5,0,7,2,0,4,2,4,8,1,4,1,7,2,1,5,2,4,5,6,2,6,8,6,3,0,6]],
['adcb,adeb,cdaf,effb,ebcf,cead,,',6,20,1,[0,6,1,6,2,7,3,6,3,7,1,3,4,7,0,4,0,1,0,2,1,0,2,1,2,0,4,2,4,6,3,4,5,0,5,1,5,4,2,5]],
['fcgg,ebha,ddbf,ehgf,bbda,hagh,dcec,fcae,,',8,24,1,[0,8,0,9,2,0,3,0,3,8,5,3,5,8,1,5,1,3,1,2,4,5,6,9,1,6,5,1,3,5,6,3,6,9,4,6,2,4,2,6,7,3,7,1,7,9,0,7]],
['eada,ddgb,acfe,gfgc,becf,efcd,bgba,,',7,22,1,[3,7,4,8,4,7,2,4,2,8,2,7,0,2,5,0,5,7,5,8,4,5,1,4,1,3,0,1,0,2,0,5,6,2,6,4,3,6,3,8,6,3,4,6]],
['aeib,cicb,hhbf,agcb,gdgf,edif,igce,adha,fdhe,,',9,30,1,[0,9,1,9,3,9,4,10,2,10,2,9,5,10,0,5,6,0,6,3,4,6,8,0,8,2,4,8,6,4,5,6,8,5,8,10,5,8,0,5,7,0,7,2,7,8,0,7,1,0,1,6,0,1,3,1,3,4,3,7]],
['ddbb,acdc,bace,adbe,aece,,',5,15,1,[1,5,2,6,2,5,3,6,4,6,4,5,4,6,2,4,0,2,1,0,1,5,1,4,3,2,3,0,3,4]],
['cffc,dfcd,ceaf,aded,aabb,ebeb,,',6,18,1,[2,6,4,7,2,4,5,7,5,2,5,7,2,5,0,2,0,6,0,2,3,0,1,0,1,2,1,6,0,1,3,5,3,1,3,4]],
['ddba,gcdc,fbba,fcab,gfdc,eefa,geeg,,',7,20,1,[0,7,0,8,2,7,2,8,3,8,3,7,1,3,1,0,1,3,5,7,2,5,3,2,4,2,4,0,4,3,1,4,5,3,6,4,6,5,4,6]],
['dcce,eadf,facc,bdba,dbfe,abfe,,',6,18,1,[2,6,3,2,0,7,0,6,4,7,1,4,1,0,2,1,4,2,3,4,0,3,5,7,5,2,4,5,3,4,5,3,1,5,1,7]],
['hcgg,cdbh,badb,dcaf,haef,hgee,fdce,fgab,,',8,25,1,[0,8,5,9,5,8,1,5,2,1,6,9,6,0,6,2,3,6,4,6,4,9,3,4,3,0,2,3,2,4,1,2,1,3,0,1,0,5,4,0,4,5,7,2,7,0,7,8,6,7]],
['beea,gdaf,bdeg,fcde,dcfg,cafa,cbgb,,',7,22,1,[0,7,0,8,3,8,5,7,1,5,1,7,1,3,2,1,2,8,3,2,4,1,6,0,6,1,6,0,3,6,4,3,4,6,2,4,0,2,5,3,5,7,5,6]],
['ifbh,abbi,caea,ggcc,iffh,gebf,dade,dhhc,ideg,,',9,26,1,[0,9,6,10,4,9,5,4,5,0,5,10,8,5,8,10,6,8,2,6,2,10,2,6,3,2,3,5,0,3,7,2,7,9,7,8,0,7,1,0,1,3,4,7,0,4,6,1,8,6,4,8]],
['aeac,bdcb,eddb,ceba,ecad,,',5,16,1,[4,5,3,4,1,3,0,1,0,6,4,6,1,4,1,5,2,1,2,5,0,2,0,6,3,1,3,2,4,3,2,4]],
['ebad,bbda,fcaf,cfde,aefc,bdce,,',6,19,1,[0,6,1,0,1,6,0,7,0,1,3,0,3,6,2,3,2,7,5,0,2,5,3,2,4,3,4,2,4,0,4,7,5,3,5,6,1,5]],
['gedg,babd,agcd,baec,ecfg,fbce,fdaf,,',7,23,1,[1,7,2,7,2,8,0,2,0,7,3,8,0,3,2,0,4,0,6,4,6,2,6,7,4,6,4,8,3,4,3,2,1,3,1,2,1,3,5,4,5,8,5,3,5,6]],
['bacc,acee,bdfb,beda,dafe,fcdf,,',6,18,1,[0,6,1,7,1,6,0,1,2,0,3,1,4,7,5,4,5,3,5,6,2,5,3,2,3,7,0,3,4,5,4,1,2,4,2,3]],
['fhgf,dgfb,cdfa,ggea,abce,dbch,dcbe,heah,,',8,25,1,[1,8,0,1,4,9,6,9,6,8,4,6,4,8,2,4,3,4,3,9,0,3,5,0,5,6,5,8,7,0,7,4,7,9,0,7,1,0,1,3,1,5,2,0,2,5,6,2,5,6]],
['gbee,gcaf,affg,bcga,dbae,dddb,cfec,,',7,19,1,[0,7,1,8,3,1,2,3,2,8,1,2,4,7,4,2,0,4,3,0,1,3,0,1,5,4,6,3,6,7,6,8,3,6,4,3,4,5]],
['abdc,cfch,ieif,ggdd,bgfd,hhac,hgai,biae,febe,,',9,27,1,[3,9,4,9,2,4,6,2,7,10,6,7,6,3,1,6,0,1,0,9,8,10,0,8,7,0,2,7,2,10,7,2,8,7,8,10,4,8,4,3,4,7,5,4,1,4,1,8,1,4,5,0,5,6]],
['dbcd,abca,aeca,deeb,bdec,,',5,17,1,[4,5,4,6,0,4,0,5,3,0,3,6,4,3,0,4,0,3,1,0,1,5,1,4,0,1,2,1,2,5,2,6,1,2]],
['febb,fcad,dead,aecb,fabc,fdce,,',6,20,1,[0,6,0,7,3,6,5,7,5,3,1,5,2,5,1,2,3,1,3,7,2,3,2,7,5,2,0,5,1,0,1,5,4,0,4,6,4,3,4,5]],
['ecfd,bfab,dgbe,gfef,egba,aadc,ccgd,,',7,21,1,[3,7,2,3,1,2,4,1,0,8,0,7,5,0,5,8,1,5,1,7,2,1,4,1,2,4,2,8,6,8,6,4,0,6,3,0,3,7,4,3,0,4]],
['afbc,aadd,dfcc,aebd,beef,bfec,,',6,17,1,[0,6,2,6,2,7,1,2,3,2,0,3,0,7,0,1,4,7,4,0,3,4,3,0,1,3,5,6,5,0,5,7,4,5]],
['daha,hecd,fhag,fghc,cgeb,edbf,facd,gebb,,',8,25,1,[0,8,4,9,7,9,4,7,2,4,2,8,0,2,0,8,1,0,3,1,3,2,3,4,5,3,5,9,5,0,6,0,7,5,4,7,1,4,1,5,2,1,2,3,6,4,6,8,3,6]],
['bfdc,daae,becc,cgab,dgeg,fgde,baff,,',7,21,1,[1,7,1,8,5,7,1,5,4,1,4,7,4,1,5,4,5,1,6,5,6,8,3,6,3,8,3,1,0,3,0,4,0,5,0,6,2,3,2,7,2,6]],
['ihgd,iabe,gbha,gfdb,ahcg,cbff,deic,eehc,dfia,,',9,28,1,[3,9,0,3,4,0,5,10,5,9,4,5,6,5,7,5,4,7,2,4,8,4,6,8,1,6,1,9,1,4,8,1,8,10,3,8,3,10,0,3,0,2,0,1,2,0,2,9,2,3,7,0,6,7,6,8]],
['eddc,aceb,deab,bead,accb,,',5,15,1,[0,5,3,0,1,6,2,6,2,3,1,2,1,5,3,1,2,3,0,2,3,0,3,6,4,6,4,5,1,4]],
['adba,bdca,edfb,cbef,afce,edcf,,',6,21,1,[3,6,4,3,5,6,4,5,4,6,0,4,1,4,2,0,2,6,2,7,3,2,0,3,0,7,0,4,1,0,1,7,3,1,0,3,5,3,5,7,2,5]],
['fgcc,dbca,fdge,effb,cbbe,aadg,agde,,',7,20,1,[3,7,2,8,4,8,4,7,0,4,0,2,0,3,2,0,5,0,5,2,1,5,1,4,1,7,2,1,3,2,3,8,6,8,6,1,6,0,5,6]],
['baed,ceed,eaff,dbca,bcdb,ffac,,',6,17,1,[3,6,5,3,5,6,2,5,2,6,0,7,0,2,0,6,1,7,1,2,3,1,0,3,4,3,4,7,4,1,3,4,3,7]],
['gadb,fdfg,cheg,hhcb,ecae,ahbg,ebdc,affd,,',8,24,1,[0,8,0,9,3,8,6,3,6,9,6,8,4,6,0,4,1,0,2,0,2,6,5,0,5,8,2,5,3,2,5,3,4,5,4,2,4,6,7,9,1,7,1,9,7,1,5,7]],
['bada,egdc,febf,cgae,gebc,bdfc,gafd,,',7,24,1,[6,7,2,6,5,8,1,8,1,7,4,8,2,4,3,2,0,3,0,7,3,0,1,3,2,1,5,2,5,7,4,5,4,1,3,4,3,8,0,3,0,5,6,2,6,3,4,6]],
['daef,igdh,ccbe,gcbb,eafh,hdfa,abei,ggih,icdf,,',9,27,1,[0,9,2,0,8,9,5,10,5,9,5,8,1,5,4,5,4,9,4,10,0,4,0,10,1,0,7,5,6,7,6,4,2,6,8,0,8,2,7,8,1,7,1,8,3,1,3,2,3,7,6,1,6,10]],
['dbde,aebb,aced,ebac,adcc,,',5,15,1,[1,5,0,1,2,0,2,1,2,6,3,6,2,3,4,6,0,4,0,5,4,0,3,4,3,5,1,3,1,4]],
['bfaa,ceeb,eafc,dcfb,fdac,edbd,,',6,18,1,[0,6,0,7,1,0,3,0,3,7,2,3,2,7,2,6,1,2,3,1,4,1,4,6,4,3,4,7,5,3,5,0,5,3,2,5]],
['dggc,agac,cfdb,eeed,bafc,efbb,fdga,,',7,19,1,[0,7,0,8,1,7,3,0,4,7,6,1,6,8,6,0,4,6,1,4,1,8,4,1,2,4,2,0,2,6,2,7,5,4,5,6,3,5]],
['caae,abdc,ebce,bfdf,dbad,ffce,,',6,18,1,[0,6,2,6,5,6,5,2,3,5,4,3,4,0,1,7,2,7,4,2,1,4,1,2,0,1,0,7,3,4,3,5,2,3,2,6]],
['fgce,abah,acdg,fcfh,aegd,fhhc,dbge,debb,,',8,27,1,[0,8,0,9,2,0,4,2,4,0,4,8,5,9,1,5,1,4,6,8,7,1,7,8,2,7,2,9,2,4,1,2,1,4,0,1,6,1,6,2,6,7,3,6,0,3,5,6,3,5,3,9,3,5]],
['dagb,acbd,gfaf,aecd,fdec,becb,gefg,,',7,23,1,[4,7,4,8,1,4,5,1,3,4,3,5,3,8,5,7,5,8,0,5,1,5,1,7,1,3,6,0,2,6,2,3,6,2,6,8,0,6,0,3,4,0,2,4,2,6]],
['gaba,ibcf,eghd,hihd,cfea,cffi,gbhi,geda,dbce,,',9,29,1,[0,9,1,10,4,9,7,9,2,7,8,4,8,1,8,0,3,8,3,2,5,3,5,10,1,5,0,1,0,9,6,3,7,8,4,7,4,10,4,5,1,4,3,1,2,3,0,2,6,3,6,4,2,6,7,2,6,7]],
['bedc,acec,dcdb,abeb,eaad,,',5,16,1,[0,5,1,5,4,0,0,6,1,0,1,5,4,1,0,4,2,0,2,6,2,5,2,6,3,0,3,4,3,0,1,3]],
['eedd,dbae,ecaa,fbfc,ffdc,babc,,',6,16,1,[2,6,2,7,1,2,1,6,3,7,4,7,5,7,1,5,0,1,0,2,4,1,3,4,5,3,5,6,3,5,3,4]],
['fecc,efda,bbdd,cecg,abgf,gdbg,faae,,',7,19,1,[2,7,0,8,6,0,1,6,1,7,4,1,5,4,5,2,5,7,3,5,3,8,0,3,0,1,4,5,4,2,6,4,1,6,3,1,3,8]],
['bafd,cdde,cefe,bcda,baea,fbcf,,',6,20,1,[0,6,1,7,1,6,2,7,5,2,1,5,3,1,3,6,4,1,4,7,4,1,5,3,5,4,0,5,0,1,0,4,2,5,2,7,3,2,3,4]],
['aghb,cged,cbcf,fdeh,egdd,eafh,fbga,cahb,,',8,27,1,[0,8,0,9,3,9,5,9,2,5,7,8,7,9,6,7,0,6,7,0,2,7,2,8,2,7,1,2,1,3,4,2,1,4,1,7,4,1,3,4,3,2,5,3,5,0,4,5,6,1,6,8,3,6]],
['efga,cfbb,bdgg,fcae,eabf,eddc,cgad,,',7,21,1,[0,7,6,8,6,7,6,0,5,6,5,8,3,5,3,7,6,3,0,6,2,6,2,8,1,2,4,1,1,0,3,1,0,3,0,5,4,2,4,7,4,5]],
['dbbg,hidg,adif,dbch,aeca,ihae,ghge,ffcb,cefi,,',9,28,1,[5,9,4,5,6,9,7,10,1,6,7,4,2,7,8,2,8,7,8,9,4,8,4,9,5,4,3,5,3,8,3,10,1,3,2,1,2,3,2,4,0,2,0,10,0,3,6,2,5,6,1,5,6,1,2,6]],
['eeac,aace,dbbe,dcbc,dbda,,',5,15,1,[0,5,3,5,3,6,3,5,4,0,4,3,4,6,3,4,0,3,1,0,1,5,1,3,2,0,2,6,2,4]],
['ddca,acce,eeff,dacb,febf,bbad,,',6,15,1,[4,6,2,6,1,2,1,7,0,1,0,7,3,4,3,7,3,1,0,3,5,3,5,1,4,5,4,2,4,6]],
['fccd,gegc,fdaa,gbae,abbg,febd,defc,,',7,21,1,[1,7,4,1,4,8,2,4,0,2,0,7,5,2,5,8,3,5,3,4,3,8,1,3,1,5,1,3,5,1,0,5,6,7,6,5,6,1,2,6,2,5]],
['edfe,beca,beca,cafd,cdfd,babf,,',6,21,1,[1,6,2,6,1,2,0,1,0,7,3,0,3,7,3,6,2,3,1,2,4,0,4,7,5,7,1,5,0,1,2,0,4,1,3,4,5,2,5,6,2,5]],
['ffeh,chad,efdc,bbcf,ebag,ghcd,bdhg,eaga,,',8,25,1,[0,8,7,9,6,7,6,8,1,6,1,9,1,8,2,1,5,2,5,1,5,8,4,5,4,9,7,5,7,9,0,7,3,0,3,1,3,4,2,3,2,0,2,7,6,3,4,6,4,7]],
['gcdf,eecd,gcbd,eeag,bbaa,cagf,fdbf,,',7,20,1,[1,7,2,7,0,8,0,7,0,1,3,0,5,8,5,0,3,5,6,8,2,6,1,2,1,3,4,1,5,1,2,5,0,2,6,4,6,7,6,8]],
['agfe,aehe,cbfd,hgbc,febd,cdhd,gfca,gahi,iibi,,',9,30,1,[0,9,1,9,2,10,0,2,4,10,5,10,1,5,1,9,6,1,3,6,3,4,0,3,0,1,4,0,4,9,2,4,2,0,6,2,6,4,3,6,5,3,5,10,2,5,7,2,7,3,7,1,6,7,8,2,8,0,2,8]],
['ceeb,aaec,dced,acbd,dbba,,',5,14,1,[0,5,0,6,1,0,1,6,4,1,4,5,2,4,2,6,2,0,2,4,3,4,3,5,3,0,1,3]],
['dcda,bdba,aeff,ffce,dbce,baec,,',6,18,1,[3,6,3,7,2,3,2,6,0,2,1,2,4,6,4,7,1,4,0,1,0,7,0,1,5,7,5,6,5,2,4,5,1,4,1,5]],
['dfbf,fcfa,abae,dgda,gbbe,ecec,gcgd,,',7,24,1,[5,7,2,5,3,2,6,3,2,8,1,8,0,1,0,2,1,0,1,7,0,1,3,0,6,3,6,7,3,6,0,3,2,0,2,8,5,2,4,2,4,0,4,6,5,7,2,5]],
['fcea,caec,bbbd,afcd,dbef,dafe,,',6,18,1,[5,6,4,5,4,6,0,7,0,6,1,0,1,6,1,7,0,1,5,0,5,7,2,5,3,5,3,1,3,0,3,7,4,2,4,5]],
['fche,dgaf,ecdc,beed,ghhf,adcg,abhb,fgba,,',8,24,1,[2,8,3,2,0,3,0,9,0,8,1,0,4,0,4,9,5,4,5,8,2,5,2,8,3,2,6,3,6,9,6,3,1,6,1,4,5,1,5,6,7,6,7,3,7,4,0,7]],
['ddea,cfcg,abfc,afdf,bgbe,edac,ebgg,,',7,22,1,[1,7,2,1,2,8,3,8,6,7,2,6,0,2,4,0,4,6,4,7,6,4,0,6,3,0,3,8,2,3,5,2,1,2,1,8,1,2,5,3,5,0,5,6]],
['ddha,egif,bgaf,ceif,cecg,bhhi,cdbf,eiha,gabd,,',9,29,1,[0,9,0,10,7,9,7,10,5,7,5,10,8,0,5,8,1,5,1,7,2,5,2,9,2,1,3,5,4,1,6,5,6,2,6,0,4,6,8,2,8,9,1,8,1,4,3,1,3,4,3,6,7,1,4,7,4,6]],
['abda,ebac,eeab,cdeb,dccd,,',5,15,1,[2,5,0,2,3,5,4,0,1,4,4,6,0,4,0,5,1,0,1,5,1,3,2,0,3,2,3,4,3,6]],
['bdcc,edfa,bbdb,fede,caff,aeca,,',6,18,1,[3,6,3,7,3,6,4,3,1,4,1,3,1,7,1,6,5,4,4,1,0,4,0,7,2,0,2,7,0,2,5,4,5,6,1,5]],
['ggaa,dabc,dcbc,gbef,ddbg,ecff,faee,,',7,20,1,[1,7,1,8,0,1,2,7,2,8,2,7,4,0,4,8,2,4,1,2,1,4,6,1,6,2,3,6,3,1,3,8,0,3,5,6,5,7,1,5]],
['fbcc,baac,ebef,dbde,dfca,dfea,,',6,18,1,[0,6,1,6,1,7,0,1,2,0,4,7,4,6,4,0,5,7,2,5,2,1,3,2,3,4,3,1,3,4,5,2,5,0,4,5]],
['fdde,dgca,hbgc,gdfe,gech,fbah,ebah,fcba,,',8,26,1,[1,8,1,9,2,9,2,1,7,8,2,7,4,2,4,9,0,4,3,4,5,2,5,8,6,2,6,8,5,6,3,5,0,3,0,5,6,0,4,6,1,4,3,1,3,4,7,0,7,9,5,7]],
['fgbg,dfde,cggb,eaea,bcfd,eafa,bdcc,,',7,21,1,[0,7,2,0,2,7,3,8,1,3,4,1,5,8,4,5,4,2,0,4,0,7,5,0,5,8,3,5,3,8,3,5,6,2,1,6,1,0,6,1,4,6]],
['dccg,aeib,agei,cafh,fgic,gbhe,dibf,dhfa,behd,,',9,29,1,[2,9,2,10,0,2,4,0,4,9,2,4,5,10,3,5,6,3,1,6,1,9,1,10,1,2,5,1,6,5,6,9,7,2,8,6,8,1,8,10,5,8,4,5,3,4,3,2,0,3,0,6,7,4,7,1,6,7]],
['dced,ebbe,daba,bcea,cdca,,',5,16,1,[2,5,3,5,1,3,2,1,2,5,0,2,4,5,0,6,0,4,0,2,3,6,4,3,4,2,3,4,1,3,1,6]],
['bebc,fffe,ecdd,bdaa,cdea,cbfa,,',6,16,1,[2,6,0,2,3,7,3,6,0,3,1,0,4,7,4,0,4,6,2,4,0,2,0,3,5,7,5,1,5,3,4,5]],
['abeb,dfge,aafd,dfba,gbdc,ccef,ggec,,',7,21,1,[0,7,0,8,0,7,1,8,3,0,3,7,5,3,5,8,4,5,2,4,2,3,0,2,3,0,4,3,4,7,1,4,1,0,1,3,6,5,6,8,4,6]],
['bebd,dfca,dacd,abfe,cfce,fbea,,',6,20,1,[3,6,4,6,5,7,1,7,4,1,3,4,5,6,5,3,4,5,1,4,1,5,0,1,0,3,0,6,2,1,2,4,2,7,1,2,3,0,3,7]],
['ffdh,bhge,dehc,agdc,feag,bcae,dgac,hbbf,,',8,25,1,[1,8,1,9,0,1,4,9,5,8,5,4,2,5,2,1,2,8,0,2,3,5,3,2,3,9,4,3,4,8,0,4,5,0,6,0,6,3,6,9,2,6,7,4,7,5,1,7,1,5]],
['egaf,dfda,eggb,fedc,bbba,cced,agcf,,',7,19,1,[0,7,1,0,6,7,3,6,1,3,1,7,3,1,5,1,5,3,6,5,6,8,0,6,0,8,0,3,4,6,2,4,2,8,3,2,3,7]],
['cbgd,bdae,cfad,ghei,fgif,bhic,gaec,adbf,ehih,,',9,30,1,[0,9,2,9,3,10,1,3,2,1,4,2,4,10,0,4,7,2,0,7,5,0,5,10,6,0,8,5,8,10,5,8,7,5,7,9,1,7,1,9,1,5,8,1,3,8,3,1,3,4,6,8,6,7,4,6,2,4,0,2]],
['dbac,cead,cbed,deaa,cbbe,,',5,16,1,[3,5,3,6,1,3,1,5,1,6,0,1,0,5,2,3,2,6,0,2,0,3,2,0,1,2,4,6,4,0,2,4]],
['adad,eefc,becf,bfda,bfbe,cdac,,',6,19,1,[0,6,2,7,5,2,0,5,0,6,3,0,3,6,3,7,5,0,5,6,1,5,1,7,2,5,2,1,2,3,4,1,4,3,4,7,3,4]],
['egfe,eebc,abgc,fgag,acdd,dabf,fcbd,,',7,22,1,[1,7,1,8,0,1,2,7,3,2,5,0,5,8,3,5,2,3,2,8,5,2,4,5,4,7,2,4,3,2,0,3,0,2,0,1,6,5,6,8,6,7,3,6]],
['cbbc,dafb,ffcb,eddc,eaef,adae,,',6,16,1,[1,6,2,6,0,2,0,6,2,0,1,2,3,0,4,2,5,4,1,5,3,1,4,3,5,4,5,1,4,5,3,4]],
['gdbg,cffa,heac,efba,gefc,aghd,ehdd,hcbb,,',8,24,1,[5,8,6,8,5,6,0,5,0,9,0,8,0,5,7,9,2,7,1,2,1,0,4,1,4,0,7,1,6,7,4,6,5,4,2,5,2,6,2,7,3,5,3,9,3,0,3,6]],
['bbbg,fbda,gaec,afed,gfcc,ceag,dfde,,',7,20,1,[6,7,2,8,2,7,1,2,6,1,4,8,6,4,1,6,3,6,3,7,3,4,2,3,0,2,1,0,4,1,2,4,5,4,5,3,5,7,5,8]],
['ebei,fedi,bdhd,acic,acgh,fbgh,icgb,hfae,fadg,,',9,30,1,[8,9,2,8,3,10,0,3,5,2,5,9,6,5,6,9,6,10,1,6,3,6,3,10,7,0,3,7,1,3,0,1,0,5,1,0,8,3,7,8,7,1,2,7,2,3,4,7,4,9,4,10,5,2,1,5,8,4,5,8]],
['cebc,aced,badd,ceba,deab,,',5,16,1,[1,5,1,6,0,1,2,5,3,2,0,3,0,6,1,0,2,1,3,2,3,6,0,3,4,2,4,1,4,6,4,5]],
['dafc,dcaf,bbeb,afac,bdcd,efee,,',6,19,1,[0,6,0,7,1,7,3,6,3,1,1,0,1,6,3,7,0,3,0,1,4,1,4,6,4,1,2,4,5,0,2,0,2,4,5,7,0,5]],
['cfcg,dbeg,debg,addb,effc,afae,cagb,,',7,22,1,[0,7,1,7,2,7,2,8,1,2,1,8,3,8,1,3,4,0,4,1,2,4,3,2,5,4,3,5,6,8,6,7,5,6,5,1,6,5,0,6,0,1,0,6]],
['afcb,cfab,eefe,cacd,bded,abdf,,',6,19,1,[3,6,4,6,2,4,2,7,4,2,4,6,0,4,0,3,0,7,1,4,0,1,5,7,5,6,5,4,1,5,1,7,3,1,3,5,1,3]],
['hfhe,fgdd,bdab,eabc,ggfh,eche,dgac,afcb,,',8,24,1,[3,8,2,3,6,8,2,6,1,2,3,9,6,3,1,6,7,9,7,8,7,1,3,7,0,3,5,3,0,5,0,1,4,0,4,1,5,0,5,8,3,5,6,4,2,6,2,9]],
['dcbf,effd,agae,caed,ecfa,dgbg,bbgc,,',7,21,1,[0,7,5,8,0,5,6,0,6,8,5,6,5,8,1,5,1,7,2,1,3,5,3,1,2,3,2,8,3,2,0,3,0,5,4,2,4,7,4,3,1,4]],
['bfgf,agec,ifih,eabc,gdeb,dfga,hche,dhbi,icad,,',9,30,1,[0,9,1,10,3,10,6,1,2,6,7,2,3,7,5,3,0,5,0,9,4,0,7,0,6,7,6,10,7,6,8,7,8,3,8,10,2,8,2,9,2,8,4,2,1,2,4,7,1,4,3,1,2,3,5,4,5,9,5,7]],
['aabd,bded,ccdb,ecae,cabe,,',5,15,1,[0,5,1,5,2,0,2,5,3,1,4,6,1,6,1,5,0,1,3,0,2,3,4,1,4,0,3,4,3,6]],
['dbca,babe,cafc,ddfd,ecfb,eeaf,,',6,18,1,[0,6,2,0,2,7,2,6,0,2,4,0,4,7,4,2,1,4,1,0,1,6,0,1,3,0,3,7,0,3,5,7,5,6,4,5]],
['gaac,dgfd,eebc,ecba,gagf,dfbe,fdcb,,',7,22,1,[0,7,0,8,2,7,3,8,2,3,5,2,6,5,6,7,1,6,4,1,0,4,3,0,3,7,2,3,5,0,1,5,4,1,4,8,1,4,6,1,5,6,1,5]],
['cefd,aeaa,fbfd,dcea,cebd,fbbc,,',6,20,1,[0,6,2,6,0,2,0,7,4,6,5,0,4,5,4,7,0,4,5,0,2,5,2,0,2,5,1,2,1,7,1,2,3,2,3,7,3,4,3,6]],
['ceac,chdc,daag,fhhf,bbfh,gdfg,ebga,debe,,',8,24,1,[4,8,3,4,3,8,4,3,1,9,0,9,6,0,5,6,5,3,1,5,1,8,1,9,0,1,7,0,7,4,7,0,5,7,2,5,2,1,2,7,6,5,6,4,0,6,0,9]],
['ccge,efdb,faeb,agba,ddfd,fagc,ebgc,,',7,21,1,[1,7,2,7,0,2,0,8,4,1,5,0,5,8,3,5,3,7,3,8,5,3,4,5,1,4,1,5,2,1,2,3,2,5,6,0,6,8,6,7,1,6]],
['cdgd,ahgd,eife,dibc,gbcc,hefb,iaeb,gaah,hffi,,',9,27,1,[5,9,5,10,2,5,2,10,6,9,6,5,8,2,8,10,7,8,6,7,2,6,5,2,5,8,0,5,1,5,0,1,0,5,3,0,3,9,3,6,3,5,4,0,4,9,1,4,1,8,7,1,4,7]],
['ebdb,dcca,cace,eaae,bbdd,,',5,13,1,[1,5,3,6,2,6,2,1,2,3,1,2,3,5,3,6,4,1,0,4,0,1,0,4,0,6]],
['cfbc,bdeb,cdbe,fdaf,adea,caef,,',6,20,1,[2,6,1,2,1,6,1,7,2,1,2,7,0,2,0,1,3,0,4,3,4,6,4,7,3,4,3,7,0,3,0,2,5,3,5,6,5,4,2,5]],
['bbec,daeg,cggd,cbbe,affd,ecag,fadf,,',7,19,1,[1,7,3,1,5,7,2,8,2,7,0,2,4,8,6,4,6,8,5,6,5,2,0,5,1,5,3,0,2,3,6,1,4,6,1,4,1,8]],
['dabd,ebfe,cdcc,fcab,dbef,feaa,,',6,18,1,[3,6,3,7,2,3,0,2,0,6,0,7,0,2,5,7,1,5,4,1,4,5,4,6,2,4,3,2,1,3,1,6,5,1,3,5]],
['hada,bgec,eagd,cbfh,fgfb,dhdf,eecg,chba,,',8,26,1,[0,8,2,0,2,9,2,8,6,9,1,6,1,2,1,9,4,1,7,8,7,1,3,7,4,3,4,9,3,4,3,1,5,4,6,3,2,6,5,2,0,2,0,8,5,0,2,5,7,0,3,7]],
['fege,aaff,gabe,dbbd,caef,cgbc,gdcd,,',7,21,1,[0,7,2,7,3,8,6,8,5,6,5,2,0,5,0,7,1,0,4,0,4,7,4,1,6,4,6,8,5,6,4,5,2,4,2,1,2,6,3,4,3,8]],
['fcbe,cggf,efga,ddfi,iaha,eidg,caih,bbhh,bdec,,',9,26,1,[2,9,2,10,1,2,1,10,4,9,5,10,6,4,3,6,3,2,5,3,6,5,6,9,1,6,4,1,4,9,5,4,0,5,7,1,0,7,0,6,2,0,2,5,8,6,8,5,8,3,7,8]],
['eeba,dacc,bcab,aedb,ddce,,',5,13,1,[1,5,0,1,2,0,2,1,2,5,0,2,3,2,4,0,4,5,3,4,3,0,1,3,1,4]],
['edbe,adbc,efba,cefa,fdcf,adcb,,',6,20,1,[5,6,1,5,1,6,1,7,2,1,2,6,3,1,3,2,0,3,0,6,0,7,3,0,4,2,4,3,4,7,2,4,0,2,5,3,5,7,1,5]],
['gbdg,aacd,egfc,dcab,cafe,fbee,dbfg,,',7,21,1,[3,7,0,8,1,0,2,1,6,8,2,6,2,8,4,2,5,2,5,7,4,5,3,4,1,3,4,1,3,4,0,3,0,7,0,8,6,5,6,7,3,6]],
['afce,faef,abcd,ceda,fdbb,bedc,,',6,19,1,[0,6,2,7,0,2,1,0,1,6,3,1,3,7,3,6,2,3,4,2,4,7,0,4,0,1,5,3,5,7,5,6,2,5,1,2,1,4]],
['cdba,eeac,fhbe,fgbf,ddfh,daah,gghe,cbgc,,',8,23,1,[0,8,4,9,3,4,0,3,5,9,5,8,0,5,1,0,1,8,2,1,6,1,6,9,7,0,7,6,2,7,2,9,4,2,4,5,3,4,3,6,2,3,7,4,0,7]],
['decg,bbgg,ccec,fada,beaf,edfg,dbfa,,',7,20,1,[0,7,1,7,2,0,3,8,5,7,4,5,4,8,2,4,0,2,0,4,3,0,3,8,5,3,0,5,6,8,6,3,6,1,5,6,4,5,1,4]],
['dcei,dihe,aafc,bfic,gdfc,eged,hbba,ghfg,hiba,,',9,28,1,[4,9,2,9,2,4,3,9,0,3,8,2,4,10,5,4,5,0,6,2,7,5,7,10,8,6,3,8,3,10,6,3,6,7,8,6,7,8,5,7,0,5,0,9,0,4,1,5,1,8,1,6,4,1,4,7]],
['aebc,debb,deab,ceca,adcd,,',5,16,1,[1,5,1,6,2,5,3,2,4,1,3,4,3,6,0,3,0,5,0,6,2,0,2,6,1,2,4,3,4,2,0,4]],
];
'use strict';
var LC = window.LC || (window.LC = {});
LC.CAP = 4;
LC.Board = {
parse: function (s) { return s.split(','); },
top: function (st) { return st.length ? st.charCodeAt(st.length - 1) - 97 : -1; },
/** How many same-colour lanterns sit together on top of string [st]. */
topRun: function (st) {
var n = st.length;
if (!n) return 0;
var c = st[n - 1], k = 1;
while (k < n && st[n - 1 - k] === c) k++;
return k;
},
/** Full of one colour: lit up and locked. */
isComplete: function (st) {
if (st.length !== LC.CAP) return false;
for (var i = 1; i < st.length; i++) if (st[i] !== st[0]) return false;
return true;
},
isWon: function (b) {
for (var i = 0; i < b.length; i++) if (b[i].length && !LC.Board.isComplete(b[i])) return false;
return true;
},
canPick: function (b, i) { return b[i].length > 0 && !LC.Board.isComplete(b[i]); },
/** The move from -> to ({from, to, count, colour}), or null when not allowed. */
moveFor: function (b, from, to) {
if (from === to || !LC.Board.canPick(b, from)) return null;
var dst = b[to], room = LC.CAP - dst.length;
if (room <= 0) return null;
var src = b[from], c = src[src.length - 1];
if (dst.length && dst[dst.length - 1] !== c) return null;
var run = LC.Board.topRun(src);
return { from: from, to: to, count: run < room ? run : room, colour: c.charCodeAt(0) - 97 };
},
/** A new board with the move applied. */
apply: function (b, m) {
var o = b.slice(), ch = String.fromCharCode(97 + m.colour);
o[m.from] = b[m.from].slice(0, b[m.from].length - m.count);
o[m.to] = b[m.to] + ch.repeat(m.count);
return o;
},
/** A new board with the move taken back (undo). */
revert: function (b, m) {
var o = b.slice(), ch = String.fromCharCode(97 + m.colour);
o[m.to] = b[m.to].slice(0, b[m.to].length - m.count);
o[m.from] = b[m.from] + ch.repeat(m.count);
return o;
},
/** Order-independent key: strings are interchangeable for the solver. */
key: function (b) { return b.slice().sort().join('|'); },
};
(function () {
var B = LC.Board;
/** Lower bound on moves left (solver.dart heuristic, consistent). */
function heuristic(b) {
var h = 0, bottoms = {};
for (var i = 0; i < b.length; i++) {
var s = b[i];
if (!s.length) continue;
var runs = 1;
for (var k = 1; k < s.length; k++) if (s[k] !== s[k - 1]) runs++;
h += runs - 1;
bottoms[s[0]] = (bottoms[s[0]] || 0) + 1;
}
for (var c in bottoms) h += bottoms[c] - 1;
return h;
}
/** Moves worth trying (same order as usefulMoves in solver.dart). */
function usefulMoves(b) {
var out = [], firstEmpty = -1;
for (var e = 0; e < b.length; e++) if (!b[e].length) { firstEmpty = e; break; }
for (var f = 0; f < b.length; f++) {
if (!B.canPick(b, f)) continue;
var mono = B.topRun(b[f]) === b[f].length;
for (var t = 0; t < b.length; t++) {
if (!b[t].length && (mono || t !== firstEmpty)) continue;
var m = B.moveFor(b, f, t);
if (m) out.push(m);
}
}
return out;
}
function Heap() { this.a = []; }
function less(x, y) { return x.f < y.f || (x.f === y.f && x.h < y.h); }
Heap.prototype.push = function (n) {
var a = this.a, i = a.length;
a.push(n);
while (i > 0) {
var p = (i - 1) >> 1;
if (!less(a[i], a[p])) break;
var t = a[i]; a[i] = a[p]; a[p] = t;
i = p;
}
};
Heap.prototype.pop = function () {
var a = this.a, top = a[0], last = a.pop();
if (a.length) {
a[0] = last;
var i = 0;
for (;;) {
var l = 2 * i + 1, r = l + 1, m = i;
if (l < a.length && less(a[l], a[m])) m = l;
if (r < a.length && less(a[r], a[m])) m = r;
if (m === i) break;
var t = a[i]; a[i] = a[m]; a[m] = t;
i = m;
}
}
return top;
};
/**
* Resumable weighted A* (weights 1, 1.5, 2, 3 like solve() in solver.dart;
* weight 1 = exact). step(ms) works for about [ms] and returns undefined
* while unfinished, else { moves: [[from, to], ...], optimal, expanded } or
* null (no solution within [maxExpand] states per weight).
*/
function Search(start, maxExpand) {
this.start = start;
this.maxExpand = maxExpand || 400000;
this.weights = [1, 1.5, 2, 3];
this.wi = -1;
this.next();
}
Search.prototype.next = function () {
this.wi++;
if (this.wi >= this.weights.length) { this.done = true; this.result = null; return; }
var w = this.weights[this.wi], h0 = heuristic(this.start);
this.best = new Map();
this.open = new Heap();
this.open.push({ b: this.start, g: 0, f: Math.ceil(h0 * w), h: h0, parent: null, move: null });
this.best.set(B.key(this.start), 0);
this.expanded = 0;
};
Search.prototype.step = function (ms) {
var until = ms === undefined || ms === Infinity ? Infinity : performance.now() + ms, n = 0;
while (!this.done) {
var w = this.weights[this.wi], open = this.open, best = this.best;
if (!open.a.length) { this.next(); continue; }
var node = open.pop(), b = node.b;
if (best.get(B.key(b)) < node.g) continue; // stale entry
if (B.isWon(b)) {
var moves = [];
for (var k = node; k && k.move; k = k.parent) moves.push(k.move);
this.done = true;
this.result = { moves: moves.reverse(), optimal: w === 1, expanded: this.expanded };
break;
}
if (++this.expanded > this.maxExpand) { this.next(); continue; }
var ms2 = usefulMoves(b);
for (var i = 0; i < ms2.length; i++) {
var m = ms2[i], c = B.apply(b, m), key = B.key(c), g = node.g + 1, old = best.get(key);
if (old !== undefined && old <= g) continue;
best.set(key, g);
var h = heuristic(c);
open.push({ b: c, g: g, f: g + Math.ceil(h * w), h: h, parent: node, move: [m.from, m.to] });
}
if ((++n & 255) === 0 && performance.now() > until) return undefined;
}
return this.result;
};
LC.heuristic = heuristic;
LC.Search = Search;
/** Synchronous solve (small boards, tests). */
LC.solve = function (board, maxExpand) { return new Search(board, maxExpand).step(Infinity); };
})();
/** A level row (levels.js) as an object. */
LC.level = function (row, number) {
var sol = row[4], moves = [];
for (var i = 0; i < sol.length; i += 2) moves.push([sol[i], sol[i + 1]]);
return { number: number, stacks: LC.Board.parse(row[0]), colours: row[1], par: row[2], optimal: !!row[3], solution: moves };
};
/** Level [i] (0-based) as played in browsers: the web opener replaces level 1. */
LC.levelAt = function (i) { return LC.level(i === 0 ? LC.WEB_LEVEL1 : LC.LEVELS[i], i + 1); };
/** Stars for finishing in [moves] (levels.dart starsFor). */
LC.starsFor = function (moves, par) {
if (moves <= par) return 3;
if (moves <= par + Math.ceil(par / 4) + 1) return 2;
return 1;
};
LC.freeHintsFor = function (level) { return level === null ? 2 : level <= 50 ? 1 : level <= 150 ? 2 : 3; };
LC.freeUndosFor = function (level) { return level === null || level > 50 ? 2 : 1; };
LC.AD_UNDOS = 2;
LC.AD_HINTS = 1;
/** One play of a level: board, moves, undo history, allowances, +1 string. */
LC.Session = function (level, number) {
this.level = level;
this.board = level.stacks.slice();
this.moves = 0;
this.hintsLeft = LC.freeHintsFor(number);
this.undosLeft = LC.freeUndosFor(number);
this.extraUsed = false;
this.history = [];
};
LC.Session.prototype = {
get won() { return LC.Board.isWon(this.board); },
get canUndo() { return this.history.length > 0 && this.undosLeft > 0; },
get hasHistory() { return this.history.length > 0; },
get stars() { return LC.starsFor(this.moves, this.level.par); },
play: function (from, to) {
var m = LC.Board.moveFor(this.board, from, to);
if (!m) return null;
this.board = LC.Board.apply(this.board, m);
this.history.push(m);
this.moves++;
return m;
},
undo: function () {
if (!this.canUndo) return null;
var m = this.history.pop();
this.board = LC.Board.revert(this.board, m);
this.undosLeft--;
this.moves--;
return m;
},
grantUndos: function () { this.undosLeft += LC.AD_UNDOS; },
grantHint: function () { this.hintsLeft += LC.AD_HINTS; },
useHint: function () {
if (this.hintsLeft === 0) return false;
this.hintsLeft--;
return true;
},
/** The empty bonus string: one at a time; restart takes it away. */
addString: function () {
if (this.extraUsed) return false;
this.extraUsed = true;
this.board = this.board.concat(['']);
return true;
},
/** Back to the level's own strings; allowances are not refilled. */
restart: function () {
this.board = this.level.stacks.slice();
this.extraUsed = false;
this.history = [];
this.moves = 0;
},
};
'use strict';
var LC = window.LC || (window.LC = {});
LC.DAILY_UNLOCK_AFTER = 5;
LC.MILESTONES = [{ day: 3, hints: 2 }, { day: 7, hints: 3 }, { day: 30, hints: 0, badge: true }];
LC.CHAPTERS = ['Riverside', 'Temple Steps', 'Bamboo Grove', 'Moon Bridge', 'Tea Houses',
'Cherry Hill', 'Paper Market', 'Shrine Gate', 'Lantern Tower', 'Sky Festival'];
LC.PER_CHAPTER = 20;
LC.Store = (function () {
var S = VPC.Save;
function migrate() {
if (S.get('migrated', false)) return;
var ns = 'flutter.lantern_chain.', legacy = 'flutter.';
var ownOrigin = ['playgama', 'crazygames'].indexOf(VPC.build.portal) >= 0;
var read = function (k) {
try {
var v = localStorage.getItem(ns + k);
if (v === null && ownOrigin) v = localStorage.getItem(legacy + k);
return v === null ? undefined : JSON.parse(v);
} catch (e) { return undefined; }
};
var n = 0, stars = read('stars');
if (Array.isArray(stars)) {
var got = stars.slice(0, LC.LEVELS.length).map(function (s) { return Math.max(0, Math.min(3, parseInt(s, 10) || 0)); });
if (got.some(function (s) { return s > 0; })) { S.set('stars', got); n++; }
}
var last = read('last');
if (typeof last === 'number') { S.set('last', last); n++; }
var sound = read('sound');
if (typeof sound === 'boolean') { S.set('muted', !sound); n++; }
['tutorial', 'web_goal_card', 'symbols'].forEach(function (k) {
var v = read(k);
if (typeof v === 'boolean') { S.set(k, v); n++; }
});
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
var m = LC.MILESTONES.filter(function (x) { return x.day === s; })[0] || null;
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
return LC.MILESTONES.filter(function (x) { return x.day > s; })[0] || null;
},
/** Today's puzzle (dailyLevel(seed) in daily_data.dart). */
level: function () {
var lv = LC.level(LC.DAILY[daily.seed % LC.DAILY.length], 0);
lv.daily = true;
return lv;
},
};
function stars() { return S.get('stars', []); }
var api = {
migrate: migrate,
daily: daily,
stars: function (n) { return stars()[n - 1] || 0; },
/** Keeps the best stars for level n (1-based); returns true on a first win. */
recordWin: function (n, st) {
var all = stars(), first = !all[n - 1];
while (all.length < n) all.push(0);
if (st > all[n - 1]) { all[n - 1] = st; S.set('stars', all); }
S.set('last', n - 1);
return first;
},
get levelsWon() { return stars().filter(function (s) { return s > 0; }).length; },
get totalStars() { return stars().reduce(function (a, b) { return a + b; }, 0); },
/** Level n (1-based) is open once the one before it is cleared. */
isOpen: function (n) { return n <= api.playable && (n === 1 || api.stars(n - 1) > 0); },
/** Where "Continue" goes (0-based): the first uncleared level. */
get next() {
var all = stars();
for (var i = 0; i < api.playable; i++) if (!all[i]) return i;
return Math.min(S.get('last', 0), api.playable - 1);
},
get brandNew() { return api.levelsWon === 0; },
get tutorialDone() { return S.get('tutorial', false); },
markTutorialDone: function () { S.set('tutorial', true); },
get goalCardSeen() { return S.get('web_goal_card', false); },
markGoalCardSeen: function () { S.set('web_goal_card', true); },
get symbols() { return S.get('symbols', true); },
set symbols(on) { S.set('symbols', !!on); },
get dailyUnlocked() { return api.levelsWon >= LC.DAILY_UNLOCK_AFTER; },
/** The one-time "Daily Challenge unlocked!" card (VPC.DailyUnlock, saved as lc.daily_card). */
get dailyCardSeen() { return VPC.DailyUnlock.seen; },
/** Wins in a row at par (3 stars), for the win card. */
get perfectRun() { return S.get('perfect_run', 0); },
set perfectRun(n) { S.set('perfect_run', n); },
/** Levels in this build (demo builds stop early). */
get playable() { return VPC.build.demoLevels > 0 ? Math.min(VPC.build.demoLevels, LC.LEVELS.length) : LC.LEVELS.length; },
};
return api;
})();
VPC.DailyUnlock.setup({
unlocked: function () { return LC.Store.dailyUnlocked; },
daily: function () { return LC.Store.daily; },
milestones: LC.MILESTONES,
lockedNote: 'Clear level ' + LC.DAILY_UNLOCK_AFTER + ' to unlock',
blurb: 'A new festival puzzle every day. Solve it to grow your streak.', badgeWord: 'festival badge',
titleInk: '#FFFFFF', titleGlow: '#FF3DA8', blurbInk: '#9BFBFF', headInk: '#FF7AC6', dayInk: '#FFD34D', rewardInk: '#FFFFFF',
goalInk: '#FFD34D', icon: 0xFFD34D, noteInk: '#9BFBFF',
cardOpts: { border: '#FFD34D', dimColor: '#0B0820', dimAlpha: 0.55 },
});
/** Chapter (0-based) of level index i (0-based). */
LC.chapterOf = function (i) { return Math.floor(i / LC.PER_CHAPTER); };
'use strict';
var LC = window.LC || (window.LC = {});
LC.COLORS = [
['sakura', 0xFF5FB0, 'dot'], ['cyan', 0x2FE4FF, 'triangle'], ['gold', 0xFFC83A, 'square'],
['jade', 0x3CE07C, 'plus'], ['violet', 0xA77BFF, 'star'], ['vermilion', 0xFF4238, 'diamond'],
['moon', 0xEDEFFF, 'moon'], ['blue', 0x3F7DFF, 'ring'], ['orange', 0xFF8F1F, 'bars'],
['lime', 0xB8F03A, 'cross'], ['umber', 0xA8643A, 'heart'], ['steel', 0x8A93B8, 'hexagon'],
];
LC.INK = '#0B0820';
LC.PINK = 0xFF3DA8;
LC.CYAN = 0x00F0FF;
LC.GOLD = 0xFFD34D;
LC.ASPECT = 0.84; // lantern body height / width
LC.TEX_W = 100;   // lantern width inside its texture (px)
LC.art = (function () {
function rgb(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
function mix(c, to, k) {
var a = rgb(c), b = rgb(to);
return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * k); }).join(',') + ')';
}
function rgba(c, a) { var v = rgb(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }
function symbol(c, sym, size, color) {
var r = size / 2;
c.fillStyle = color; c.strokeStyle = color; c.lineWidth = size * 0.17; c.lineCap = 'round';
c.beginPath();
switch (sym) {
case 'dot': c.arc(0, 0, r * 0.62, 0, Math.PI * 2); c.fill(); break;
case 'triangle': c.moveTo(0, -r * 0.8); c.lineTo(r * 0.82, r * 0.62); c.lineTo(-r * 0.82, r * 0.62); c.closePath(); c.fill(); break;
case 'square': VPC.UI.roundRect(c, -r * 0.6, -r * 0.6, r * 1.2, r * 1.2, r * 0.12); c.fill(); break;
case 'plus': c.moveTo(-r * 0.7, 0); c.lineTo(r * 0.7, 0); c.moveTo(0, -r * 0.7); c.lineTo(0, r * 0.7); c.stroke(); break;
case 'star':
for (var k = 0; k < 10; k++) {
var a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.4 : r * 0.92;
c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr + r * 0.06);
}
c.closePath(); c.fill(); break;
case 'diamond': c.moveTo(0, -r * 0.85); c.lineTo(r * 0.62, 0); c.lineTo(0, r * 0.85); c.lineTo(-r * 0.62, 0); c.closePath(); c.fill(); break;
case 'moon':
c.arc(0, 0, r * 0.72, 0, Math.PI * 2); c.fill();
c.globalCompositeOperation = 'destination-out';
c.beginPath(); c.arc(r * 0.38, -r * 0.2, r * 0.6, 0, Math.PI * 2); c.fill();
c.globalCompositeOperation = 'source-over'; break;
case 'ring': c.lineWidth = size * 0.16; c.arc(0, 0, r * 0.56, 0, Math.PI * 2); c.stroke(); break;
case 'bars': c.moveTo(-r * 0.66, -r * 0.36); c.lineTo(r * 0.66, -r * 0.36); c.moveTo(-r * 0.66, r * 0.36); c.lineTo(r * 0.66, r * 0.36); c.stroke(); break;
case 'cross': c.moveTo(-r * 0.55, -r * 0.55); c.lineTo(r * 0.55, r * 0.55); c.moveTo(r * 0.55, -r * 0.55); c.lineTo(-r * 0.55, r * 0.55); c.stroke(); break;
case 'heart':
c.moveTo(0, r * 0.7); c.bezierCurveTo(-r * 1.1, -r * 0.05, -r * 0.55, -r * 0.85, 0, -r * 0.32);
c.bezierCurveTo(r * 0.55, -r * 0.85, r * 1.1, -r * 0.05, 0, r * 0.7); c.closePath(); c.fill(); break;
case 'hexagon':
for (var j = 0; j < 6; j++) { var b = Math.PI / 6 + j * Math.PI / 3; c.lineTo(Math.cos(b) * r * 0.72, Math.sin(b) * r * 0.72); }
c.closePath(); c.fill(); break;
}
}
/** One paper lantern (paintLantern in lanterns.dart, no halo) centred at 0,0, [w] wide. */
function lantern(c, colour, w, withSym) {
var lc = LC.COLORS[colour % LC.COLORS.length], base = lc[1], h = w * LC.ASPECT;
var dark = mix(base, 0x000000, 0.5);
var capW = w * 0.5, capH = h * 0.14;
[-h / 2 + capH * 0.15, h / 2 - capH * 0.15].forEach(function (y) {
VPC.UI.roundRect(c, -capW / 2, y - capH / 2, capW, capH, capH * 0.35);
c.fillStyle = '#2A1712'; c.fill();
c.lineWidth = Math.max(1, w * 0.022); c.strokeStyle = 'rgba(255,200,107,0.85)'; c.stroke();
});
var bh = h * 0.9;
c.save();
c.beginPath(); c.ellipse(0, 0, w / 2, bh / 2, 0, 0, Math.PI * 2);
var g = c.createRadialGradient(-w * 0.08, -h * 0.1, 0, -w * 0.08, -h * 0.1, w * 0.62);
g.addColorStop(0, mix(base, 0xFFFFFF, 0.6 + 0.4 * 0.25)); g.addColorStop(0.5, rgba(base, 1)); g.addColorStop(1, dark);
c.fillStyle = g; c.fill();
c.clip();
c.strokeStyle = mix(base, 0x000000, 0.5).replace('rgb', 'rgba').replace(')', ',0.38)');
c.lineWidth = Math.max(0.8, w * 0.022);
for (var k = -2; k <= 2; k++) {
var y = k * h * 0.17;
c.beginPath(); c.moveTo(-w / 2, y - h * 0.03); c.quadraticCurveTo(0, y + h * 0.07, w / 2, y - h * 0.03); c.stroke();
}
c.fillStyle = 'rgba(255,255,255,0.22)';
c.beginPath(); c.ellipse(-w * 0.27, -h * 0.06, w * 0.08, h * 0.25, 0, 0, Math.PI * 2); c.fill();
c.restore();
c.beginPath(); c.ellipse(0, 0, w / 2, bh / 2, 0, 0, Math.PI * 2);
c.lineWidth = Math.max(1, w * 0.03); c.strokeStyle = mix(base, 0x000000, 0.5).replace('rgb', 'rgba').replace(')', ',0.75)'); c.stroke();
if (withSym) {
c.save(); c.scale(1.22, 1.22); symbol(c, lc[2], w * 0.4, 'rgba(255,255,255,0.45)'); c.restore();
symbol(c, lc[2], w * 0.4, mix(base, 0x12081C, 0.78));
}
}
function lanternKey(colour, withSym) { return 'lc-l' + colour + (withSym ? 's' : ''); }
/** Texture key for colour [c] (made on first use: only the colours a level needs). */
function ensureLantern(scene, colour, withSym) {
var key = lanternKey(colour, withSym);
VPC.Juice.canvasTexture(scene, key, 128, 112, function (c) {
c.translate(64, 56);
lantern(c, colour, LC.TEX_W, withSym);
});
return key;
}
function radial(c, w, h, stops) {
var g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) / 2);
stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function textures(scene) {
var T = VPC.Juice.canvasTexture;
T(scene, 'lc-halo', 128, 128, function (c, w, h) {
radial(c, w, h, [[0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
});
T(scene, 'lc-glowline', 32, 8, function (c) {
var g = c.createLinearGradient(0, 0, 32, 0);
g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
c.fillStyle = g; c.fillRect(0, 0, 32, 8);
});
T(scene, 'lc-petal', 24, 16, function (c) {
c.fillStyle = '#FF9CCB'; c.beginPath(); c.ellipse(12, 8, 11, 6, 0, 0, Math.PI * 2); c.fill();
c.fillStyle = '#FFD6E8'; c.beginPath(); c.ellipse(9, 7, 5, 3, 0, 0, Math.PI * 2); c.fill();
});
T(scene, 'lc-skylantern', 40, 56, function (c) {
radial(c, 40, 56, [[0, 'rgba(255,192,122,0.55)'], [1, 'rgba(255,192,122,0)']]);
c.fillStyle = '#FFC07A'; VPC.UI.roundRect(c, 13, 18, 14, 20, 5); c.fill();
c.fillStyle = '#FFE9C4'; VPC.UI.roundRect(c, 16, 21, 8, 12, 3); c.fill();
});
T(scene, 'lc-spark', 32, 32, function (c) {
c.fillStyle = '#fff'; c.beginPath();
for (var k = 0; k < 8; k++) { var a = k * Math.PI / 4, r = k % 2 ? 4 : 15; c.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r); }
c.closePath(); c.fill();
});
T(scene, 'lc-tassel', 20, 40, function (c) {
c.fillStyle = '#fff'; c.beginPath(); c.arc(10, 6, 5, 0, Math.PI * 2); c.fill();
c.beginPath(); c.moveTo(6, 8); c.lineTo(14, 8); c.lineTo(17, 38); c.lineTo(3, 38); c.closePath(); c.fill();
});
var icon = function (name, draw) {
T(scene, 'vpc-icon-' + name, 64, 64, function (c) { c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineJoin = 'round'; draw(c); });
};
icon('undo', function (c) {
c.lineWidth = 8; c.beginPath(); c.moveTo(18, 26); c.lineTo(40, 26); c.arc(40, 38, 12, -Math.PI / 2, Math.PI / 2); c.lineTo(24, 50); c.stroke();
c.beginPath(); c.moveTo(6, 26); c.lineTo(22, 12); c.lineTo(22, 40); c.closePath(); c.fill();
});
icon('plus', function (c) { c.lineWidth = 10; c.beginPath(); c.moveTo(32, 12); c.lineTo(32, 52); c.moveTo(12, 32); c.lineTo(52, 32); c.stroke(); });
icon('symbols', function (c) {
c.beginPath(); c.moveTo(18, 8); c.lineTo(30, 28); c.lineTo(6, 28); c.closePath(); c.fill();
c.fillRect(36, 8, 20, 20); c.beginPath(); c.arc(18, 46, 10, 0, Math.PI * 2); c.fill();
c.lineWidth = 7; c.beginPath(); c.moveTo(46, 36); c.lineTo(46, 56); c.moveTo(36, 46); c.lineTo(56, 46); c.stroke();
});
icon('lantern', function (c) {
c.fillRect(24, 6, 16, 6); c.fillRect(24, 52, 16, 6);
c.beginPath(); c.ellipse(32, 32, 20, 18, 0, 0, Math.PI * 2); c.fill();
});
}
var SKY = ['#0B0820', '#1B1446', '#2E2A6B', '#6A2F72', '#B0457A'];
var HILLS = ['#3A2463', '#26173F', '#150C26'];
function seeded(n) { var s = n; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
function paintValley(c, w, h, moonX) {
var g = c.createLinearGradient(0, 0, 0, h);
SKY.forEach(function (col, i) { g.addColorStop(i / (SKY.length - 1), col); });
c.fillStyle = g; c.fillRect(0, 0, w, h);
var r = seeded(7), k;
for (k = 0; k < 90; k++) {
var sx = r() * w, sy = r() * h * 0.55, a = 0.25 + r() * 0.6;
c.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
c.fillRect(sx, sy, 1 + (r() > 0.85 ? 1 : 0), 1 + (r() > 0.85 ? 1 : 0));
}
var m = Math.min(w, h), mx = w * moonX, my = h * 0.17, mr = m * 0.07;
if (moonX < 0) mx = -9999; // no moon (wide Play: the side panels would cover it)
var mg = c.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 3.2);
mg.addColorStop(0, 'rgba(255,217,160,0.35)'); mg.addColorStop(1, 'rgba(255,217,160,0)');
c.fillStyle = mg; c.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
c.fillStyle = '#FFF0CF'; c.beginPath(); c.arc(mx, my, mr, 0, Math.PI * 2); c.fill();
c.fillStyle = 'rgba(230,200,150,0.35)'; c.beginPath(); c.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, Math.PI * 2); c.fill();
HILLS.forEach(function (col, i) {
var base = h * (0.66 + i * 0.1), amp = h * (0.06 - i * 0.012), f = 2.2 + i * 1.3, ph = i * 1.7;
c.fillStyle = col; c.beginPath(); c.moveTo(0, h);
for (var x = 0; x <= w; x += Math.max(2, w / 120)) c.lineTo(x, base - amp * (0.6 + 0.4 * Math.sin(x / w * Math.PI * f + ph)) - amp * 0.3 * Math.sin(x / w * 17 + ph));
c.lineTo(w, h); c.closePath(); c.fill();
if (i > 0) {
for (var j = 0; j < 14; j++) {
var lx = r() * w, ly = base + r() * (h - base) * 0.5;
var lg = c.createRadialGradient(lx, ly, 0, lx, ly, m * 0.012);
lg.addColorStop(0, 'rgba(255,200,120,0.9)'); lg.addColorStop(1, 'rgba(255,170,90,0)');
c.fillStyle = lg; c.fillRect(lx - m * 0.02, ly - m * 0.02, m * 0.04, m * 0.04);
}
}
});
var cols = ['#FF3DA8', '#FFD34D', '#2FE4FF', '#3CE07C', '#FF8F1F'], step = Math.max(16, m * 0.045), sag = h * 0.035;
c.strokeStyle = 'rgba(232,201,160,0.6)'; c.lineWidth = Math.max(1, m * 0.002);
c.beginPath(); c.moveTo(0, 0);
for (var x2 = 0; x2 <= w; x2 += step / 2) c.lineTo(x2, sag * Math.sin(Math.PI * x2 / w));
c.stroke();
for (k = 0; k * step < w; k++) {
var bx = k * step + step / 2, by = sag * Math.sin(Math.PI * bx / w);
c.fillStyle = cols[k % cols.length]; c.globalAlpha = 0.75;
c.beginPath(); c.moveTo(bx - step * 0.32, by); c.lineTo(bx + step * 0.32, by); c.lineTo(bx, by + step * 0.6); c.closePath(); c.fill();
c.globalAlpha = 1;
}
}
/**
* The valley behind a scene: layout(v) repaints for the window size;
* petals and sky lanterns drift on the scene's update. dim darkens it.
*/
function backdrop(scene, opts) {
opts = opts || {};
var img = scene.add.image(0, 0, '__WHITE').setOrigin(0).setDepth(-20);
var dim = scene.add.rectangle(0, 0, 10, 10, 0x0B0820, opts.dim || 0).setOrigin(0).setDepth(-19);
var r = seeded(11), view = VPC.view(scene), key = null;
var lanterns = [], petals = [], k;
for (k = 0; k < 9; k++) lanterns.push({ img: scene.add.image(0, 0, 'lc-skylantern').setDepth(-18), x: r(), y: r(), sp: 0.006 + r() * 0.01, sc: 0.5 + r() * 0.6 });
for (k = 0; k < 18; k++) petals.push({ img: scene.add.image(0, 0, 'lc-petal').setDepth(-17), x: r(), y: r(), sp: 0.025 + r() * 0.03, dr: r() * 6.28, sc: 0.4 + r() * 0.5, spin: (r() - 0.5) * 3 });
function layout(v) {
view = v;
var w = Math.max(64, Math.round(v.w / 2)), h = Math.max(64, Math.round(v.h / 2));
var moonX = typeof opts.moonX === 'function' ? opts.moonX(v) : opts.moonX || 0.8;
var nk = 'lc-valley-' + w + 'x' + h + '-' + moonX;
if (nk !== key) {
if (!scene.textures.exists(nk)) VPC.Juice.canvasTexture(scene, nk, w, h, function (c) { paintValley(c, w, h, moonX); });
img.setTexture(nk);
if (key && scene.textures.exists(key)) scene.textures.remove(key);
key = nk;
}
img.setDisplaySize(v.w, v.h);
dim.setSize(v.w, v.h);
}
var tick = function (t, dt) {
var s = dt / 1000, u = view.s * Math.min(1.2, Math.max(0.6, view.cssH / 760));
lanterns.forEach(function (d) {
d.y -= d.sp * s;
if (d.y < -0.1) { d.y = 1.05; d.x = r(); }
d.img.setScale(d.sc * u).setPosition(d.x * view.w + Math.sin(t / 2600 + d.x * 9) * 10 * view.s, (0.1 + d.y * 0.6) * view.h)
.setAlpha(0.45 + 0.35 * Math.sin(t / 900 + d.x * 20));
});
petals.forEach(function (d) {
d.y += d.sp * s;
if (d.y > 1.05) { d.y = -0.05; d.x = r(); }
d.img.setScale(d.sc * u).setRotation(t / 1000 * d.spin + d.dr)
.setPosition((d.x + 0.04 * Math.sin(t / 1500 + d.dr)) * view.w, d.y * view.h).setAlpha(0.75);
});
};
scene.events.on('update', tick);
scene.events.once('shutdown', function () { scene.events.off('update', tick); });
return { layout: layout, setDim: function (a) { dim.setFillStyle(0x0B0820, a); } };
}
return {
textures: textures,
lantern: ensureLantern,
backdrop: backdrop,
paintLantern: lantern,
rgba: rgba,
mix: mix,
};
})();
'use strict';
var LC = window.LC || (window.LC = {});
/** A glowing hero lantern (title art): halo + lantern in a container. */
LC.heroLantern = function (scene, colour) {
var key = LC.art.lantern(scene, colour, LC.Store.symbols);
var halo = scene.add.image(0, 0, 'lc-halo').setTint(LC.COLORS[colour][1]).setBlendMode(Phaser.BlendModes.ADD).setScale(1.9);
var img = scene.add.image(0, 0, key);
var rope = scene.add.rectangle(0, -60, 3, 70, 0xE8C9A0, 0.85);
return scene.add.container(0, 0, [rope, halo, img]);
};
LC.Home = new Phaser.Class({
Extends: Phaser.Scene,
initialize: function Home() { Phaser.Scene.call(this, { key: 'Home' }); },
create: function () {
var self = this, st = LC.Store, UI = VPC.UI;
VPC.Portal.gameplayStop();
this.bg = LC.art.backdrop(this, { dim: 0.1 });
this.heroes = [4, 0, 1].map(function (c) { return LC.heroLantern(self, c); });
this.title1 = UI.text(this, 0, 0, 'LANTERN', 58, '#FFFFFF', { stroke: '#FF3DA8', strokeWidth: 3, shadow: '#FF3DA8', shadowY: 0, blur: 18 });
this.title2 = UI.text(this, 0, 0, 'CHAIN', 58, '#FFF3C4', { stroke: '#FF7A3D', strokeWidth: 3, shadow: '#FF3DA8', shadowY: 0, blur: 18 });
this.tag = UI.text(this, 0, 0, 'Sort the lanterns. Light the festival.', 18, '#9BFBFF', { weight: '700' });
var next = st.next;
this.play = UI.button(this, {
label: st.brandNew ? 'Play' : 'Continue · Level ' + (next + 1), icon: 'play', primary: true, w: 310, h: 70, fontSize: 25,
onPress: function () { self.go('Play', { idx: next }); },
});
this.levels = UI.button(this, { label: 'Levels', icon: 'grid', w: 310, h: 58, fontSize: 21, onPress: function () { self.go('Levels', {}); } });
this.daily = VPC.DailyUnlock.button(this, 310, 58, 21, function () { self.go('Play', { daily: true }); });
this.dailyNote = VPC.DailyUnlock.note(this);
this.btnSound = UI.button(this, { icon: VPC.Audio.muted ? 'mute' : 'sound', w: 60, h: 54, onPress: function () {
VPC.Audio.setMuted(!VPC.Audio.muted);
self.btnSound.setIcon(VPC.Audio.muted ? 'mute' : 'sound');
} });
this.btnMusic = UI.button(this, { icon: 'music', w: 60, h: 54, onPress: function () {
VPC.Audio.setMusic(!VPC.Audio.musicOn);
self.btnMusic.setAlpha(VPC.Audio.musicOn ? 1 : 0.45);
} });
this.btnMusic.setAlpha(VPC.Audio.musicOn ? 1 : 0.45);
this.btnSym = UI.button(this, { icon: 'symbols', w: 60, h: 54, onPress: function () {
st.symbols = !st.symbols;
self.btnSym.setAlpha(st.symbols ? 1 : 0.45);
VPC.UI.toast(self, st.symbols ? 'Colour symbols on' : 'Colour symbols off');
self.scene.restart();
} });
this.btnSym.setAlpha(st.symbols ? 1 : 0.45);
var stars = st.totalStars;
this.stars = UI.text(this, 0, 0, stars ? stars + ' / ' + st.playable * 3 + ' stars' : '', 16, '#FFD34D');
this.starIcon = this.add.image(0, 0, 'vpc-icon-star').setTint(LC.GOLD).setVisible(!!stars);
this.demo = UI.text(this, 0, 0, VPC.build.demoLevels ? 'Demo: the first ' + st.playable + ' levels' : '', 15, '#9BFBFF', { weight: '600' });
VPC.Keys.bind(this, { Enter: function () { self.play.press(); }, Space: function () { self.play.press(); } });
VPC.onResize(this, function (v) { self.layout(v); });
this.heroes.forEach(function (h, k) {
self.tweens.add({ targets: h, angle: { from: -3, to: 3 }, duration: 1700 + k * 230, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: k * 200 });
});
this.cameras.main.fadeIn(180, 11, 8, 32);
this.game.events.once('postrender', VPC.ready);
},
layout: function (v) {
var u = v.s, cx = v.cx, k = Math.min(1, v.cssH / 780, v.cssW / 420);
this.bg.layout(v);
var top = v.h * 0.05;
var hs = 0.62 * u * k;
this.heroes.forEach(function (h, i) {
h.setScale(hs * (i === 1 ? 1.2 : 0.95));
h.x = cx + (i - 1) * 104 * u * k;
h.y = top + (i === 1 ? 84 : 100) * u * k;
});
this.title1.setScale(k).setPosition(cx, top + 182 * u * k);
this.title2.setScale(k).setPosition(cx, top + 240 * u * k);
this.tag.setScale(Math.min(1, k * 1.05)).setPosition(cx, top + 292 * u * k);
var y = top + 362 * u * k, bk = Math.min(1, k * 1.08);
this.play.setScale(bk).setPosition(cx, y);
this.levels.setScale(bk).setPosition(cx, y + 84 * u * bk);
this.daily.setScale(bk).setPosition(cx, y + 156 * u * bk);
this.dailyNote.setScale(bk).setPosition(cx, y + 200 * u * bk);
this.btnSound.setScale(bk).setPosition(cx - 72 * u * bk, y + 252 * u * bk);
this.btnMusic.setScale(bk).setPosition(cx, y + 252 * u * bk);
this.btnSym.setScale(bk).setPosition(cx + 72 * u * bk, y + 252 * u * bk);
this.stars.setScale(bk).setPosition(cx + 12 * u * bk, Math.min(v.h - 40 * u, y + 304 * u * bk));
this.starIcon.setDisplaySize(20 * u * bk, 20 * u * bk).setPosition(this.stars.x - this.stars.displayWidth / 2 - 14 * u * bk, this.stars.y);
this.demo.setScale(bk).setPosition(cx, Math.min(v.h - 16 * u, y + 330 * u * bk));
},
go: function (key, data) {
var self = this;
this.cameras.main.fadeOut(160, 11, 8, 32);
this.cameras.main.once('camerafadeoutcomplete', function () { self.scene.start(key, data); });
},
});
LC.Levels = new Phaser.Class({
Extends: Phaser.Scene,
initialize: function Levels() { Phaser.Scene.call(this, { key: 'Levels' }); },
init: function (data) {
var st = LC.Store;
this.per = LC.PER_CHAPTER;
this.pages = Math.ceil(st.playable / this.per);
this.page = data && data.page !== undefined ? data.page : Math.min(this.pages - 1, Math.floor(st.next / this.per));
},
create: function () {
var self = this, UI = VPC.UI;
VPC.Portal.gameplayStop();
this.bg = LC.art.backdrop(this, { dim: 0.3 });
this.back = UI.button(this, { icon: 'back', w: 58, h: 52, onPress: function () { self.leave('Home', {}); } });
this.heading = UI.text(this, 0, 0, '', 28, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 12 });
this.blurb = UI.text(this, 0, 0, '', 15, '#9BFBFF', { weight: '700' });
this.prev = UI.button(this, { icon: 'back', w: 64, h: 56, onPress: function () { self.turn(-1); } });
this.next = UI.button(this, { icon: 'next', w: 64, h: 56, onPress: function () { self.turn(1); } });
this.pageText = UI.text(this, 0, 0, '', 16, '#9BFBFF', { weight: '700' });
this.daily = VPC.DailyUnlock.button(this, 280, 52, 19, function () { self.leave('Play', { daily: true }); });
this.dailyNote = VPC.DailyUnlock.note(this);
this.tiles = this.add.container(0, 0);
VPC.Keys.bind(this, {
ArrowLeft: function () { self.turn(-1); }, ArrowRight: function () { self.turn(1); },
Enter: function () { self.leave('Play', { idx: LC.Store.next }); },
});
VPC.onResize(this, function (v) { self.layout(v); });
this.cameras.main.fadeIn(160, 11, 8, 32);
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
var self = this, u = v.s, st = LC.Store, UI = VPC.UI;
this.bg.layout(v);
var first = this.page * this.per, last = Math.min(st.playable, first + this.per), lit = 0;
for (var i = first; i < last; i++) if (st.stars(i + 1)) lit++;
this.heading.setText('Chapter ' + (this.page + 1) + ' · ' + LC.CHAPTERS[this.page]).setPosition(v.cx, 44 * u);
this.heading.setScale(Math.min(1, (v.w - 150 * u) / Math.max(1, this.heading.width)));
this.blurb.setText(lit + ' of ' + (last - first) + ' lit').setPosition(v.cx, 80 * u);
this.back.setPosition(44 * u, 44 * u);
var locked = !st.dailyUnlocked;
this.daily.setPosition(v.cx, 128 * u);
this.dailyNote.setPosition(v.cx, 166 * u);
var cols = v.wide ? 10 : 5, rows = Math.ceil(this.per / cols);
var top = (locked ? 186 : 164) * u;
var cell = Math.min((v.w - 32 * u) / cols, (v.h - top - 112 * u) / rows, 96 * u);
var gw = cell * cols;
this.tiles.removeAll(true);
for (var n = first; n < last; n++) {
(function (n) {
var k = n - first, x = v.cx - gw / 2 + (k % cols + 0.5) * cell, y = top + (Math.floor(k / cols) + 0.5) * cell;
var open = st.isOpen(n + 1), stars = st.stars(n + 1), current = n === st.next;
var t = UI.button(self, {
label: open ? String(n + 1) : '', icon: open ? null : 'lock', primary: current, w: cell / u - 12, h: cell / u - 26, fontSize: Math.min(24, cell / u * 0.3),
enabled: open, onPress: function () { self.leave('Play', { idx: n }); },
});
t.setPosition(x, y - 8 * u);
self.tiles.add(t);
for (var s = 0; s < 3; s++) {
var img = self.add.image(x + (s - 1) * cell * 0.2, y + cell * 0.36, 'vpc-icon-star').setDisplaySize(cell * 0.2, cell * 0.2).setTint(s < stars ? LC.GOLD : 0x3A3266);
if (!open) img.setAlpha(0.4);
self.tiles.add(img);
}
})(n);
}
var by = Math.min(v.h - 44 * u, top + rows * cell + 46 * u);
this.prev.setPosition(v.cx - 120 * u, by).setEnabled(this.page > 0);
this.next.setPosition(v.cx + 120 * u, by).setEnabled(this.page < this.pages - 1);
this.pageText.setText((first + 1) + '–' + last + (VPC.build.demoLevels ? '  (demo)' : '  of ' + st.playable)).setPosition(v.cx, by);
},
leave: function (key, data) {
var self = this;
this.cameras.main.fadeOut(160, 11, 8, 32);
this.cameras.main.once('camerafadeoutcomplete', function () { self.scene.start(key, data); });
},
});
'use strict';
var LC = window.LC || (window.LC = {});
LC.FLIGHT = 0.46;   // s per lantern flight
LC.STAGGER = 0.075; // s between lanterns of one move
LC.RULES = ['How to play', [
'Click a string to lift its top lanterns, then click another string to move them there.',
'Lanterns only land on an empty string or on the same colour, 4 to a string.',
'Fill a string with 4 of one colour to light it. Light every string to win.',
'Par moves = 3 stars. Undo, Hint and +1 String help when you are stuck.',
]];
/** Where each string hangs in a board rect (BoardLayout in board_scene.dart), game px. */
LC.BoardLayout = function (x0, y0, w, h, n, u) {
var rows = n <= 6 ? 1 : 2, perRow = Math.ceil(n / rows), pad = 10 * u;
var colW = (w - pad * 2) / perRow;
var ropeW = LC.ASPECT * 1.04 * (LC.CAP + 1) + 0.25;
var fitH = h / (rows * (ropeW + 0.55) + (rows - 1) * 0.45 + 0.7);
var lw = Math.min(colW * 0.76, fitH, 72 * u);
var slotH = lw * LC.ASPECT * 1.04, ropeLen = slotH * (LC.CAP + 1) + lw * 0.25;
var totalH = rows * (ropeLen + lw * 0.55) + (rows - 1) * lw * 0.45;
var top0 = y0 + (h - totalH) / 2 + lw * 0.35, hooks = [];
for (var i = 0; i < n; i++) {
var r = i < perRow ? 0 : 1, inRow = r === 0 ? Math.min(n, perRow) : n - perRow, k = r === 0 ? i : i - perRow;
hooks.push([x0 + w / 2 + (k - (inRow - 1) / 2) * colW, top0 + r * (ropeLen + lw)]);
}
this.n = n; this.rows = rows; this.perRow = perRow; this.colW = colW; this.lw = lw;
this.slotH = slotH; this.ropeLen = ropeLen; this.hooks = hooks;
};
LC.BoardLayout.prototype = {
bottom: function (i) { return this.hooks[i][1] + this.ropeLen; },
/** Unswayed centre of lantern k (0 = bottom) on string i. */
slot: function (i, k) { return [this.hooks[i][0], this.bottom(i) - this.lw * 0.18 - (k + 0.5) * this.slotH]; },
/** Row extent for the beam: [x0, x1, y]. */
row: function (r) {
var xs = [], y = this.hooks[r === 0 ? 0 : this.perRow][1];
for (var i = 0; i < this.n; i++) if ((i < this.perRow ? 0 : 1) === r) xs.push(this.hooks[i][0]);
return [Math.min.apply(null, xs) - this.colW * 0.5, Math.max.apply(null, xs) + this.colW * 0.5, y];
},
hit: function (x, y) {
for (var i = 0; i < this.n; i++) {
var h = this.hooks[i];
if (x >= h[0] - this.colW / 2 && x <= h[0] + this.colW / 2 && y >= h[1] - this.lw * 0.6 && y <= this.bottom(i) + this.lw * 0.4) return i;
}
return -1;
},
};
function rot(p, pivot, a) {
var dx = p[0] - pivot[0], dy = p[1] - pivot[1], c = Math.cos(a), s = Math.sin(a);
return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
}
function easeOut3(u) { u = Math.max(0, Math.min(1, u)); return 1 - Math.pow(1 - u, 3); }
function easeInOut3(u) { u = Math.max(0, Math.min(1, u)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
function backOut(u) { u = Math.max(0, Math.min(1, u)); var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); }
LC.Play = new Phaser.Class({
Extends: Phaser.Scene,
initialize: function Play() { Phaser.Scene.call(this, { key: 'Play' }); },
init: function (data) {
var st = LC.Store;
data = data || {};
this.daily = !!data.daily;
this.idx = this.daily ? -1 : Math.max(0, Math.min(data.idx || 0, st.playable - 1));
this.level = this.daily ? st.daily.level() : LC.levelAt(this.idx);
this.s = new LC.Session(this.level, this.daily ? null : this.idx + 1);
this.t = 0;
this.selected = -1; this.selT = 0;
this.dropping = -1; this.dropT = 0;
this.flights = [];
this.completeAt = {}; this.bounceAt = {}; this.shakeAt = {}; this.appearAt = {};
this.completedCount = 0;
this.winAt = null; this.festivalAt = null; this.festDone = false; this.won = false; this.winShown = false;
this.hint = null; this.hintAt = 0;
this.hintSearch = null;
this.gen = 0;          // bumped on every board change (stale async results are dropped)
this.card = null;
this.downOn = -1;
this.reward = null;
this.leaving = false;
this.lay = null;
},
create: function () {
var self = this, st = LC.Store, UI = VPC.UI;
this.bg = LC.art.backdrop(this, { dim: 0.05, moonX: function (v) { return v.wide ? -1 : 0.12; } });
this.sym = st.symbols;
var cols = {};
this.level.stacks.join('').split('').forEach(function (ch) { cols[ch.charCodeAt(0) - 97] = 1; });
Object.keys(cols).forEach(function (c) { LC.art.lantern(self, +c, self.sym); });
this.beams = this.add.graphics().setDepth(8);
this.strs = [];
this.flightPool = [];
this.hintG = this.add.graphics().setDepth(40);
this.hitZone = this.add.zone(0, 0, 10, 10).setOrigin(0).setInteractive().setDepth(30);
this.hitZone.on('pointerdown', function (p) { self.onDown(p); });
this.input.on('pointerup', function (p) { self.onUp(p); });
this.buildHud();
this.unsub = VPC.Portal.onChange(function () { self.refresh(); });
this.events.once('shutdown', function () { self.unsub(); });
VPC.Keys.bind(this, {
R: function () { if (self.canAct()) self.restart(); },
H: function () { if (self.canAct()) self.useHint(); },
U: function () { if (self.canAct()) self.undo(); },
Enter: function () { self.keyNext(); },
Space: function () { self.keyNext(); },
});
VPC.onResize(this, function (v) { self.layout(v); });
if (!this.daily) {
if (this.idx === 1 && !st.goalCardSeen && st.levelsWon === 1) this.showGoalCard();
else if (this.idx > 0 && this.idx % LC.PER_CHAPTER === 0 && !st.stars(this.idx + 1)) this.banner('CHAPTER ' + (LC.chapterOf(this.idx) + 1), LC.CHAPTERS[LC.chapterOf(this.idx)].toUpperCase());
else if (this.idx > 0 && this.level.colours > LC.levelAt(this.idx - 1).colours && !st.stars(this.idx + 1)) this.time.delayedCall(500, function () { VPC.UI.toast(self, 'New lantern colour: ' + LC.COLORS[self.level.colours - 1][0]); });
}
this.afterChange();
VPC.Portal.gameplayStart();
this.cameras.main.fadeIn(180, 11, 8, 32);
try { performance.mark('vpc-created'); } catch (e) {}
this.game.events.once('postrender', VPC.ready);
},
buildHud: function () {
var self = this, UI = VPC.UI;
this.plates = this.add.graphics().setDepth(90);
var t = function (size, color, w) { return UI.text(self, 0, 0, '', size, color, { weight: w || '700' }).setDepth(100); };
this.lblLevel = t(13, '#9BFBFF');
this.valLevel = UI.text(this, 0, 0, '', 46, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 14 }).setDepth(100);
this.lblChapter = t(13, '#FF7AC6');
this.lblMoves = t(13, '#9BFBFF');
this.valMoves = UI.text(this, 0, 0, '', 40, '#FFD34D', { shadow: '#FF7A3D', shadowY: 0, blur: 10 }).setDepth(100);
this.lblPar = t(14, '#9BFBFF');
this.parStars = [0, 1, 2].map(function () { return self.add.image(0, 0, 'vpc-icon-star').setTint(LC.GOLD).setDepth(100); });
this.lblGoal = t(13, '#FF7AC6');
this.valGoal = UI.text(this, 0, 0, '', 15, '#FFFFFF', { weight: '700', wrap: 220 }).setDepth(100);
this.lblBoost = t(13, '#9BFBFF');
this.lblBoost.setText('BOOSTERS');
this.phoneTitle = UI.text(this, 0, 0, '', 26, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 12 }).setDepth(100);
this.phoneSub = t(14, '#9BFBFF');
this.captions = ['UNDO', 'RESTART', '+1 STRING', 'HINT'].map(function (c) { return t(12, '#9BFBFF').setText(c); });
var b = function (o) { return UI.button(self, o).setDepth(100); };
this.btnMenu = b({ label: 'Menu', icon: 'back', w: 200, h: 50, fontSize: 18, onPress: function () { self.leave('Home', {}); } });
this.btnHint = b({ label: 'Hint (H)', icon: 'bulb', primary: true, w: 200, h: 62, fontSize: 19, onPress: function () { self.useHint(); } });
this.btnUndo = b({ label: 'Undo (U)', icon: 'undo', w: 200, h: 62, fontSize: 19, onPress: function () { self.undo(); } });
this.btnString = b({ label: '+1 String', icon: 'plus', w: 200, h: 62, fontSize: 19, onPress: function () { self.addString(); } });
this.btnRestart = b({ label: 'Restart (R)', icon: 'restart', w: 140, h: 52, fontSize: 16, onPress: function () { self.restart(); } });
this.btnMute = b({ icon: VPC.Audio.muted ? 'mute' : 'sound', w: 54, h: 52, onPress: function () {
VPC.Audio.setMuted(!VPC.Audio.muted);
self.btnMute.setIcon(VPC.Audio.muted ? 'mute' : 'sound');
} });
this.btnHelp = b({ icon: 'help', w: 54, h: 52, onPress: function () { self.showRules(); } });
this.btnSkip = b({ label: 'Skip tutorial', w: 200, h: 46, fontSize: 15, color: '#3A2A70', lip: '#1A1240', ink: '#FFD34D', onPress: function () { self.skipTutorial(); } });
},
canAct: function () { return !this.card && !this.won && !VPC.Portal.busy; },
guided: function () { return !this.daily && this.idx < 2 && !LC.Store.tutorialDone; },
/** First visit, level 1: the hand shows the first move until a string is picked. */
handOn: function () {
return !this.daily && this.idx === 0 && LC.Store.levelsWon === 0 && this.s.moves === 0 && this.selected < 0 &&
!this.flights.length && !this.won && !this.card;
},
hintsLeft: function () { return this.s.hintsLeft + LC.Store.daily.freeHints; },
layout: function (v) {
var u = v.s, W = v.w, H = v.h;
this.v = v;
this.bg.layout(v);
var rect;
if (v.wide) {
var pw = Math.min(250 * u, W * 0.22);
this.pw = pw;
rect = [pw + 44 * u, 10 * u, W - 2 * (pw + 44 * u), H - 20 * u];
} else {
var top = 92 * u, bottom = (this.guided() ? 166 : 108) * u;
rect = [6 * u, top, W - 12 * u, H - top - bottom];
}
this.rect = rect;
this.layoutBoard();
this.layoutHud(v);
},
/** (Re)builds the strings for the board's current length. */
layoutBoard: function () {
var r = this.rect, u = this.v.s, self = this, b = this.s.board;
var lay = this.lay = new LC.BoardLayout(r[0], r[1], r[2], r[3], b.length, u);
this.hitZone.setPosition(r[0], r[1]).setSize(r[2], r[3]);
if (this.hitZone.input) this.hitZone.input.hitArea.setTo(0, 0, r[2], r[3]);
var g = this.beams.clear();
for (var row = 0; row < lay.rows; row++) {
var e = lay.row(row), lw = lay.lw, y = e[2];
g.fillStyle(0x000000, 0.33).fillRoundedRect(e[0], y - lw * 0.16 + 4 * u, e[1] - e[0], lw * 0.2, lw * 0.1);
g.fillStyle(0x2B1712, 1).fillRoundedRect(e[0], y - lw * 0.16, e[1] - e[0], lw * 0.2, lw * 0.1);
g.fillStyle(0x6B3F2E, 1).fillRoundedRect(e[0], y - lw * 0.16, e[1] - e[0], lw * 0.11, { tl: lw * 0.1, tr: lw * 0.1, bl: 0, br: 0 });
g.lineStyle(1.4 * u, LC.PINK, 0.55).lineBetween(e[0] + 6 * u, y - lw * 0.15, e[1] - 6 * u, y - lw * 0.15);
g.fillStyle(0x6B3F2E, 1).fillCircle(e[0] + 4 * u, y - lw * 0.06, lw * 0.13).fillCircle(e[1] - 4 * u, y - lw * 0.06, lw * 0.13);
}
while (this.strs.length < b.length) this.strs.push(this.makeString());
this.strs.forEach(function (sv, i) { sv.on = i < b.length; sv.rope.setVisible(sv.on); sv.glow.setVisible(false); sv.tassel.setVisible(sv.on); sv.hook.setVisible(sv.on); });
for (var i = 0; i < b.length; i++) this.syncString(i);
for (var j = b.length; j < this.strs.length; j++) {
this.strs[j].lanterns.forEach(function (l) { l.img.setVisible(false); l.halo.setVisible(false); l.core.setVisible(false); });
if (this.strs[j].twinkles) this.strs[j].twinkles.forEach(function (tw) { tw.setVisible(false); });
}
void self;
},
makeString: function () {
return {
glow: this.add.image(0, 0, 'lc-glowline').setOrigin(0.5, 0).setDepth(9).setBlendMode(Phaser.BlendModes.ADD),
rope: this.add.image(0, 0, 'vpc-px').setOrigin(0.5, 0).setTint(0xE8C9A0).setAlpha(0.85).setDepth(10),
hook: this.add.image(0, 0, 'vpc-dot').setTint(LC.GOLD).setDepth(10),
tassel: this.add.image(0, 0, 'lc-tassel').setOrigin(0.5, 0.12).setDepth(10),
lanterns: [],
twinkles: null,
on: true,
};
},
/** Lantern images for string i match its stack (colour textures, count). */
syncString: function (i) {
var sv = this.strs[i], st = this.s.board[i], self = this;
while (sv.lanterns.length < st.length) {
sv.lanterns.push({
halo: this.add.image(0, 0, 'lc-halo').setDepth(11).setBlendMode(Phaser.BlendModes.ADD),
img: this.add.image(0, 0, '__WHITE').setDepth(12),
core: this.add.image(0, 0, 'lc-halo').setDepth(13).setBlendMode(Phaser.BlendModes.ADD).setTint(0xFFFFFF),
});
}
sv.lanterns.forEach(function (l, k) {
var on = k < st.length;
l.img.setVisible(on); l.halo.setVisible(on); l.core.setVisible(on);
if (!on) return;
var c = st.charCodeAt(k) - 97;
if (l.c !== c || l.sym !== self.sym) {
l.img.setTexture(LC.art.lantern(self, c, self.sym));
l.halo.setTint(LC.COLORS[c][1]);
l.c = c; l.sym = self.sym;
}
});
},
layoutHud: function (v) {
var u = v.s, g = this.plates, self = this;
g.clear();
var plate = function (x, y, w, h, border) {
g.fillStyle(0x000000, 0.25).fillRoundedRect(x, y + 5 * u, w, h, 18 * u);
g.fillStyle(0x150F35, 0.82).fillRoundedRect(x, y, w, h, 18 * u);
g.lineStyle(1.6 * u, border || LC.CYAN, 0.75).strokeRoundedRect(x, y, w, h, 18 * u);
};
this.refresh();
var wideOnly = [this.lblLevel, this.valLevel, this.lblChapter, this.lblMoves, this.valMoves, this.lblPar, this.lblGoal, this.valGoal, this.lblBoost].concat(this.parStars);
var phoneOnly = [this.phoneTitle, this.phoneSub].concat(this.captions);
wideOnly.forEach(function (o) { o.setVisible(v.wide); });
phoneOnly.forEach(function (o) { o.setVisible(!v.wide); });
if (v.wide) {
var pw = this.pw, lx = 24 * u, rx = v.w - 24 * u - pw, cl = lx + pw / 2, cr = rx + pw / 2, bw = pw / u, y0 = 16 * u;
this.btnMenu.setSize2(bw, 50).setLabel('Menu').setPosition(cl, y0 + 25 * u);
plate(lx, y0 + 64 * u, pw, 132 * u);
this.lblLevel.setPosition(cl, y0 + 86 * u);
this.valLevel.setPosition(cl, y0 + 128 * u).setScale(this.daily ? 0.6 : 1);
this.lblChapter.setPosition(cl, y0 + 172 * u);
plate(lx, y0 + 210 * u, pw, 120 * u);
this.lblMoves.setPosition(cl, y0 + 232 * u);
this.valMoves.setPosition(cl, y0 + 270 * u);
this.lblPar.setPosition(cl - 26 * u, y0 + 308 * u);
this.parStars.forEach(function (s, k) { s.setDisplaySize(16 * u, 16 * u).setPosition(cl - 26 * u + self.lblPar.width / 2 + (12 + k * 17) * u, y0 + 307 * u); });
this.valGoal.setWordWrapWidth(pw - 28 * u);
var goalH = this.valGoal.text ? this.valGoal.height + 46 * u : 0;
this.lblGoal.setVisible(!!goalH); this.valGoal.setVisible(!!goalH);
if (goalH) {
plate(lx, v.h - 16 * u - goalH, pw, goalH, LC.PINK);
this.lblGoal.setPosition(cl, v.h - 16 * u - goalH + 20 * u);
this.valGoal.setPosition(cl, v.h - 16 * u - goalH / 2 + 12 * u);
}
this.lblBoost.setPosition(cr, y0 + 8 * u);
this.btnHint.setSize2(bw, 62).setLabel('Hint (H)').setPosition(cr, y0 + 58 * u);
this.btnUndo.setSize2(bw, 62).setLabel('Undo (U)').setPosition(cr, y0 + 138 * u);
this.btnString.setSize2(bw, 62).setLabel('+1 String').setPosition(cr, y0 + 218 * u);
this.btnSkip.setSize2(bw, 44).setPosition(cr, v.h - 140 * u);
var rw = bw - 62 * 2;
this.btnRestart.setSize2(rw, 52).setLabel(rw > 120 ? 'Restart (R)' : 'Restart').setPosition(rx + rw * u / 2, v.h - 16 * u - 30 * u);
this.btnMute.setSize2(54, 52).setPosition(rx + (rw + 8 + 27) * u, v.h - 46 * u);
this.btnHelp.setSize2(54, 52).setPosition(rx + pw - 27 * u, v.h - 46 * u);
} else {
var W = v.w, top = 10 * u;
this.btnMenu.setSize2(52, 48).setLabel('').setPosition(14 * u + 26 * u, top + 26 * u);
this.btnMute.setSize2(52, 48).setPosition(W - 40 * u, top + 26 * u);
this.btnHelp.setSize2(52, 48).setPosition(W - 100 * u, top + 26 * u);
this.phoneTitle.setPosition(W / 2 - 20 * u, top + 18 * u);
this.phoneSub.setPosition(W / 2 - 20 * u, top + 50 * u);
var n = 4, gap = 8, bw2 = Math.min(96, (v.cssW - 24 - gap * (n - 1)) / n), by = v.h - 58 * u;
[this.btnUndo, this.btnRestart, this.btnString, this.btnHint].forEach(function (b, k) {
var x = W / 2 + (k - (n - 1) / 2) * (bw2 + gap) * u;
b.setSize2(bw2, 56).setLabel('').setPosition(x, by);
self.captions[k].setPosition(x, by + 40 * u);
});
this.btnSkip.setSize2(200, 44).setPosition(W / 2, by - 84 * u);
}
this.refresh();
},
/** Texts, badges and enabled states. */
refresh: function () {
if (!this.v) return;
var st = LC.Store, s = this.s, P = VPC.Portal, wide = this.v.wide, playing = !this.won && !this.card;
var d = new Date(), date = d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
this.lblLevel.setText(this.daily ? 'DAILY CHALLENGE' : 'LEVEL');
this.valLevel.setText(this.daily ? date : String(this.idx + 1));
this.lblChapter.setText(this.daily ? 'LANTERN FESTIVAL' : LC.CHAPTERS[LC.chapterOf(this.idx)].toUpperCase());
this.lblMoves.setText('MOVES');
this.valMoves.setText(String(s.moves));
this.lblPar.setText('PAR ' + this.level.par + ' =');
this.phoneTitle.setText(this.daily ? 'DAILY · ' + date.toUpperCase() : 'LEVEL ' + (this.idx + 1));
this.phoneSub.setText('MOVES ' + s.moves + '   ·   PAR ' + this.level.par);
var goal = this.nextGoal();
this.lblGoal.setText(goal && wide ? 'NEXT GOAL' : '');
this.valGoal.setText(goal && wide ? goal : '');
var ads = P.rewardedSupported, ready = P.rewardedReady();
var h = this.hintsLeft();
this.btnHint.setBadge(h > 0 ? '×' + h : ads ? 'AD' : '×0');
this.btnHint.setEnabled(playing && !this.hintSearch && !this.guided() && (h > 0 || ready || !ads));
var noUndo = s.undosLeft === 0 && ads;
this.btnUndo.setBadge(s.undosLeft > 0 ? '×' + s.undosLeft : ads ? 'AD' : '×0');
if (wide) this.btnUndo.setLabel(noUndo ? '+' + LC.AD_UNDOS + ' Undos' : 'Undo (U)');
this.btnUndo.setEnabled(playing && s.hasHistory && (s.undosLeft > 0 || ready || !ads));
this.btnString.setBadge(s.extraUsed ? '×0' : ads ? 'AD' : '×1');
this.btnString.setEnabled(playing && !s.extraUsed && (!ads || ready));
this.btnRestart.setEnabled(playing && (s.hasHistory || s.extraUsed));
this.btnHint.setPrimary(playing && !this.guided());
this.btnSkip.setVisible(this.guided() && !this.won);
if (!wide) {
this.captions[0].setText(noUndo ? '+' + LC.AD_UNDOS + ' UNDOS' : 'UNDO');
this.captions[3].setText('HINT');
}
},
/** The closest thing to play for after this level (game_screen.dart _nextGoal + chapters). */
nextGoal: function () {
if (this.daily) return null;
var st = LC.Store, playable = st.playable, cur = this.won ? this.idx + 1 : this.idx;
if (cur >= playable) return null;
var lv = function (n) { return n === 1 ? '1 MORE LEVEL' : n + ' MORE LEVELS'; };
var goals = [];
if (!st.dailyUnlocked && LC.DAILY_UNLOCK_AFTER < playable) {
var n = LC.DAILY_UNLOCK_AFTER - st.levelsWon;
if (n > 0) goals.push([n, lv(n) + ' TO UNLOCK THE DAILY CHALLENGE']);
}
var colours = LC.levelAt(cur).colours;
for (var j = cur + 1; j < playable; j++) {
if (LC.LEVELS[j][1] > colours) { goals.push([j - cur, lv(j - cur) + ' TO A NEW LANTERN COLOUR']); break; }
}
var ch = LC.chapterOf(cur), nextCh = (ch + 1) * LC.PER_CHAPTER;
if (nextCh < playable) goals.push([nextCh - cur, lv(nextCh - cur) + ' TO LIGHT UP ' + LC.CHAPTERS[ch + 1].toUpperCase()]);
if (VPC.build.demoLevels) goals.push([playable - cur, lv(playable - cur) + ' LEFT IN THE DEMO']);
goals.sort(function (a, b) { return a[0] - b[0]; });
return goals.length ? goals[0][1] : null;
},
sway: function (i) {
var t = this.t, a = 0.022 * Math.sin(t * 1.15 + i * 1.9) + 0.01 * Math.sin(t * 2.3 + i * 0.7), b = this.bounceAt[i];
if (b !== undefined && t - b < 1.6) a += 0.05 * Math.exp(-(t - b) * 3) * Math.sin((t - b) * 10);
return a;
},
lift: function (i) {
if (this.selected === i) return easeOut3((this.t - this.selT) / 0.16);
if (this.dropping === i) return 1 - easeOut3((this.t - this.dropT) / 0.16);
return 0;
},
xShake: function (i) {
var s = this.shakeAt[i];
if (s === undefined || this.t - s > 0.45) return 0;
return 6 * this.v.s * Math.exp(-(this.t - s) * 7) * Math.sin((this.t - s) * 45);
},
/** Swayed, lifted centre of lantern k on string i. */
lanternPos: function (i, k) {
var l = this.lay, p = l.slot(i, k), st = this.s.board[i] || '', lift = this.lift(i);
if (lift > 0 && k >= st.length - LC.Board.topRun(st)) p = [p[0], p[1] - lift * (l.slotH * 0.62 + 2 * this.v.s * Math.sin(this.t * 5))];
var b = this.bounceAt[i];
if (b !== undefined && this.t - b < 0.5) p = [p[0], p[1] + 3 * this.v.s * Math.exp(-(this.t - b) * 8) * Math.sin((this.t - b) * 30)];
var q = rot(p, l.hooks[i], this.sway(i));
return [q[0] + this.xShake(i), q[1]];
},
/** Glow (0..~1.3) of a completed string. */
lit: function (i) {
var c = this.completeAt[i], t = this.t;
if (c === undefined || t < c) return 0;
var d = t - c, f = this.festivalAt, fest = f === null || t < f ? 0 : 0.7 * Math.exp(-(t - f) * 2);
return Math.min(1, d / 0.25) * (0.8 + 0.2 * Math.sin(t * 2.2 + i)) + 0.5 * Math.exp(-d * 2.5) + fest;
},
inbound: function (i) { return this.flights.some(function (f) { return f.to === i; }); },
onDown: function (p) {
if (!this.canAct()) return;
var i = this.lay.hit(p.x, p.y);
this.downOn = i;
if (i >= 0) this.tap(i);
else if (this.selected >= 0) this.deselect();
},
onUp: function (p) {
var from = this.downOn;
this.downOn = -1;
if (from < 0 || !this.canAct() || !this.lay) return;
var to = this.lay.hit(p.x, p.y);
if (to >= 0 && to !== from && this.selected === from) this.tap(to);
},
tap: function (i) {
var b = this.s.board, B = LC.Board, s = this.selected;
if (this.won || i >= b.length) return;
if (s < 0) {
if (this.inbound(i)) return; // let the lanterns land first
if (B.canPick(b, i)) this.select(i);
else if (b[i].length) this.deny(i); // complete strings are locked
return;
}
if (s === i) { this.deselect(); return; }
var srcLen = b[s].length, dstLen = b[i].length, run = B.topRun(b[s]), starts = [];
for (var k = 0; k < run; k++) starts.push(this.lanternPos(s, srcLen - 1 - k));
var m = this.s.play(s, i);
if (!m) {
if (B.canPick(b, i) && !this.inbound(i)) this.select(i);
else { this.deny(i); this.deselect(true); }
return;
}
this.selected = -1;
this.hint = null; // a move was made: the hint is used up
this.dropping = m.count < run ? s : -1; // a partial pour lowers the rest
this.dropT = this.t;
for (k = 0; k < m.count; k++) this.launch(s, i, m.colour, dstLen + k, starts[k], this.t + k * LC.STAGGER, k === m.count - 1);
this.syncString(s);
this.syncString(i);
LC.sfx('whoosh', 0.5);
this.afterChange();
},
select: function (i) {
if (this.selected >= 0) { this.dropping = this.selected; this.dropT = this.t; }
this.selected = i;
this.selT = this.t;
LC.sfx('pick', 0.75);
this.afterChange();
},
deselect: function (quiet) {
this.dropping = this.selected;
this.dropT = this.t;
this.selected = -1;
if (!quiet) LC.sfx('pick', 0.45);
this.afterChange();
},
deny: function (i) {
this.shakeAt[i] = this.t;
LC.sfx('deny', 0.65);
},
launch: function (from, to, colour, dst, start, t0, last) {
var f = this.flightPool.pop();
if (!f) {
f = { halo: this.add.image(0, 0, 'lc-halo').setDepth(20).setBlendMode(Phaser.BlendModes.ADD), img: this.add.image(0, 0, '__WHITE').setDepth(21), trail: [] };
for (var j = 0; j < 5; j++) f.trail.push(this.add.image(0, 0, 'lc-halo').setDepth(19).setBlendMode(Phaser.BlendModes.ADD));
}
f.from = from; f.to = to; f.colour = colour; f.dst = dst; f.start = start; f.t0 = t0; f.last = last; f.landed = false;
f.img.setTexture(LC.art.lantern(this, colour, this.sym)).setVisible(true);
f.halo.setTint(LC.COLORS[colour][1]).setVisible(true);
f.trail.forEach(function (tr) { tr.setTint(LC.COLORS[colour][1]).setVisible(false); });
this.flights.push(f);
},
land: function (f) {
var self = this, l = this.lay;
f.landed = true;
f.img.setVisible(false); f.halo.setVisible(false);
f.trail.forEach(function (tr) { tr.setVisible(false); });
this.bounceAt[f.to] = this.t;
LC.sfx('drop_' + Math.min(f.dst + 1, 4), 0.75);
var p = this.lanternPos(f.to, f.dst);
VPC.Juice.burst(this, p[0], p[1] + l.lw * 0.3, { key: 'vpc-dot', color: LC.COLORS[f.colour][1], count: 6, size: 0.35, speed: 0.35, gravity: 300 });
if (!f.last) return;
var b = this.s.board;
if (LC.Board.isComplete(b[f.to]) && this.completeAt[f.to] === undefined) {
this.completeAt[f.to] = this.t;
this.completedCount++;
this.burst(f.to, f.colour, false);
LC.sfx('chime_' + Math.min(this.completedCount, 5), 0.8);
VPC.Juice.shake(this, 0.12, 120);
}
if (this.s.won && this.flights.every(function (g) { return g.landed || g === f; })) {
this.winAt = this.t + 1.1;
this.festivalAt = this.t + 0.35;
this.won = true;
VPC.Portal.gameplayStop();
this.refresh();
}
void self;
},
burst: function (i, colour, small) {
var l = this.lay, h = l.hooks[i], x = h[0], y = l.bottom(i) - l.slotH * 2.2, c = LC.COLORS[colour][1], u = this.v.s;
VPC.Juice.ripple(this, x, y, l.lw * (small ? 1.6 : 2.4), c);
VPC.Juice.burst(this, x, y, { key: 'vpc-dot', color: c, count: small ? 10 : 22, size: 0.5, speed: 0.75, gravity: 260 });
VPC.Juice.burst(this, x, y, { key: 'lc-spark', color: small ? 0xFFFFFF : LC.GOLD, count: small ? 4 : 10, size: 0.45, speed: 0.6, gravity: 200 });
void u;
},
/** Lands every flying lantern at once and resyncs the view to the board. */
settle: function () {
var self = this;
this.flights.forEach(function (f) {
f.img.setVisible(false); f.halo.setVisible(false);
f.trail.forEach(function (tr) { tr.setVisible(false); });
self.flightPool.push(f);
});
this.flights = [];
this.selected = -1;
this.hint = null;
this.dropping = -1;
var b = this.s.board;
for (var i = 0; i < b.length; i++) {
if (LC.Board.isComplete(b[i])) { if (this.completeAt[i] === undefined) this.completeAt[i] = this.t - 5; }
else delete this.completeAt[i];
}
Object.keys(this.completeAt).forEach(function (k) { if (+k >= b.length) delete self.completeAt[k]; });
this.completedCount = Object.keys(this.completeAt).length;
},
/** After every board/selection change: HUD + the guided gold arc (levels 1-2). */
afterChange: function () {
this.gen++;
if (this.guided() && !this.won && this.selected < 0 && !this.s.won) {
var r = LC.solve(this.s.board, 20000);
var m = r && r.moves[0];
if (m && (!this.hint || this.hint[0] !== m[0] || this.hint[1] !== m[1])) { this.hint = m; this.hintAt = this.t; }
}
this.refresh();
},
skipTutorial: function () {
LC.Store.markTutorialDone();
this.hint = null;
this.layout(this.v);
},
/** Undo: this level's undos, then a rewarded ad for +2 where there are ads. */
undo: function () {
var self = this, s = this.s, gen = this.gen;
if (this.won || !s.hasHistory || this.card) return;
var go = function () {
self.settle();
var b0 = s.board, m = s.undo();
if (!m) return;
var start = [];
for (var k = 0; k < m.count; k++) start.push(self.lanternPos(m.to, b0[m.to].length - 1 - k));
var dst = s.board[m.from].length - m.count;
self.syncString(m.to);
self.syncString(m.from);
for (k = 0; k < m.count; k++) self.launch(m.to, m.from, m.colour, dst + k, start[k], self.t + k * LC.STAGGER * 0.6, k === m.count - 1);
LC.sfx('whoosh', 0.45);
self.afterChange();
};
if (s.undosLeft > 0) { go(); return; }
if (!VPC.Portal.rewardedSupported) { VPC.UI.toast(this, 'No undos left. Try Restart'); return; }
VPC.Portal.showRewarded('undos').then(function (ok) {
if (!ok || !self.sys.isActive() || self.won) return;
s.grantUndos();
VPC.UI.toast(self, '+' + LC.AD_UNDOS + ' undos');
if (gen === self.gen || s.hasHistory) go();
});
},
/** Back to the level's own strings (a used +1 string goes); allowances are not refilled. */
restart: function () {
if (this.won || this.card || (!this.s.hasHistory && !this.s.extraUsed)) return;
var n0 = this.s.board.length;
this.settle();
this.s.restart();
this.completeAt = {};
this.completedCount = 0;
if (this.s.board.length !== n0) this.layoutBoard();
for (var i = 0; i < this.s.board.length; i++) this.syncString(i);
LC.sfx('whoosh', 0.45);
VPC.Juice.shake(this, 0.08, 100);
this.afterChange();
},
/** +1 empty string, once at a time: a rewarded ad where there are ads, free where there are none. */
addString: function () {
var self = this, s = this.s;
if (this.won || s.extraUsed || this.card) return;
var go = function () {
if (self.won || s.extraUsed) return;
self.settle();
s.addString();
self.appearAt[s.board.length - 1] = self.t;
self.layoutBoard();
VPC.UI.toast(self, '+1 empty string');
LC.sfx('chime_1', 0.6);
self.afterChange();
};
if (!VPC.Portal.rewardedSupported) { go(); return; }
VPC.Portal.showRewarded('string').then(function (ok) { if (ok && self.sys.isActive()) go(); });
},
/**
* Hint: the solver's next move as the gold arc. Level hints first, then
* the Daily streak's free hints, then one rewarded ad per hint. The search
* runs a few ms per frame (never a long frame); nothing is spent when no
* move can win from here.
*/
useHint: function () {
var self = this, s = this.s;
if (this.won || this.hintSearch || this.card || this.guided()) return;
if (this.hintsLeft() === 0 && !VPC.Portal.rewardedSupported) { VPC.UI.toast(this, 'No hints left. Try Restart'); return; }
this.settle();
this.syncAll();
var gen = this.gen;
this.hintSearch = { search: new LC.Search(s.board.slice()), gen: gen, done: function (res) {
self.hintSearch = null;
self.refresh();
if (gen !== self.gen || self.won) return;
var m = res && res.moves[0];
if (!m) { VPC.UI.toast(self, 'No way out from here. Undo or restart.'); return; }
var show = function (free) {
self.hint = m; self.hintAt = self.t;
VPC.UI.toast(self, free ? 'Follow the gold arc  ·  ' + self.hintsLeft() + ' left' : 'Follow the gold arc');
LC.sfx('chime_2', 0.55);
self.refresh();
};
if (s.useHint()) show(true);
else if (LC.Store.daily.useFreeHint()) show(true);
else {
VPC.Portal.showRewarded('hint').then(function (ok) {
if (!ok || !self.sys.isActive() || self.won || gen !== self.gen) return;
s.grantHint(); s.useHint();
show(false);
});
}
} };
this.refresh();
},
syncAll: function () { for (var i = 0; i < this.s.board.length; i++) this.syncString(i); },
update: function (time, delta) {
if (!this.lay) return;
var dt = Math.min(0.05, delta / 1000), self = this;
this.t += dt;
var t = this.t, l = this.lay, u = this.v.s, b = this.s.board;
if (this.hintSearch) {
var r = this.hintSearch.search.step(6);
if (r !== undefined) this.hintSearch.done(r);
}
var landed = false;
this.flights.forEach(function (f) { if (!f.landed && t >= f.t0 + LC.FLIGHT) { self.land(f); landed = true; } });
if (landed) {
this.flights = this.flights.filter(function (f) { if (f.landed) self.flightPool.push(f); return !f.landed; });
this.afterChange();
}
if (this.festivalAt !== null && !this.festDone && t >= this.festivalAt) this.festival();
if (this.winAt !== null && t >= this.winAt && !this.card && !this.winShown) { this.winShown = true; this.onWin(); }
var inFlight = {};
this.flights.forEach(function (f) { inFlight[f.to + ':' + f.dst] = 1; });
var sel = this.selected;
for (var i = 0; i < b.length; i++) {
var sv = this.strs[i], hook = l.hooks[i], a = this.sway(i), sx = this.xShake(i), st = b[i];
var appear = this.appearAt[i] === undefined ? 1 : backOut((t - this.appearAt[i]) / 0.55);
var lit = this.lit(i), len = l.ropeLen * appear;
sv.rope.setPosition(hook[0] + sx * 0.5, hook[1]).setRotation(a).setDisplaySize(Math.max(1.5 * u, l.lw * 0.045), len);
sv.hook.setPosition(hook[0], hook[1]).setDisplaySize(l.lw * 0.2, l.lw * 0.2);
var end = rot([hook[0], hook[1] + len], hook, a);
sv.tassel.setPosition(end[0] + sx, end[1]).setRotation(a).setDisplaySize(l.lw * 0.22, l.lw * 0.44)
.setTint(lit > 0 && st.length ? LC.COLORS[st.charCodeAt(0) - 97][1] : 0xFF3DA8).setAlpha(0.85);
var glow = -1, ga = 0;
if (lit > 0 && st.length) { glow = LC.COLORS[st.charCodeAt(0) - 97][1]; ga = 0.7 * Math.min(1, lit); }
else if (sel === i) { glow = LC.CYAN; ga = 0.8; }
else if (sel >= 0 && LC.Board.moveFor(b, sel, i)) { glow = 0xFFFFFF; ga = 0.3 + 0.2 * Math.sin(t * 6); }
sv.glow.setVisible(glow >= 0);
if (glow >= 0) sv.glow.setTint(glow).setAlpha(ga).setPosition(hook[0] + sx * 0.5, hook[1]).setRotation(a).setDisplaySize(l.lw * 0.6, len);
var shown = appear >= 1, top = st.length - LC.Board.topRun(st);
for (var k = 0; k < sv.lanterns.length; k++) {
var ln = sv.lanterns[k], vis = shown && k < st.length && !inFlight[i + ':' + k];
ln.img.setVisible(vis); ln.halo.setVisible(vis); ln.core.setVisible(vis && lit > 0);
if (!vis) continue;
var p = this.lanternPos(i, k), lifted = sel === i && k >= top, sc = l.lw / LC.TEX_W * (lifted ? 1.06 : 1);
ln.img.setPosition(p[0], p[1]).setRotation(a).setScale(sc);
var gl = lifted ? 1.6 : 1;
ln.halo.setPosition(p[0], p[1]).setScale(l.lw * (1.5 + 0.5 * lit) / 128).setAlpha(Math.min(1, (0.3 + 0.45 * lit) * gl));
if (lit > 0) ln.core.setPosition(p[0], p[1]).setScale(l.lw * 0.75 / 128).setAlpha(Math.min(0.55, 0.4 * lit));
}
if (lit > 0) {
if (!sv.twinkles) sv.twinkles = [0, 1, 2].map(function () { return self.add.image(0, 0, 'lc-spark').setDepth(14).setBlendMode(Phaser.BlendModes.ADD); });
for (var q = 0; q < 3; q++) {
var w = (t * 0.7 + q / 3 + i * 0.13) % 1, base = this.lanternPos(i, Math.floor(q * 1.3) % LC.CAP);
sv.twinkles[q].setVisible(true).setPosition(base[0] + Math.sin(q * 2 + t) * l.lw * 0.45, base[1] - w * l.slotH)
.setScale((3 + 3 * Math.sin(w * Math.PI)) * u / 12).setAlpha(0.8 * Math.sin(w * Math.PI));
}
} else if (sv.twinkles) sv.twinkles.forEach(function (tw) { tw.setVisible(false); });
}
this.flights.forEach(function (f) {
var dst = self.lanternPos(f.to, f.dst), w0 = (t - f.t0) / LC.FLIGHT, s0 = l.lw / LC.TEX_W;
if (w0 <= 0) {
f.img.setPosition(f.start[0], f.start[1]).setScale(s0 * 1.06).setRotation(0);
f.halo.setPosition(f.start[0], f.start[1]).setScale(l.lw * 1.7 / 128).setAlpha(0.6);
return;
}
var dist = Math.hypot(dst[0] - f.start[0], dst[1] - f.start[1]);
var cx = (f.start[0] + dst[0]) / 2, cy = Math.min(f.start[1], dst[1]) - (l.lw * 0.8 + dist * 0.28);
var at = function (w) {
var e = easeInOut3(w), q2 = 1 - e;
return [f.start[0] * q2 * q2 + cx * 2 * q2 * e + dst[0] * e * e, f.start[1] * q2 * q2 + cy * 2 * q2 * e + dst[1] * e * e];
};
var p = at(w0), dir = Math.sign(dst[0] - f.start[0]);
f.img.setPosition(p[0], p[1]).setRotation(Math.sin(Math.PI * w0) * 0.3 * dir).setScale(s0 * (1.06 + 0.12 * Math.sin(Math.PI * w0)));
f.halo.setPosition(p[0], p[1]).setScale(l.lw * 1.8 / 128).setAlpha(0.6);
f.trail.forEach(function (tr, j) {
var lag = (j + 1) * 0.035;
if (w0 - lag <= 0) { tr.setVisible(false); return; }
var q3 = at(w0 - lag);
tr.setVisible(true).setPosition(q3[0], q3[1]).setScale(l.lw * (0.75 - j * 0.1) / 128 * 1.6).setAlpha(0.4 - j * 0.06);
});
});
this.drawHint();
this.drawHand();
},
/** The gold arc from the lanterns to lift to where they go (board_scene.dart). */
drawHint: function () {
var g = this.hintG.clear(), h = this.hint, b = this.s.board, l = this.lay, u = this.v.s;
if (!h || h[0] >= b.length || h[1] >= b.length || this.won) return;
var from = h[0], to = h[1];
var src = b[from].length ? this.lanternPos(from, b[from].length - 1) : l.hooks[from];
var dst = b[to].length ? this.lanternPos(to, b[to].length - 1) : [l.hooks[to][0], l.bottom(to)];
dst = [dst[0], dst[1] - l.slotH];
var pulse = 0.55 + 0.45 * Math.sin((this.t - this.hintAt) * 5);
var top = Math.min(src[1], dst[1]) - l.lw * 1.1 - Math.hypot(src[0] - dst[0], src[1] - dst[1]) * 0.18;
var c = [(src[0] + dst[0]) / 2, top], s0 = [src[0], src[1] - l.lw * 0.45], pts = [];
for (var k = 0; k <= 24; k++) {
var e = k / 24, q = 1 - e;
pts.push({ x: s0[0] * q * q + c[0] * 2 * q * e + dst[0] * e * e, y: s0[1] * q * q + c[1] * 2 * q * e + dst[1] * e * e });
}
g.lineStyle(l.lw * 0.22, LC.GOLD, 0.3 * pulse).strokePoints(pts);
g.lineStyle(Math.max(2 * u, l.lw * 0.06), LC.GOLD, 0.95).strokePoints(pts);
var dx = dst[0] - c[0], dy = dst[1] - c[1], d = Math.max(1, Math.hypot(dx, dy)), ux = dx / d, uy = dy / d, len = l.lw * 0.32;
g.fillStyle(LC.GOLD, 1).fillTriangle(dst[0], dst[1],
dst[0] - ux * len - uy * len * 0.6, dst[1] - uy * len + ux * len * 0.6,
dst[0] - ux * len + uy * len * 0.6, dst[1] - uy * len - ux * len * 0.6);
g.lineStyle(2.5 * u, LC.GOLD, 0.7 * pulse);
g.strokeCircle(src[0], src[1], l.lw * (0.62 + 0.08 * pulse));
g.strokeCircle(dst[0], dst[1], l.lw * (0.62 + 0.08 * pulse));
},
/** Level 1, first visit: a hand presses the first string, glides to the second and presses it. */
drawHand: function () {
if (!this.handOn()) {
if (this.hand) this.hand.setVisible(false);
return;
}
var l = this.lay, u = this.v.s, sol = this.level.solution[0], b = this.s.board;
if (!this.hand) this.hand = this.add.image(0, 0, 'vpc-hand').setOrigin(0.36, 0.06).setDepth(700);
var src = this.lanternPos(sol[0], b[sol[0]].length - 1), dst = this.lanternPos(sol[1], Math.min(LC.CAP - 1, b[sol[1]].length));
var cyc = 2.6, w = (this.t % cyc) / cyc, x, y, press = 0, alpha = 1;
if (w < 0.15) { x = src[0]; y = src[1]; alpha = w / 0.15; }
else if (w < 0.3) { x = src[0]; y = src[1]; press = Math.sin((w - 0.15) / 0.15 * Math.PI); }
else if (w < 0.65) { var e = easeInOut3((w - 0.3) / 0.35); x = src[0] + (dst[0] - src[0]) * e; y = src[1] + (dst[1] - src[1]) * e - Math.sin(e * Math.PI) * l.lw * 1.2; }
else if (w < 0.8) { x = dst[0]; y = dst[1]; press = Math.sin((w - 0.65) / 0.15 * Math.PI); }
else { x = dst[0]; y = dst[1]; alpha = 1 - (w - 0.8) / 0.2; }
var ring = Math.floor(this.t / cyc * 2 + (w >= 0.65 ? 1 : 0));
if ((w > 0.2 && w < 0.3 || w > 0.7 && w < 0.8) && this.handRing !== ring) {
this.handRing = ring;
VPC.Juice.ripple(this, x, y, l.lw * 0.7, 0xFFFFFF);
}
this.hand.setVisible(true).setPosition(x + 14 * u * (1 - press), y + 16 * u * (1 - press)).setScale(0.62 * u * (1 - 0.08 * press)).setAlpha(alpha);
},
festival: function () {
this.festDone = true;
var b = this.s.board, self = this;
for (var i = 0; i < b.length; i++) if (b[i].length) this.burst(i, b[i].charCodeAt(0) - 97, true);
VPC.Juice.confetti(this, [0xFF3DA8, 0x2FE4FF, 0xFFD34D, 0x3CE07C, 0xA77BFF, 0xFF8F1F], 90);
VPC.Juice.shake(this, 0.25, 220);
LC.sfx('chime_5', 0.7);
this.time.delayedCall(180, function () { LC.sfx('chime_3', 0.5); });
void self;
},
onWin: function () {
var st = LC.Store, s = this.s;
LC.sfx('win', 0.85);
VPC.Portal.levelWon();
if (this.daily) {
this.reward = st.daily.complete();
this.showDailyWin();
return;
}
var opened = VPC.DailyUnlock.watch();
st.recordWin(this.idx + 1, s.stars);
this.dailyJustUnlocked = opened();
st.perfectRun = s.stars === 3 ? st.perfectRun + 1 : 0;
if (this.guided() && this.idx === 1) st.markTutorialDone();
this.showWin();
},
starRow: function (card, y, stars, u, delay) {
var self = this;
for (var k = 0; k < 3; k++) {
(function (k) {
var on = k < stars;
var img = self.add.image((k - 1) * 62 * u, y + (k === 1 ? -8 : 0) * u, 'vpc-icon-star').setTint(on ? LC.GOLD : 0x3A3266);
img.setDisplaySize((k === 1 ? 66 : 54) * u, (k === 1 ? 66 : 54) * u);
card.panel.add(img);
VPC.Juice.popIn(self, img, delay + k * 220, img.scaleX);
if (on) self.time.delayedCall(delay + k * 220 + 120, function () { LC.sfx('star', 1, 1 + k * 0.12); });
})(k);
}
},
showWin: function () {
var self = this, UI = VPC.UI, st = LC.Store, s = this.s, n = this.idx + 1, last = n >= st.playable;
var demoEnd = last && VPC.build.demoLevels > 0;
var goal = this.dailyJustUnlocked ? VPC.DailyUnlock.goal : this.nextGoal(), ch = LC.chapterOf(this.idx), chDone = n % LC.PER_CHAPTER === 0;
this.card = UI.card(this, 330, function (card, u) {
var p = card.panel, y = 40 * u;
p.add(UI.text(self, 0, y, 'LANTERNS LIT', 32, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 16 }));
y += 38 * u;
p.add(UI.text(self, 0, y, 'LEVEL ' + n + ' COMPLETE', 14, '#9BFBFF'));
y += 58 * u;
self.starRow(card, y, s.stars, u, 250);
y += 52 * u;
p.add(UI.text(self, 0, y, 'MOVES ' + s.moves + '   ·   PAR ' + self.level.par, 15, '#FFD34D'));
y += 30 * u;
if (st.perfectRun >= 2) {
p.add(UI.text(self, 0, y, 'PERFECT RUN ×' + st.perfectRun, 14, '#3CE07C'));
y += 26 * u;
}
var inCh = (n - 1) % LC.PER_CHAPTER + 1, bw = 240 * u;
p.add(UI.text(self, 0, y, chDone ? LC.CHAPTERS[ch].toUpperCase() + ' LIT UP!' : LC.CHAPTERS[ch].toUpperCase() + '  ' + inCh + '/' + LC.PER_CHAPTER, 13, chDone ? '#FFD34D' : '#FF7AC6'));
y += 18 * u;
var bar = self.add.graphics();
bar.fillStyle(0x2A2160, 1).fillRoundedRect(-bw / 2, y, bw, 10 * u, 5 * u);
bar.fillStyle(chDone ? LC.GOLD : LC.PINK, 1).fillRoundedRect(-bw / 2, y, Math.max(10 * u, bw * inCh / LC.PER_CHAPTER), 10 * u, 5 * u);
p.add(bar);
y += 30 * u;
if (goal && !last) {
p.add(UI.text(self, 0, y, 'NEXT GOAL', 12, '#FF7AC6'));
y += 22 * u;
var gt = UI.text(self, 0, y, goal, 15, self.dailyJustUnlocked ? VPC.DailyUnlock.cfg.goalInk : '#FFFFFF', { wrap: 280, oy: 0 });
p.add(gt);
y += gt.height + 16 * u;
} else y += 6 * u;
var next = UI.button(self, {
label: demoEnd ? 'Finish' : last ? 'All lit!' : 'Next (Enter)', icon: last && !demoEnd ? 'check' : 'next', primary: true, w: 260, h: 62, fontSize: 22,
enabled: !last || demoEnd, onPress: function () { self.goNext(); },
});
next.setPosition(0, y + 31 * u);
p.add(next);
self.btnNext = next;
y += 78 * u;
var replay = UI.button(self, { label: 'Replay', icon: 'restart', w: 125, h: 50, fontSize: 17, onPress: function () { self.leaveWon('Play', { idx: self.idx }); } });
var levels = UI.button(self, { label: 'Levels', icon: 'grid', w: 125, h: 50, fontSize: 17, onPress: function () { self.leaveWon('Levels', {}); } });
replay.setPosition(-68 * u, y + 25 * u); levels.setPosition(68 * u, y + 25 * u);
p.add([replay, levels]);
return y + 56 * u;
}, { border: '#FF3DA8', dimColor: '#0B0820', dimAlpha: 0.55 });
this.refresh();
},
showDailyWin: function () {
var self = this, UI = VPC.UI, r = this.reward, st = LC.Store;
this.card = UI.card(this, 330, function (card, u) {
var p = card.panel, y = 46 * u;
var flame = self.add.image(0, y, 'vpc-icon-flame').setTint(0xFF7A3D).setDisplaySize((r.milestone ? 84 : 64) * u, (r.milestone ? 84 : 64) * u);
p.add(flame);
VPC.Juice.popIn(self, flame, 200, flame.scaleX);
y += 62 * u;
p.add(UI.text(self, 0, y, 'STREAK: ' + r.streak + ' DAY' + (r.streak === 1 ? '' : 'S') + '!', 26, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 14 }));
y += 34 * u;
p.add(UI.text(self, 0, y, 'DAILY SOLVED  ·  MOVES ' + self.s.moves + '  ·  PAR ' + self.level.par, 13, '#9BFBFF'));
y += 34 * u;
if (r.hintsAdded) { p.add(UI.text(self, 0, y, '+' + r.hintsAdded + ' FREE HINT' + (r.hintsAdded > 1 ? 'S' : '') + '  (' + r.freeHints + ' saved)', 16, '#FFD34D')); y += 28 * u; }
if (r.milestone && r.milestone.badge) { p.add(UI.text(self, 0, y, '30-DAY FESTIVAL BADGE!', 16, '#3CE07C')); y += 28 * u; }
var nm = st.daily.nextMilestone();
if (nm) { p.add(UI.text(self, 0, y, 'DAY ' + nm.day + (nm.hints ? ': +' + nm.hints + ' bonus hints' : ': festival badge'), 14, '#FF7AC6', { weight: '600' })); y += 26 * u; }
p.add(UI.text(self, 0, y, 'A new puzzle every day', 14, '#9BFBFF', { weight: '600' }));
y += 34 * u;
var done = UI.button(self, { label: 'Done (Enter)', icon: 'check', primary: true, w: 240, h: 60, fontSize: 21, onPress: function () { self.goNext(); } });
done.setPosition(0, y + 30 * u);
p.add(done);
self.btnNext = done;
return y + 66 * u;
}, { border: '#FFD34D', dimColor: '#0B0820', dimAlpha: 0.55 });
this.refresh();
},
/** Enter / Next on the win card: maybe a between-level ad, then the next level. */
goNext: function () {
if (this.daily) { this.leaveWon('Home', {}); return; }
var n = this.idx + 1, st = LC.Store;
if (n >= st.playable) {
if (VPC.build.demoLevels > 0) this.showDemoEnd();
return;
}
if (VPC.DailyUnlock.pending && !this.card.dailyUnlock) { this.showDailyUnlocked(); return; }
this.leaveWon('Play', { idx: n });
},
/** Once, on Next after the level that opens the Daily Challenge: what it is and its streak rewards. */
showDailyUnlocked: function () {
var self = this, n = this.idx + 1;
if (this.card) this.card.close();
this.card = VPC.DailyUnlock.card(this,
function () { self.leaveWon('Play', { daily: true }); },
function () { self.leaveWon('Play', { idx: n }); });
this.btnNext = this.card.primary;
this.refresh();
},
leaveWon: function (key, data) {
var self = this;
if (this.leaving) return;
this.leaving = true;
VPC.Portal.afterLevel().then(function () {
self.leaving = false;
self.leave(key, data);
});
},
showDemoEnd: function () {
var self = this, UI = VPC.UI;
if (this.card) this.card.close();
this.card = UI.card(this, 330, function (card, u) {
var p = card.panel, y = 44 * u;
p.add(UI.text(self, 0, y, 'THANKS FOR PLAYING', 26, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 14 }));
y += 44 * u;
var t = UI.text(self, 0, y, 'That was the demo. The full Lantern Chain has 200 levels and a Daily Challenge.', 15, '#9BFBFF', { wrap: 280, oy: 0, weight: '600' });
p.add(t);
y += t.height + 24 * u;
var home = UI.button(self, { label: 'Home', icon: 'home', primary: true, w: 220, h: 58, fontSize: 20, onPress: function () { self.leave('Home', {}); } });
home.setPosition(0, y + 29 * u);
p.add(home);
self.btnNext = home;
return y + 66 * u;
}, { border: '#FF3DA8', dimColor: '#0B0820', dimAlpha: 0.6 });
},
keyNext: function () {
if (this.card && this.card.goal) { this.closeGoalCard(); return; }
if (this.card && this.card.rules) { this.closeRules(); return; }
if (this.card && this.btnNext && this.btnNext.isEnabled()) this.btnNext.press();
},
/** Level 2, first visit: one short goal card with a picture. */
showGoalCard: function () {
var self = this, UI = VPC.UI;
LC.art.lantern(this, 0, this.sym);
this.card = UI.card(this, 320, function (card, u) {
var p = card.panel, y = 46 * u;
p.add(UI.text(self, 0, y, 'LIGHT EVERY\nSTRING', 28, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 14, lineSpacing: -4 }));
y += 64 * u;
var rope = self.add.rectangle(0, y, 3 * u, 170 * u, 0xE8C9A0).setOrigin(0.5, 0);
p.add(rope);
for (var k = 0; k < 4; k++) {
var ly = y + 150 * u - k * 38 * u;
var halo = self.add.image(0, ly, 'lc-halo').setTint(LC.COLORS[0][1]).setBlendMode(Phaser.BlendModes.ADD).setScale(80 * u / 128);
var img = self.add.image(0, ly, LC.art.lantern(self, 0, self.sym)).setScale(46 * u / LC.TEX_W);
p.add([halo, img]);
VPC.Juice.popIn(self, img, 200 + (3 - k) * 0, img.scaleX);
}
y += 194 * u;
p.add(UI.text(self, 0, y, '4 OF ONE COLOUR', 18, '#9BFBFF'));
y += 30 * u;
var play = UI.button(self, { label: 'Play', icon: 'play', primary: true, w: 220, h: 60, fontSize: 22, onPress: function () { self.closeGoalCard(); } });
play.setPosition(0, y + 30 * u);
p.add(play);
return y + 64 * u;
}, { border: '#FF3DA8', dimColor: '#0B0820', dimAlpha: 0.6 });
this.card.goal = true;
this.refresh();
},
closeGoalCard: function () {
var self = this;
LC.Store.markGoalCardSeen();
this.card.close(function () { self.card = null; self.refresh(); });
},
showRules: function () {
var self = this, UI = VPC.UI;
if (this.card) return;
this.card = UI.card(this, 360, function (card, u) {
var p = card.panel, y = 40 * u;
p.add(UI.text(self, 0, y, LC.RULES[0].toUpperCase(), 24, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 12 }));
y += 34 * u;
LC.RULES[1].forEach(function (line) {
var t = UI.text(self, 0, y, line, 15, '#DDEBFF', { wrap: 310, oy: 0, weight: '600' });
p.add(t);
y += t.height + 12 * u;
});
var ok = UI.button(self, { label: 'Got it', icon: 'check', primary: true, w: 200, h: 56, fontSize: 20, onPress: function () { self.closeRules(); } });
ok.setPosition(0, y + 34 * u);
p.add(ok);
return y + 66 * u;
}, { border: '#00F0FF', dimColor: '#0B0820', dimAlpha: 0.6 });
this.card.rules = true;
this.refresh();
},
closeRules: function () {
var self = this;
this.card.close(function () { self.card = null; self.refresh(); });
},
/** A short chapter banner across the board (first visit of a chapter's first level). */
banner: function (small, big) {
var v = VPC.view(this), u = v.s, UI = VPC.UI;
var a = UI.text(this, 0, -22 * u, small, 16, '#9BFBFF'), b = UI.text(this, 0, 10 * u, big, 34, '#FFFFFF', { shadow: '#FF3DA8', shadowY: 0, blur: 16 });
var bg = this.add.rectangle(0, -4 * u, v.w, 96 * u, 0x0B0820, 0.7);
var c = this.add.container(v.w / 2, v.h * 0.42, [bg, a, b]).setDepth(650).setAlpha(0);
this.tweens.chain({ targets: c, tweens: [{ alpha: 1, duration: 300 }, { alpha: 0, duration: 400, delay: 1500, onComplete: function () { c.destroy(); } }] });
LC.sfx('chime_3', 0.5);
},
leave: function (key, data) {
var self = this;
VPC.Portal.gameplayStop();
this.cameras.main.fadeOut(160, 11, 8, 32);
this.cameras.main.once('camerafadeoutcomplete', function () { self.scene.start(key, data); });
},
});
/** Plays a sample (assets/*.mp3) once it is decoded, else a synth voice. */
LC.sfx = function (name, volume, rate) {
var boost = { whoosh: 1.7, pick: 1.25, deny: 1.3 }[name] || 1;
VPC.Audio.play(name, { volume: Math.min(1, (volume || 0.8) * boost), rate: rate, minGap: 0.03 });
};
'use strict';
VPC.UI.setTheme({
font: 'ChakraPetch, system-ui, sans-serif',
ink: '#FFFFFF', muted: '#9BFBFF', panel: '#150F35', page: '#0B0820',
primary: '#FF3DA8', primaryLip: '#A81E6E', primaryInk: '#FFFFFF',
button: '#2A2160', buttonLip: '#120C33', buttonInk: '#9BFBFF',
star: '#FFD34D', starInk: '#3A1230', badge: '#FFD34D', badgeInk: '#3A1230', free: '#14B886',
gloss: 0.12, primaryGloss: 0.18,
});
VPC.Audio.setSong({
bpm: 84, steps: 32, voice: 'triangle',
chords: [[392.0, 493.88, 587.33], [329.63, 392.0, 493.88], [261.63, 329.63, 392.0], [293.66, 369.99, 440.0]],
scale: [587.33, 659.25, 783.99, 880.0, 987.77, 1174.66],
melody: [4, 3, 1, 3, 4, -1, 3, 1, 0, 1, 3, 1, 0, -1, 1, -1, 2, 3, 4, 5, 4, -1, 3, 2, 1, 3, 2, 1, 0, -1, -1, -1],
});
VPC.qaState = function () {
var p = VPC.game && VPC.game.scene.getScene('Play');
if (!p || !p.sys.isActive() || !p.s) return 'menu';
return p.won ? 'win' : 'play';
};
['pick', 'drop_1', 'drop_2', 'drop_3', 'drop_4', 'chime_1', 'chime_2', 'chime_3', 'chime_4', 'chime_5', 'win', 'deny', 'whoosh']
.forEach(function (n) { VPC.Audio.load(n, 'sounds/' + n + '.mp3'); });
VPC.boot({
background: '#0B0820',
fonts: ['700 20px ChakraPetch'],
beforeStart: function () { LC.Store.migrate(); },
textures: function (scene) { LC.art.textures(scene); },
scenes: [LC.Home, LC.Levels, LC.Play],
first: function () { return LC.Store.brandNew ? 'Play' : 'Home'; },
});
