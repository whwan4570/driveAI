import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    assert.ok(name in imports, `Unexpected import ${name}`);
    return imports[name];
  }, document: { createElement: () => ({}) }, Uint8Array, Uint8ClampedArray, Math });
  return exports;
}
const tracking = load('../src/lib/localVisualTracking.ts');
const { shouldSearch, followSearchPoint, visibleSearchRoi } = load('../src/lib/inletSearch.ts', { './localVisualTracking': tracking });

assert.equal(shouldSearch({ manual: true, stable: 0, elapsed: 0 }), true, 'A deliberate scan must work during movement');
assert.equal(shouldSearch({ manual: false, stable: 0, elapsed: 6000 }), true, 'Continuous motion must not starve automatic localization');
assert.equal(shouldSearch({ manual: false, stable: 0, elapsed: 4000 }), true, 'A moving cap view must be sampled without waiting through its whole appearance');
assert.equal(shouldSearch({ manual: false, stable: 0, elapsed: 2000 }), false, 'Repeated scans must be throttled');
assert.equal(shouldSearch({ manual: false, stable: 3, elapsed: 4000 }), true, 'A steady view may search sooner');

const pixels = new Uint8ClampedArray(128 * 128 * 4);
let seed = 17;
for (let i = 0; i < pixels.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
const frame = { width: 128, height: 128, pixels };
const point = { x: .5, y: .5 };
assert.ok(followSearchPoint([{ time: 1, tracking: frame }, { time: 101, tracking: frame }], 1, 101, point), 'Stable captured coordinates can reach the current frame');
assert.equal(followSearchPoint([{ time: 1, tracking: frame }, { time: 1001, tracking: frame }], 1, 1001, point), null, 'Missing tracking frames must reject stale positions');
assert.equal(followSearchPoint([{ time: 101, tracking: frame }], 1, 101, point), null, 'An expired capture must not produce a marker');
const blank = { ...frame, pixels: new Uint8ClampedArray(pixels.length) };
assert.equal(followSearchPoint([{ time: 1, tracking: frame }, { time: 101, tracking: blank }], 1, 101, point), null, 'Lost target must not produce a marker');
assert.equal(followSearchPoint([{ time: 1, tracking: frame }], 1, 101, point), null, 'A trail that never reaches the current frame must be rejected');
assert.equal(visibleSearchRoi({ x: 0, y: 0, w: .2, h: 1 }, { x: .3, y: 0, w: .4, h: 1 }), null, 'An off-screen crop must not be sent as the visible search');
const visible = visibleSearchRoi({ x: 0, y: 0, w: 1, h: 1 }, { x: .25, y: 0, w: .5, h: 1 });
assert.equal(visible.x, .25);
assert.equal(visible.w, .5);
const smoothCap = { ...frame, pixels: new Uint8ClampedArray(pixels) };
for (let y = 57; y <= 71; y++) for (let x = 57; x <= 71; x++) for (let c = 0; c < 3; c++) smoothCap.pixels[(y * 128 + x) * 4 + c] = 100;
assert.ok(tracking.trackPointLocally(smoothCap, smoothCap, point), 'A smooth cap must remain trackable using its textured rim');
assert.equal(tracking.trackPointLocally(blank, blank, point), null, 'A completely blank view must remain untrackable');
function capFrame(offset = 0, second = false) {
  const pixels = new Uint8ClampedArray(128 * 128 * 4).fill(70);
  for (let y = 52; y <= 76; y++) for (let x = 52 + offset; x <= 76 + offset; x++) {
    const i = (y * 128 + x) * 4; pixels[i] = 35; pixels[i + 1] = 60; pixels[i + 2] = 130;
  }
  if (second) for (let y = 52; y <= 76; y++) for (let x = 22; x <= 46; x++) {
    const i = (y * 128 + x) * 4; pixels[i] = 35; pixels[i + 1] = 60; pixels[i + 2] = 130;
  }
  return { width: 128, height: 128, pixels };
}
const movedCap = tracking.trackVerifiedInlet(capFrame(), capFrame(4), point);
assert.ok(movedCap && Math.abs(movedCap.x - 68 / 128) < .02, 'A verified smooth blue cap must follow local motion');
assert.equal(tracking.trackVerifiedInlet(capFrame(), blank, point), null, 'A vanished blue cap must not leave a marker');
assert.equal(tracking.trackVerifiedInlet(capFrame(), capFrame(50), point), null, 'A cap moving beyond the local search must be hidden');
console.log('18 inlet-search checks passed');
