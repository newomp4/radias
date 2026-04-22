import * as THREE from 'three';

/**
 * Ring state — data only. No meshes, no materials.
 *
 * Each ring is fully described by:
 *   center : vec3 — world-space position of its center
 *   normal : vec3 — unit vector perpendicular to the ring's plane
 *   radius : float — major radius (the circle's size)
 *
 * These values are consumed by the SDF raymarch shader in scene.js.
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

class Ring {
  constructor() {
    this.center = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.radius = 1;

    // Baked-in "personality" — regenerated whenever seed / count changes.
    this.tiltAxis    = new THREE.Vector3(1, 0, 0);
    this.tiltAngle   = 0;
    this.offsetDir   = new THREE.Vector3(1, 0, 0);
    this.spinPhase   = 0;
    this.pulsePhase  = 0;
    this.index       = 0;

    // Reusable scratch values.
    this._tiltQuat  = new THREE.Quaternion();
    this._spinQuat  = new THREE.Quaternion();
    this._upAxis    = new THREE.Vector3(0, 1, 0);
  }
}

export class RingField {
  constructor() {
    this.rings = [];
    this.params = null;
    this.time = 0;

    // Group-level rotation — this is the gyroscope-like precession of the
    // whole sculpture, on top of each ring's own orientation.
    this.groupQuat = new THREE.Quaternion();
    this._tmpQ     = new THREE.Quaternion();
    this._tmpV     = new THREE.Vector3();
  }

  rebuild(params) {
    this.rings = [];
    const rand = mulberry32(params.offsetSeed);

    for (let i = 0; i < params.count; i++) {
      const ring = new Ring();
      ring.index = i;

      // Each ring's tilt: random axis, random angle up to 90°.
      randomUnitVector(rand, ring.tiltAxis);
      ring.tiltAngle = (rand() - 0.5) * Math.PI;

      // Each ring's center-offset direction.
      randomUnitVector(rand, ring.offsetDir);

      ring.spinPhase  = rand() * Math.PI * 2;
      ring.pulsePhase = rand() * Math.PI * 2;

      this.rings.push(ring);
    }
    this.params = { ...params };
  }

  applyParams(params) {
    // Only regenerate personality when the seed, count, or ring layout change.
    const needsRebuild =
      !this.params ||
      this.params.count !== params.count ||
      this.params.offsetSeed !== params.offsetSeed;

    if (needsRebuild) this.rebuild(params);
    else this.params = { ...params };
  }

  update(dt, params) {
    this.time += dt;

    // 1 = full chaos, 0 = every ring collapses onto the same ideal circle.
    const chaos = 1 - params.resolve;

    // Group spin (the whole sculpture's precession).
    this.groupQuat
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.time * params.rotationSpeed)
      .multiply(
        this._tmpQ.setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          Math.sin(this.time * 0.23) * 0.3 * chaos
        )
      );

    // Shared pulse wave; per-ring phase prevents perfect lockstep.
    const pulseBase = Math.sin(this.time * params.pulseFrequency * Math.PI * 2);

    for (const r of this.rings) {
      // ---- Radius --------------------------------------------------------
      // All rings share the same base size; `radiusStep` spreads them into
      // nested/concentric circles when > 0. Pulse modulates radius over time.
      const stepped = params.baseSize + r.index * params.radiusStep;
      const pulse   = 1 + pulseBase * params.pulseAmount
                        * Math.cos(r.pulsePhase + this.time * 0.4);
      r.radius = Math.max(0.01, stepped * pulse);

      // ---- Orientation ---------------------------------------------------
      // Start with Y-up (the "ideal" shared axis), apply tilt (scaled by
      // chaos so it unwinds on resolve), apply a slow self-spin, then apply
      // the group's precession. Result is the world-space plane normal.
      r._tiltQuat.setFromAxisAngle(r.tiltAxis, r.tiltAngle * chaos);
      r._spinQuat.setFromAxisAngle(
        r._upAxis,
        r.spinPhase + this.time * params.rotationSpeed * (0.4 + r.pulsePhase * 0.05)
      );

      r.normal.set(0, 1, 0);
      r.normal.applyQuaternion(r._spinQuat);
      r.normal.applyQuaternion(r._tiltQuat);
      r.normal.applyQuaternion(this.groupQuat);
      r.normal.normalize();

      // ---- Position ------------------------------------------------------
      // Offset each ring's center by its own random direction * amplitude,
      // rotated by the group quaternion so centers ride the precession.
      const amp = params.offsetAmplitude * chaos;
      this._tmpV.copy(r.offsetDir).multiplyScalar(amp).applyQuaternion(this.groupQuat);
      r.center.copy(this._tmpV);
    }
  }
}
