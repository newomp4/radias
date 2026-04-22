import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VERT, FRAG, MAX_RINGS } from './shaders/raymarch.glsl.js';

/**
 * Renderer + camera + SDF raymarch material.
 *
 * Approach: the whole ring field is described as N torus signed-distance
 * fields combined with a polynomial smooth-minimum. A single fullscreen
 * triangle covers the screen and a fragment shader ray-marches the combined
 * field per pixel. That's why intersections look like physical metaball
 * fusion rather than overlapping strokes — in SDF space the rings ARE one
 * continuous surface once they're closer together than the blend radius.
 *
 * No post-processing, no bloom, no glow. Output is a crisp monochrome
 * silhouette suitable for compositing.
 */
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,               // SDF edges are resolution-dependent; MSAA adds nothing here
      alpha: false,
      preserveDrawingBuffer: true,    // required for MediaRecorder / canvas.toBlob
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = true;

    // Perspective camera the user orbits — we never render through it directly;
    // its matrices are fed to the shader to compute ray origin + direction.
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 0, 14);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 80;

    // Pre-allocate Vector3 arrays for uniform storage. We mutate these in
    // place every frame; reallocating would thrash GC.
    const centers = Array.from({ length: MAX_RINGS }, () => new THREE.Vector3());
    const normals = Array.from({ length: MAX_RINGS }, () => new THREE.Vector3(0, 1, 0));
    const radii   = new Array(MAX_RINGS).fill(1);

    this.uniforms = {
      uInvView:    { value: new THREE.Matrix4() },
      uInvProj:    { value: new THREE.Matrix4() },
      uCamPos:     { value: new THREE.Vector3() },

      uRingCount:  { value: 0 },
      uRingCenter: { value: centers },
      uRingNormal: { value: normals },
      uRingRadius: { value: radii },

      uThickness:  { value: 0.06 },
      uBlend:      { value: 0.35 },
      uFresnelPow: { value: 2.2 },
      uExposure:   { value: 1.15 },
      uColor:      { value: new THREE.Color(0xffffff) }
    };

    // Fullscreen triangle — a single oversized triangle covering the viewport
    // is faster than a quad (no diagonal overdraw, no triangle setup waste).
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([
        -1, -1, 0,
         3, -1, 0,
        -1,  3, 0
      ]), 3)
    );
    geom.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array([
        0, 0,
        2, 0,
        0, 2
      ]), 2)
    );

    this.material = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms:       this.uniforms,
      glslVersion:    THREE.GLSL3,
      depthTest:      false,
      depthWrite:     false
    });

    this.screenScene  = new THREE.Scene();
    this.screenScene.add(new THREE.Mesh(geom, this.material));
    this.screenCamera = new THREE.Camera(); // clip-space; no transform needed

    this._setSize(this._displayWidth(), this._displayHeight());
    window.addEventListener('resize', () => this.fit());
  }

  _displayWidth()  { return Math.floor(this.canvas.clientWidth); }
  _displayHeight() { return Math.floor(this.canvas.clientHeight); }

  fit() {
    this._setSize(this._displayWidth(), this._displayHeight());
  }

  setExportSize(w, h) {
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this._setSize(w, h);
  }

  _setSize(w, h) {
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  resetView() {
    this.camera.position.set(0, 0, 14);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  // Pull per-ring state from the RingField into our uniforms.
  uploadRingField(field, params) {
    const n = Math.min(field.rings.length, MAX_RINGS);
    this.uniforms.uRingCount.value = n;
    for (let i = 0; i < n; i++) {
      const r = field.rings[i];
      this.uniforms.uRingCenter.value[i].copy(r.center);
      this.uniforms.uRingNormal.value[i].copy(r.normal);
      this.uniforms.uRingRadius.value[i] = r.radius;
    }

    this.uniforms.uThickness.value  = params.thickness;
    this.uniforms.uBlend.value      = Math.max(0.001, params.blend);
    this.uniforms.uFresnelPow.value = params.fresnelPow;
    this.uniforms.uExposure.value   = params.exposure;
    this.uniforms.uColor.value.set(params.color);
  }

  render() {
    this.controls.update();

    this.camera.updateMatrixWorld();
    this.uniforms.uInvView.value.copy(this.camera.matrixWorld);
    this.uniforms.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    this.uniforms.uCamPos.value.copy(this.camera.position);

    this.renderer.render(this.screenScene, this.screenCamera);
  }
}
