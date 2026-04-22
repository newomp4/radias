import GUI from 'lil-gui';
import { Stage }     from './scene.js';
import { RingField } from './rings.js';
import { Recorder, SIZE_PRESETS } from './export.js';

// ------------------------------------------------------------------
// Parameters — single source of truth edited by the dashboard.
// ------------------------------------------------------------------
const params = {
  // Composition
  count:           12,
  baseSize:        2.2,
  radiusStep:      0.0,   // offset rings: each ring's radius = baseSize + i*radiusStep
  thickness:       0.06,  // torus minor radius (tube thickness)
  color:           '#ffffff',

  // Merging — the metaball / iso-contour control
  blend:           0.55,  // smooth-min 'k' — higher = wider organic fusion zone

  // Shading (monochrome)
  fresnelPow:      2.2,
  exposure:        1.15,

  // Center offset (per-ring displacement)
  offsetAmplitude: 0.9,
  offsetSeed:      1337,

  // Pulse (radius modulation)
  pulseAmount:     0.08,
  pulseFrequency:  0.35,

  // Motion
  rotationSpeed:   0.35,
  resolve:         0.0,

  // Export
  exportSize:      'Fit viewport',
  exportFps:       60,
  exportBitrate:   24,
  exportDuration:  0,

  // Actions (populated below)
  reseed:          () => {},
  resetView:       () => {},
  snapshot:        () => {},
  toggleRecording: () => {},
  animateResolve:  () => {}
};

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
const canvas = document.getElementById('view');
const stage  = new Stage(canvas);
const field  = new RingField();
field.rebuild(params);

const recorder = new Recorder(canvas);
const recIndicator = document.getElementById('rec-indicator');
recorder.onStateChange = (state) => {
  recIndicator.classList.toggle('hidden', state !== 'recording');
  recordCtrl.name(state === 'recording' ? 'Stop recording' : 'Start recording');
};

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------
params.reseed = () => {
  params.offsetSeed = Math.floor(Math.random() * 1_000_000);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
};

params.resetView = () => stage.resetView();

params.snapshot = () => {
  applyExportSize();
  requestAnimationFrame(() => {
    stage.uploadRingField(field, params);
    stage.render();
    recorder.snapshot();
  });
};

params.toggleRecording = () => {
  if (recorder.state === 'recording') {
    recorder.stop();
    return;
  }
  applyExportSize();
  requestAnimationFrame(() => {
    recorder.start({
      fps: params.exportFps,
      bitrateMbps: params.exportBitrate,
      durationSec: params.exportDuration
    });
  });
};

let resolveAnim = null;
params.animateResolve = () => {
  const from = params.resolve;
  const to   = from >= 0.5 ? 0 : 1;
  resolveAnim = { from, to, dur: 3.0, t0: performance.now() };
};

function applyExportSize() {
  const preset = SIZE_PRESETS[params.exportSize];
  if (!preset) return;
  if (preset.w === 0) {
    canvas.style.width  = '';
    canvas.style.height = '';
    stage.fit();
  } else {
    stage.setExportSize(preset.w, preset.h);
  }
}

// ------------------------------------------------------------------
// Dashboard — lil-gui, restyled monochrome via styles.css
// ------------------------------------------------------------------
const gui = new GUI({ title: 'RADIAS' });

const fComp = gui.addFolder('Composition');
fComp.add(params, 'count', 1, 32, 1).name('Amount')
     .onChange(() => field.applyParams(params));
fComp.add(params, 'baseSize', 0.2, 6, 0.01).name('Base size');
fComp.add(params, 'radiusStep', -0.6, 0.6, 0.001).name('Radius step (offset rings)');
fComp.add(params, 'thickness', 0.005, 0.4, 0.001).name('Thickness');
fComp.addColor(params, 'color').name('Color');

const fBlend = gui.addFolder('Merging');
fBlend.add(params, 'blend', 0.001, 2.0, 0.001).name('Blend amount');
fBlend.add(params, 'fresnelPow', 0.5, 8.0, 0.01).name('Rim falloff');
fBlend.add(params, 'exposure', 0.1, 3.0, 0.01).name('Exposure');

const fOffset = gui.addFolder('Offset');
fOffset.add(params, 'offsetAmplitude', 0, 4, 0.01).name('Amplitude');
fOffset.add(params, 'offsetSeed', 0, 999999, 1).name('Seed')
       .onChange(() => field.applyParams(params));
fOffset.add(params, 'reseed').name('↻ Randomize seed');

const fPulse = gui.addFolder('Pulse');
fPulse.add(params, 'pulseAmount', 0, 0.6, 0.001).name('Amount');
fPulse.add(params, 'pulseFrequency', 0, 4, 0.01).name('Frequency');

const fMotion = gui.addFolder('Motion');
fMotion.add(params, 'rotationSpeed', -2, 2, 0.01).name('Rotation speed');
const resolveCtrl = fMotion.add(params, 'resolve', 0, 1, 0.001).name('Resolve');
fMotion.add(params, 'animateResolve').name('▶ Animate resolve');

const fExport = gui.addFolder('Export');
fExport.add(params, 'exportSize', Object.keys(SIZE_PRESETS)).name('Canvas size')
       .onChange(() => applyExportSize());
fExport.add(params, 'exportFps', [24, 30, 60]).name('FPS');
fExport.add(params, 'exportBitrate', 4, 80, 1).name('Bitrate (Mbps)');
fExport.add(params, 'exportDuration', 0, 120, 1).name('Duration (s, 0=manual)');
fExport.add(params, 'snapshot').name('⤓ Save PNG frame');
const recordCtrl = fExport.add(params, 'toggleRecording').name('Start recording');

const fView = gui.addFolder('View');
fView.add(params, 'resetView').name('↺ Reset camera');

window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'r' || e.key === 'R') stage.resetView();
  if (e.key === ' ') { e.preventDefault(); params.animateResolve(); }
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
  stage.uploadRingField(field, params);
  stage.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
