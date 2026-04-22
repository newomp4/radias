import * as THREE from 'three';
import { Line2 }        from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Ring field — one Line2 mesh per ring, each with its own cloned
 * LineMaterial so rings can be tinted individually (rainbow, supernova
 * flash, etc.). The base material on Stage holds the shared config; its
 * resolution / linewidth / opacity / color are copied onto every ring's
 * clone each frame, then overridden per-ring where an experimental mode
 * asks for it.
 *
 * Each ring has a baked "personality" (tilt axis, angle, offset direction,
 * spin rate, phases, glitch seed, grid slot) derived from a seeded PRNG,
 * so the layout is reproducible from the seed.
 *
 * Experimental features in this file:
 *   - alternative resolve patterns (collapse / shatter / stack / grid)
 *   - glitch — per-ring positional jitter
 *   - rainbow — per-ring hue cycling
 *   - supernova — one-shot radial burst triggered from the UI
 *   - connection lines — an orange polyline through every ring's center
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUnitVector(rand, out = new THREE.Vector3()) {
  let u, v, s;
  do {
    u = rand() * 2 - 1;
    v = rand() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const factor = 2 * Math.sqrt(1 - s);
  return out.set(u * factor, v * factor, 1 - 2 * s);
}

const _tmpWhite = new THREE.Color(1, 1, 1);

class Ring {
  constructor(baseMaterial, geometry, index) {
    this.material = baseMaterial.clone();
    this.mesh = new Line2(geometry, this.material);
    this.mesh.computeLineDistances();
    this.mesh.frustumCulled = false;

    this.tiltAxis    = new THREE.Vector3(1, 0, 0);
    this.tiltAngle   = 0;
    this.offsetDir   = new THREE.Vector3(1, 0, 0);
    this.spinPhase   = 0;
    this.pulsePhase  = 0;
    this.spinJitter  = 1;
    this.glitchPhase = 0;
    this.gridPos     = new THREE.Vector3();
    this.index       = index;

    this._tiltQ  = new THREE.Quaternion();
    this._spinQ  = new THREE.Quaternion();
    this._upAxis = new THREE.Vector3(0, 1, 0);
  }

  dispose() {
    this.material.dispose();
  }
}

export class RingField {
  constructor(scene, material, geometry) {
    this.scene    = scene;
    this.material = material;
    this.geometry = geometry;
    this.group    = new THREE.Group();
    scene.add(this.group);

    this.rings  = [];
    this.params = null;
    this.time   = 0;
    this._supernova = null;

    this.groupQuat    = new THREE.Quaternion();
    this._axisY       = new THREE.Vector3(0, 1, 0);
    this._axisX       = new THREE.Vector3(1, 0, 0);
    this._axisZ       = new THREE.Vector3(0, 0, 1);
    this._tmpQ        = new THREE.Quaternion();
    this._tmpV        = new THREE.Vector3();
    this._chaoticPos  = new THREE.Vector3();
    this._resolvedPos = new THREE.Vector3();

    // Connection line: one Line2 whose positions are rewritten each frame
    // to pass through every ring's center. Own material so we can paint it
    // a different color (orange) from the rings.
    this.connectionMaterial = new LineMaterial({
      color:      0xff6a00,
      linewidth:  1.2,
      transparent:true,
      opacity:    0.85,
      worldUnits: false,
      depthTest:  true,
      depthWrite: false
    });
    this.connectionMaterial.resolution.copy(material.resolution);
    this.connectionGeom = new LineGeometry();
    this.connectionGeom.setPositions(new Float32Array([0, 0, 0, 0, 0, 0]));
    this.connectionMesh = new Line2(this.connectionGeom, this.connectionMaterial);
    this.connectionMesh.frustumCulled = false;
    this.connectionMesh.visible = false;
    scene.add(this.connectionMesh);
  }

  rebuild(params) {
    for (const r of this.rings) {
      this.group.remove(r.mesh);
      r.dispose();
    }
    this.rings = [];

    const rand = mulberry32(params.offsetSeed);
    const cols = Math.max(1, Math.ceil(Math.sqrt(params.count)));
    const spacing = 1.25;

    for (let i = 0; i < params.count; i++) {
      const ring = new Ring(this.material, this.geometry, i);
      randomUnitVector(rand, ring.tiltAxis);
      ring.tiltAngle   = (rand() - 0.5) * Math.PI;
      randomUnitVector(rand, ring.offsetDir);
      ring.spinPhase   = rand() * Math.PI * 2;
      ring.pulsePhase  = rand() * Math.PI * 2;
      ring.spinJitter  = 0.3 + rand() * 1.4;
      ring.glitchPhase = rand() * 1000;

      // Grid slot for the 'grid' resolve pattern — centered square lattice.
      const gx = (i % cols) - (cols - 1) / 2;
      const gy = Math.floor(i / cols) - (cols - 1) / 2;
      ring.gridPos.set(gx * spacing, gy * spacing, 0);

      this.group.add(ring.mesh);
      this.rings.push(ring);
    }
    this.params = { ...params };
  }

  applyParams(params) {
    const needsRebuild =
      !this.params ||
      this.params.count      !== params.count ||
      this.params.offsetSeed !== params.offsetSeed;
    if (needsRebuild) this.rebuild(params);
    else this.params = { ...params };
  }

  triggerSupernova() {
    this._supernova = { t0: performance.now(), dur: 1200 };
  }

  update(dt, params) {
    this.time += dt;
    const resolve = params.resolve;
    const chaos   = 1 - resolve;
    const pattern = params.resolvePattern || 'collapse';

    // Whole-sculpture precession — wobble still scales with chaos so the
    // shape settles at full resolve regardless of pattern.
    this.groupQuat.setFromAxisAngle(this._axisY, this.time * params.rotationSpeed);
    this._tmpQ.setFromAxisAngle(
      this._axisX,
      Math.sin(this.time * 0.23) * params.wobble * chaos
    );
    this.groupQuat.multiply(this._tmpQ);
    this._tmpQ.setFromAxisAngle(
      this._axisZ,
      Math.cos(this.time * 0.19) * params.wobble * chaos * 0.7
    );
    this.groupQuat.multiply(this._tmpQ);

    // Supernova envelope: fast rise (0..0.25) to peak, then slow fall.
    let novaK = 0;
    if (this._supernova) {
      const t = (performance.now() - this._supernova.t0) / this._supernova.dur;
      if (t >= 1) this._supernova = null;
      else novaK = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
    }
    const novaScale = 1 + novaK * 2.5;

    const pulseBase = Math.sin(this.time * params.pulseFrequency * Math.PI * 2);
    const tiltScale = params.tiltAmount * chaos;
    const count     = this.rings.length;
    const rainbowSpeed = params.rainbowSpeed ?? 0.15;
    const glitch    = params.glitchAmount || 0;

    for (const r of this.rings) {
      // ---- Radius -----------------------------------------------------
      const stepped  = params.baseSize + r.index * params.radiusStep;
      const phase    = r.pulsePhase * params.pulsePhaseSpread;
      const pulseMul = 1 + pulseBase * params.pulseAmount *
                       Math.cos(phase + this.time * 0.4);
      const chaoticRadius = Math.max(0.01, stepped * pulseMul);

      let resolvedRadius;
      switch (pattern) {
        case 'stack': resolvedRadius = Math.max(0.05, params.baseSize * 0.3 + r.index * 0.28); break;
        case 'grid':  resolvedRadius = Math.max(0.05, params.baseSize * 0.42); break;
        default:      resolvedRadius = chaoticRadius;
      }
      const radius = (chaoticRadius * chaos + resolvedRadius * resolve) * novaScale;
      r.mesh.scale.setScalar(radius);

      // ---- Orientation ------------------------------------------------
      const chaoticTiltAngle  = r.tiltAngle * tiltScale;
      const resolvedTiltAngle = pattern === 'shatter'
        ? r.tiltAngle * params.tiltAmount
        : 0;
      const finalTilt = chaoticTiltAngle * chaos + resolvedTiltAngle * resolve;

      r._tiltQ.setFromAxisAngle(r.tiltAxis, finalTilt);
      const spinRate = params.rotationSpeed *
                       (1 + (r.spinJitter - 1) * params.spinSpread);
      r._spinQ.setFromAxisAngle(r._upAxis, r.spinPhase + this.time * spinRate);
      r.mesh.quaternion
        .copy(r._spinQ)
        .premultiply(r._tiltQ)
        .premultiply(this.groupQuat);

      // ---- Position ---------------------------------------------------
      this._chaoticPos.copy(r.offsetDir).multiplyScalar(params.offsetAmplitude);

      switch (pattern) {
        case 'shatter':
          this._resolvedPos.copy(r.offsetDir).multiplyScalar(params.offsetAmplitude + 3.5);
          break;
        case 'grid':
          this._resolvedPos.copy(r.gridPos);
          break;
        default: // collapse, stack
          this._resolvedPos.set(0, 0, 0);
      }
      this._tmpV.copy(this._chaoticPos).lerp(this._resolvedPos, resolve)
                .applyQuaternion(this.groupQuat);

      if (glitch > 0) {
        const p = r.glitchPhase;
        this._tmpV.x += glitch * Math.sin(this.time * 13.7 + p) *
                                Math.sin(this.time * 5.1 + p * 1.7);
        this._tmpV.y += glitch * Math.sin(this.time * 11.3 + p * 0.7) *
                                Math.cos(this.time * 6.9 + p);
        this._tmpV.z += glitch * Math.cos(this.time * 9.8 + p * 1.3) *
                                Math.sin(this.time * 4.3 + p * 0.5);
      }
      r.mesh.position.copy(this._tmpV);

      // ---- Material sync ---------------------------------------------
      const m = r.material;
      m.linewidth = this.material.linewidth;
      m.opacity   = this.material.opacity;
      m.resolution.copy(this.material.resolution);

      if (params.rainbow) {
        const hue = ((r.index / Math.max(1, count)) + this.time * rainbowSpeed) % 1;
        m.color.setHSL((hue + 1) % 1, 0.85, 0.6);
      } else {
        m.color.copy(this.material.color);
      }
      if (novaK > 0) {
        m.color.lerp(_tmpWhite, novaK * 0.85);
      }
    }

    // Connection line — orange polyline through ring centers in index order.
    if (params.connectionLines) {
      this.connectionMaterial.resolution.copy(this.material.resolution);
      this.connectionMaterial.linewidth = Math.max(0.8, this.material.linewidth * 0.6);
      const positions = new Float32Array(this.rings.length * 3);
      for (let i = 0; i < this.rings.length; i++) {
        const p = this.rings[i].mesh.position;
        positions[i * 3 + 0] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;
      }
      this.connectionGeom.setPositions(positions);
      this.connectionMesh.computeLineDistances();
      this.connectionMesh.visible = true;
    } else {
      this.connectionMesh.visible = false;
    }
  }
}
