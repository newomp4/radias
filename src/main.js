import GUI from 'lil-gui';
import { Stage }     from './scene.js';
import { RingField } from './rings.js';
import { Recorder, SIZE_PRESETS } from './export.js';

// ------------------------------------------------------------------
// Parameters — single source of truth edited by the dashboard.
// ------------------------------------------------------------------
const params = {
  // Composition
  count:           14,
  baseSize:        2.2,
  radiusStep:      0.0,
  lineWidth:       2.0,     // pixels — screen-space-constant stroke weight
  opacity:         1.0,
  color:           '#ffffff',

  // Layout
  tiltAmount:      1.0,
  offsetAmplitude: 0.4,
  offsetSeed:      1337,

  // Pulse (radius modulation over time)
  pulseAmount:     0.06,
  pulseFrequency:  0.35,
  pulsePhaseSpread:1.0,

  // Motion
  rotationSpeed:   0.35,
  wobble:          0.2,
  spinSpread:      0.4,
  resolve:         0.0,

  // Camera
  fov:             38,

  // Export
  exportSize:        'Fit viewport',
  exportFps:         60,
  exportBitrate:     24,
  exportDuration:    0,
  exportTransparent: false,

  // Experimental — each control drives a specific, deliberate piece of
  // geometry. Hidden behind the rainbow button at the bottom of the GUI.
  resolvePattern:     'collapse',  // collapse | shatter | phyllotaxis | torus-knot | great-circles
  torusKnotP:         3,
  torusKnotQ:         2,
  lissajous:          false,
  lissajousFx:        3,
  lissajousFy:        2,
  lissajousFz:        5,
  lissajousAmp:       1.8,
  harmonicLock:       false,
  harmonicDenom:      4,
  connectionMesh:     false,
  connectionNeighbors:2,
  trails:             false,
  trailAmount:        0.08,

  // Actions
  randomize:       () => {},
  reseed:          () => {},
  resetView:       () => {},
  snapshot:        () => {},
  toggleRecording: () => {},
  animateResolve:  () => {},
  viewTop:         () => {},
  viewBottom:      () => {},
  viewFront:       () => {},
  viewBack:        () => {},
  viewLeft:        () => {},
  viewRight:       () => {},
  view3Quarter:    () => {},
  revealExperimental: () => {}
};

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
const canvas = document.getElementById('view');
const stage  = new Stage(canvas);
const field  = new RingField(stage.scene, stage.lineMaterial, stage.unitCircle);
field.rebuild(params);
stage.applyParams(params);
stage.setFov(params.fov);

const recorder = new Recorder(canvas);
const recIndicator = document.getElementById('rec-indicator');
recorder.onStateChange = (state) => {
  recIndicator.classList.toggle('hidden', state !== 'recording');
  recordCtrl.name(state === 'recording' ? 'Stop recording' : 'Start recording');
};

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------
const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
const randF   = (lo, hi) => lo + Math.random() * (hi - lo);

params.randomize = () => {
  params.count           = randInt(4, 24);
  params.baseSize        = randF(1.0, 3.5);
  params.radiusStep      = randF(-0.25, 0.25);
  params.lineWidth       = randF(1.0, 4.5);
  params.opacity         = randF(0.55, 1.0);
  params.tiltAmount      = randF(0.35, 1.0);
  params.offsetAmplitude = randF(0, 2.0);
  params.offsetSeed      = randInt(0, 999_999);
  params.pulseAmount     = randF(0, 0.15);
  params.pulseFrequency  = randF(0.1, 1.8);
  params.pulsePhaseSpread= randF(0, 1);
  params.rotationSpeed   = randF(-0.8, 0.8);
  params.wobble          = randF(0, 0.5);
  params.spinSpread      = randF(0, 0.9);
  params.fov             = randF(26, 55);
  // Deliberately left alone: color, resolve, export settings — the user
  // owns those.
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
  stage.setFov(params.fov);
};

params.reseed = () => {
  params.offsetSeed = randInt(0, 999_999);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
};

params.resetView = () => stage.resetView();

params.snapshot = () => {
  applyExportSize();
  stage.setAlphaMode(params.exportTransparent);
  requestAnimationFrame(() => {
    field.update(0, params);
    stage.applyParams(params);
    stage.render();
    recorder.snapshot({ alpha: params.exportTransparent });
  });
};

params.toggleRecording = () => {
  if (recorder.state === 'recording') {
    recorder.stop();
    return;
  }
  applyExportSize();
  stage.setAlphaMode(params.exportTransparent);
  requestAnimationFrame(() => {
    recorder.start({
      fps:         params.exportFps,
      bitrateMbps: params.exportBitrate,
      durationSec: params.exportDuration,
      alpha:       params.exportTransparent
    });
  });
};

let resolveAnim = null;
params.animateResolve = () => {
  const from = params.resolve;
  const to   = from >= 0.5 ? 0 : 1;
  resolveAnim = { from, to, dur: 3.0, t0: performance.now() };
};

params.viewTop      = () => stage.snapTo({ x: 0.001, y: 1,     z: 0     });
params.viewBottom   = () => stage.snapTo({ x: 0.001, y: -1,    z: 0     });
params.viewFront    = () => stage.snapTo({ x: 0,     y: 0,     z: 1     });
params.viewBack     = () => stage.snapTo({ x: 0,     y: 0,     z: -1    });
params.viewLeft     = () => stage.snapTo({ x: -1,    y: 0,     z: 0     });
params.viewRight    = () => stage.snapTo({ x: 1,     y: 0,     z: 0     });
params.view3Quarter = () => stage.snapTo({ x: 1,     y: 0.85,  z: 1     });

function applyExportSize() {
  const preset = SIZE_PRESETS[params.exportSize];
  if (!preset) return;
  if (preset.w === 0) stage.clearExportSize();
  else                stage.setExportSize(preset.w, preset.h);
}

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
const gui = new GUI({ title: 'RADIAS' });

gui.add(params, 'randomize').name('✦ Randomize parameters');

const fComp = gui.addFolder('Composition');
fComp.add(params, 'count', 1, 48, 1).name('Amount')
     .onChange(() => field.applyParams(params));
fComp.add(params, 'baseSize', 0.2, 6, 0.01).name('Base size');
fComp.add(params, 'radiusStep', -0.6, 0.6, 0.001).name('Radius step');
fComp.add(params, 'lineWidth', 0.3, 10, 0.1).name('Line weight (px)');
fComp.add(params, 'opacity', 0, 1, 0.01).name('Opacity');
fComp.addColor(params, 'color').name('Color');

const fLayout = gui.addFolder('Layout');
fLayout.add(params, 'tiltAmount', 0, 1, 0.001).name('Tilt amount');
fLayout.add(params, 'offsetAmplitude', 0, 4, 0.01).name('Offset amplitude');
fLayout.add(params, 'offsetSeed', 0, 999999, 1).name('Seed')
       .onChange(() => field.applyParams(params));
fLayout.add(params, 'reseed').name('↻ Randomize seed');

const fPulse = gui.addFolder('Pulse');
fPulse.add(params, 'pulseAmount', 0, 0.6, 0.001).name('Amount');
fPulse.add(params, 'pulseFrequency', 0, 4, 0.01).name('Frequency');
fPulse.add(params, 'pulsePhaseSpread', 0, 1, 0.001).name('Phase spread');

const fMotion = gui.addFolder('Motion');
fMotion.add(params, 'rotationSpeed', -2, 2, 0.01).name('Rotation speed');
fMotion.add(params, 'wobble', 0, 1, 0.001).name('Wobble');
fMotion.add(params, 'spinSpread', 0, 1, 0.001).name('Spin spread');
const resolveCtrl = fMotion.add(params, 'resolve', 0, 1, 0.001).name('Resolve');
fMotion.add(params, 'animateResolve').name('▶ Animate resolve');

const fCam = gui.addFolder('Camera');
fCam.add(params, 'fov', 15, 90, 0.1).name('Field of view')
    .onChange((v) => stage.setFov(v));
fCam.add(params, 'resetView').name('↺ Reset camera');

const fView = gui.addFolder('View');
fView.add(params, 'viewTop'     ).name('▲ Top');
fView.add(params, 'viewBottom'  ).name('▼ Bottom');
fView.add(params, 'viewFront'   ).name('● Front');
fView.add(params, 'viewBack'    ).name('○ Back');
fView.add(params, 'viewLeft'    ).name('◀ Left');
fView.add(params, 'viewRight'   ).name('▶ Right');
fView.add(params, 'view3Quarter').name('◆ 3/4 perspective');

const fExport = gui.addFolder('Export');
fExport.add(params, 'exportSize', Object.keys(SIZE_PRESETS)).name('Canvas size')
       .onChange(() => applyExportSize());
fExport.add(params, 'exportTransparent').name('Transparent background')
       .onChange((v) => stage.setAlphaMode(v));
fExport.add(params, 'exportFps', [24, 30, 60]).name('FPS');
fExport.add(params, 'exportBitrate', 4, 200, 1).name('Bitrate (Mbps)');
fExport.add(params, 'exportDuration', 0, 120, 1).name('Duration (s, 0=manual)');
fExport.add(params, 'snapshot').name('⤓ Save PNG frame');
const recordCtrl = fExport.add(params, 'toggleRecording').name('Start recording');

// ------------------------------------------------------------------
// Experimental — hidden until the rainbow button is clicked (or ` toggled).
// Every toggle drives a deliberate geometric mode.
//   Resolve pattern    — target shape the field settles into as
//                        `resolve` rises: collapse to origin, shatter
//                        outward, phyllotaxis spiral (golden angle),
//                        (p,q)-torus knot, or great-circle sphere cage.
//   Lissajous orbit    — replaces the chaotic offset with a 3D
//                        Lissajous curve at integer frequency ratios.
//   Harmonic lock      — quantizes each ring's spin ratio to k/N so
//                        spins are commensurable → stable moiré.
//   Connection mesh    — orange kNN edges between ring centers; k
//                        slider controls the density of the web.
//   Motion trails      — disables clear-per-frame; old frames decay
//                        into the new one via a fullscreen fade quad.
// ------------------------------------------------------------------
const fExp = gui.addFolder('∞ Experimental');

fExp.add(params, 'resolvePattern',
         ['collapse', 'shatter', 'phyllotaxis', 'torus-knot', 'great-circles'])
    .name('Resolve pattern');

const fKnot = fExp.addFolder('Torus knot (p, q)');
fKnot.add(params, 'torusKnotP', 2, 7, 1).name('p');
fKnot.add(params, 'torusKnotQ', 2, 7, 1).name('q');

const fLiss = fExp.addFolder('Lissajous orbit');
fLiss.add(params, 'lissajous'     ).name('Enabled');
fLiss.add(params, 'lissajousFx', 1, 9, 1).name('fx');
fLiss.add(params, 'lissajousFy', 1, 9, 1).name('fy');
fLiss.add(params, 'lissajousFz', 1, 9, 1).name('fz');
fLiss.add(params, 'lissajousAmp', 0, 5, 0.01).name('Amplitude');

const fHarm = fExp.addFolder('Harmonic lock');
fHarm.add(params, 'harmonicLock' ).name('Enabled');
fHarm.add(params, 'harmonicDenom', 2, 12, 1).name('Denominator N');

const fConn = fExp.addFolder('Connection mesh');
fConn.add(params, 'connectionMesh' ).name('Enabled');
fConn.add(params, 'connectionNeighbors', 1, 5, 1).name('k nearest');

const fTrails = fExp.addFolder('Motion trails');
fTrails.add(params, 'trails').name('Enabled')
       .onChange((v) => stage.enableTrails(v, params.trailAmount));
fTrails.add(params, 'trailAmount', 0.02, 0.4, 0.005).name('Fade amount')
       .onChange((v) => stage.enableTrails(params.trails, v));

fExp.hide();

let experimentalShown = false;
function toggleExperimental(force) {
  experimentalShown = typeof force === 'boolean' ? force : !experimentalShown;
  if (experimentalShown) { fExp.show(); fExp.open(); }
  else                   { fExp.hide(); }
  expBtn.name(experimentalShown ? '✦ HIDE EXPERIMENTAL ✦' : '✦ EXPERIMENTAL ✦');
}
params.revealExperimental = () => toggleExperimental();

const expBtn = gui.add(params, 'revealExperimental').name('✦ EXPERIMENTAL ✦');
expBtn.domElement.classList.add('rainbow-btn');

// Keyboard shortcuts.
window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'r' || e.key === 'R') stage.resetView();
  if (e.key === ' ') { e.preventDefault(); params.animateResolve(); }
  if (e.key === 'x' || e.key === 'X') params.randomize();
  if (e.key === '`' || e.key === '~') toggleExperimental();
});

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------
let prev = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  if (resolveAnim) {
    const t = Math.min(1, (now - resolveAnim.t0) / 1000 / resolveAnim.dur);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    params.resolve = resolveAnim.from + (resolveAnim.to - resolveAnim.from) * eased;
    resolveCtrl.updateDisplay();
    if (t >= 1) resolveAnim = null;
  }

  field.update(dt, params);
  stage.applyParams(params);
  stage.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
