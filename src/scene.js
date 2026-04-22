import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Renderer + camera + shared line material.
 *
 * Each ring is its own Line2 mesh (built in rings.js) that reuses a single
 * unit-circle LineGeometry and a single LineMaterial. LineMaterial renders
 * fat lines as screen-space quads — the `linewidth` is measured in pixels,
 * so strokes keep the same apparent weight regardless of ring tilt or
 * camera angle. That's what gives the "mathematical 2D circle" feel.
 *
 * `resolution` on LineMaterial must be kept in sync with the canvas size
 * or the fat-line shader gets the wrong pixel scale.
 */

const SEGMENTS = 192; // unit-circle vertex count; higher = rounder curves

function buildUnitCircleGeometry() {
  // Closed loop: last point duplicates the first so Line2 connects them.
  const positions = new Float32Array((SEGMENTS + 1) * 3);
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(a);
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(a);
  }
  const geom = new LineGeometry();
  geom.setPositions(positions);
  return geom;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 0, 14);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 80;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.controls.saveState();

    // Shared fat-line material for every ring.
    this.lineMaterial = new LineMaterial({
      color:        0xffffff,
      linewidth:    2,
      transparent:  true,
      opacity:      1,
      worldUnits:   false,   // linewidth in pixels, not world units
      depthTest:    true,
      depthWrite:   false,
      dashed:       false,
      alphaToCoverage: false
    });

    this.unitCircle = buildUnitCircleGeometry();

    // Motion-trails pass: a fullscreen semi-transparent black quad that fades
    // the previous frame. Rendered before the main scene when trails are on,
    // with autoClearColor disabled so old pixels persist.
    this._trailsEnabled = false;
    this._fadeScene = new THREE.Scene();
    this._fadeCam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fadeQuad  = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.08,
        depthTest: false, depthWrite: false
      })
    );
    this._fadeScene.add(this._fadeQuad);

    // Camera snap animation state.
    this._camAnim = null;

    this._setSize(this._displayWidth(), this._displayHeight());
    window.addEventListener('resize', () => this.fit());
  }

  _displayWidth()  { return Math.max(1, Math.floor(this.canvas.clientWidth)); }
  _displayHeight() { return Math.max(1, Math.floor(this.canvas.clientHeight)); }

  fit() { this._setSize(this._displayWidth(), this._displayHeight()); }

  setExportSize(w, h) {
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this._setSize(w, h);
  }

  clearExportSize() {
    this.canvas.style.width  = '';
    this.canvas.style.height = '';
    this.fit();
  }

  _setSize(w, h) {
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lineMaterial.resolution.set(w, h);
  }

  setAlphaMode(transparent) {
    this.renderer.setClearColor(0x000000, transparent ? 0 : 1);
  }

  setFov(fov) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resetView() {
    this.controls.reset();
  }

  /**
   * Animate the camera to a preset direction (unit vector from target).
   * Distance to target is preserved so the framing stays consistent.
   */
  snapTo(direction, duration = 0.7) {
    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target);
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const endPos = target.clone().add(dir.multiplyScalar(distance));
    this._camAnim = {
      fromPos: this.camera.position.clone(),
      toPos:   endPos,
      t0:      performance.now(),
      dur:     duration * 1000
    };
  }

  _updateCamAnim() {
    if (!this._camAnim) return;
    const t = Math.min(1, (performance.now() - this._camAnim.t0) / this._camAnim.dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    this.camera.position.lerpVectors(this._camAnim.fromPos, this._camAnim.toPos, e);
    if (t >= 1) this._camAnim = null;
  }

  enableTrails(on, strength = 0.08) {
    this._trailsEnabled = !!on;
    this._fadeQuad.material.opacity = strength;
    this.renderer.autoClearColor = !this._trailsEnabled;
  }

  applyParams(params) {
    this.lineMaterial.color.set(params.color);
    this.lineMaterial.linewidth = params.lineWidth;
    this.lineMaterial.opacity   = params.opacity;
  }

  render() {
    this._updateCamAnim();
    this.controls.update();
    if (this._trailsEnabled) {
      this.renderer.render(this._fadeScene, this._fadeCam);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
