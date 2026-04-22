import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';

/**
 * Ring field — one Line2 mesh per ring, each with its own cloned
 * LineMaterial so per-ring tinting (e.g. flash on supernova) is possible
 * without breaking the shared-material architecture. The base material
 * lives on Stage; each frame its resolution / linewidth / opacity / color
 * are copied onto every ring's clone.
 *
 * Each ring carries a baked "personality" (tilt axis, angle, offset
 * direction, spin rate, phases) seeded by `offsetSeed`, and pre-computed
 * deterministic placements used by the experimental layout patterns.
 *
 * Experimental geometry — all live in this file:
 *   - Resolve targets (the shape rings settle into when resolve → 1):
 *       collapse       — origin, aligned
 *       shatter        — fly outward along their natural axis
 *       phyllotaxis    — golden-angle spiral on the XZ plane
 *       torus-knot     — distributed along a (p,q) torus-knot path,
 *                        rings tilted normal to the knot tangent
 *       great-circles  — ring becomes a great circle on a sphere; planes
 *                        sampled by Fibonacci sphere lattice — every
 *                        ring passes through the origin
 *   - Lissajous orbit — replaces the chaotic offset position with a
 *                        3D Lissajous curve (x = sin(fx·t+φ_x), …)
 *   - Harmonic lock   — quantizes each ring's self-spin rate to an
 *                        integer ratio k/N of the base rotation, so spins
 *                        are commensurable and produce stable moiré
 *   - kNN connections — each ring connects to its `k` nearest neighbors
 *                        in 3D, deduplicated, drawn as orange line
 *                        segments that update every frame
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));   // ≈ 137.508°
const UP = new THREE.Vector3(0, 1, 0);

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

// (p, q) torus knot position on a torus with major radius R and minor r.
function torusKnotPos(t, p, q, R, r, out) {
  const cqt = Math.cos(q * t), sqt = Math.sin(q * t);
  const cpt = Math.cos(p * t), spt = Math.sin(p * t);
  return out.set(
    (R + r * cqt) * cpt,
     r * sqt,
    (R + r * cqt) * spt
  );
}

// Numerical tangent to the (p,q) torus knot — centred difference.
function torusKnotTangent(t, p, q, R, r, out, tmpA, tmpB) {
  const dt = 1e-3;
  torusKnotPos(t + dt, p, q, R, r, tmpA);
  torusKnotPos(t - dt, p, q, R, r, tmpB);
  return out.copy(tmpA).sub(tmpB).normalize();
}

// Fibonacci-sphere normal for the i-th ring of N — used by great-circles.
function fibonacciSphereNormal(i, N, out) {
  const y = 1 - 2 * (i + 0.5) / N;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * GOLDEN_ANGLE;
  return out.set(r * Math.cos(phi), y, r * Math.sin(phi));
}

class Ring {
  constructor(baseMaterial, geometry, index) {
    this.material = baseMaterial.clone();
    this.mesh = new Line2(geometry, this.material);
    this.mesh.computeLineDistances();
    this.mesh.frustumCulled = false;

    this.tiltAxis   = new THREE.Vector3(1, 0, 0);
    this.tiltAngle  = 0;
    this.offsetDir  = new THREE.Vector3(1, 0, 0);
    this.spinPhase  = 0;
    this.pulsePhase = 0;
    this.spinJitter = 1;
    this.lissPhase  = 0;
    this.index      = index;

    this._spinQ = new THREE.Quaternion();
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

    this.groupQuat = new THREE.Quaternion();
    this._axisY = new THREE.Vector3(0, 1, 0);
    this._axisX = new THREE.Vector3(1, 0, 0);
    this._axisZ = new THREE.Vector3(0, 0, 1);

    this._tmpQ        = new THREE.Quaternion();
    this._chaoticQ    = new THREE.Quaternion();
    this._patternQ    = new THREE.Quaternion();
    this._mixedQ      = new THREE.Quaternion();
    this._chaoticPos  = new THREE.Vector3();
    this._resolvedPos = new THREE.Vector3();
    this._tmpV        = new THREE.Vector3();
    this._tmpA        = new THREE.Vector3();
    this._tmpB        = new THREE.Vector3();
    this._normal      = new THREE.Vector3();
    this._tangent     = new THREE.Vector3();

    // kNN connection mesh — raw line segments, one per kNN edge,
    // rebuilt each frame from current ring centres.
    this.connectionMaterial = new THREE.LineBasicMaterial({
      color: 0xff6a00, transparent: true, opacity: 0.7, depthWrite: false
    });
    this.connectionGeom = new THREE.BufferGeometry();
    this.connectionPositions = new Float32Array(6);
    this.connectionGeom.setAttribute(
      'position',
      new THREE.BufferAttribute(this.connectionPositions, 3)
    );
    this.connectionMesh = new THREE.LineSegments(this.connectionGeom, this.connectionMaterial);
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
    for (let i = 0; i < params.count; i++) {
      const ring = new Ring(this.material, this.geometry, i);
      randomUnitVector(rand, ring.tiltAxis);
      ring.tiltAngle  = (rand() - 0.5) * Math.PI;
      randomUnitVector(rand, ring.offsetDir);
      ring.spinPhase  = rand() * Math.PI * 2;
      ring.pulsePhase = rand() * Math.PI * 2;
      ring.spinJitter = 0.3 + rand() * 1.4;
      ring.lissPhase  = rand() * Math.PI * 2;
      this.group.add(ring.mesh);
      this.rings.push(ring);
    }

    // Resize kNN buffer for the new ring count.
    const maxEdges = params.count * 6;  // count * max neighbors, with slack
    this.connectionPositions = new Float32Array(maxEdges * 6);
    this.connectionGeom.setAttribute(
      'position',
      new THREE.BufferAttribute(this.connectionPositions, 3)
    );

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

  update(dt, params) {
    this.time += dt;
    const resolve = params.resolve;
    const chaos   = 1 - resolve;
    const pattern = params.resolvePattern || 'collapse';
    const count   = this.rings.length;

    // Whole-sculpture precession — wobble fades with chaos so the shape
    // settles when resolved regardless of which pattern was chosen.
    this.groupQuat.setFromAxisAngle(this._axisY, this.time * params.rotationSpeed);
    this._tmpQ.setFromAxisAngle(this._axisX,
      Math.sin(this.time * 0.23) * params.wobble * chaos);
    this.groupQuat.multiply(this._tmpQ);
    this._tmpQ.setFromAxisAngle(this._axisZ,
      Math.cos(this.time * 0.19) * params.wobble * chaos * 0.7);
    this.groupQuat.multiply(this._tmpQ);

    const pulseBase = Math.sin(this.time * params.pulseFrequency * Math.PI * 2);

    // Pre-compute pattern-wide quantities used inside the per-ring loop.
    const sphereR  = params.baseSize * 1.8;            // great-circles radius
    const torusR   = params.baseSize * 1.5;            // major torus radius
    const torusr   = params.baseSize * 0.55;           // minor torus radius
    const phylloS  = params.baseSize * 0.55;           // phyllotaxis spacing
    const knotP    = Math.max(2, Math.round(params.torusKnotP));
    const knotQ    = Math.max(2, Math.round(params.torusKnotQ));

    for (const r of this.rings) {
      // ---- Radius -------------------------------------------------
      const stepped  = params.baseSize + r.index * params.radiusStep;
      const phase    = r.pulsePhase * params.pulsePhaseSpread;
      const pulseMul = 1 + pulseBase * params.pulseAmount *
                       Math.cos(phase + this.time * 0.4);
      const chaoticRadius = Math.max(0.01, stepped * pulseMul);

      let resolvedRadius;
      switch (pattern) {
        case 'great-circles': resolvedRadius = sphereR;                    break;
        case 'torus-knot':    resolvedRadius = params.baseSize * 0.32;     break;
        case 'phyllotaxis':   resolvedRadius = params.baseSize * 0.28;     break;
        default:              resolvedRadius = chaoticRadius;              // collapse / shatter
      }
      const radius = chaoticRadius * chaos + resolvedRadius * resolve;
      r.mesh.scale.setScalar(radius);

      // ---- Pattern-specific position & orientation ---------------
      // Pattern position (in group-local space).
      switch (pattern) {
        case 'shatter':
          this._resolvedPos.copy(r.offsetDir).multiplyScalar(params.offsetAmplitude + 3.5);
          break;
        case 'phyllotaxis': {
          const rho = phylloS * Math.sqrt(r.index + 0.5);
          const th  = r.index * GOLDEN_ANGLE;
          this._resolvedPos.set(rho * Math.cos(th), 0, rho * Math.sin(th));
          break;
        }
        case 'torus-knot': {
          const t = (r.index / Math.max(1, count)) * Math.PI * 2;
          torusKnotPos(t, knotP, knotQ, torusR, torusr, this._resolvedPos);
          break;
        }
        case 'great-circles':
        case 'collapse':
        default:
          this._resolvedPos.set(0, 0, 0);
      }

      // Pattern orientation (the rotation applied at resolve = 1).
      switch (pattern) {
        case 'shatter':
          this._patternQ.setFromAxisAngle(r.tiltAxis, r.tiltAngle * params.tiltAmount);
          break;
        case 'great-circles':
          fibonacciSphereNormal(r.index, count, this._normal);
          this._patternQ.setFromUnitVectors(UP, this._normal);
          break;
        case 'torus-knot': {
          const t = (r.index / Math.max(1, count)) * Math.PI * 2;
          torusKnotTangent(t, knotP, knotQ, torusR, torusr,
                           this._tangent, this._tmpA, this._tmpB);
          this._patternQ.setFromUnitVectors(UP, this._tangent);
          break;
        }
        case 'phyllotaxis':
        case 'collapse':
        default:
          this._patternQ.identity();
      }

      // ---- Chaotic position --------------------------------------
      // Either the existing seeded offset, or a 3D Lissajous orbit if
      // that motion mode is on. Lissajous uses integer frequency ratios
      // for x/y/z so the curve closes when fx, fy, fz share a period.
      if (params.lissajous) {
        const t   = this.time + r.lissPhase;
        const amp = params.lissajousAmp;
        this._chaoticPos.set(
          amp * Math.sin(params.lissajousFx * t),
          amp * Math.sin(params.lissajousFy * t + Math.PI * 0.5),
          amp * Math.sin(params.lissajousFz * t)
        );
      } else {
        this._chaoticPos.copy(r.offsetDir).multiplyScalar(params.offsetAmplitude);
      }

      // Final position: lerp(chaotic, resolved) then apply group precession.
      this._tmpV.copy(this._chaoticPos).lerp(this._resolvedPos, resolve)
                .applyQuaternion(this.groupQuat);
      r.mesh.position.copy(this._tmpV);

      // ---- Chaotic orientation -----------------------------------
      // Same axis-angle tilt as before; chaos scales it down with resolve
      // so the slerp toward the pattern orientation reads cleanly.
      this._chaoticQ.setFromAxisAngle(
        r.tiltAxis,
        r.tiltAngle * params.tiltAmount * chaos
      );

      // Slerp between the chaotic tilt and the pattern's locked orientation.
      this._mixedQ.copy(this._chaoticQ).slerp(this._patternQ, resolve);

      // Self-spin around local up. Harmonic lock quantizes the per-ring
      // jitter to an integer fraction k/N of the base rate so all spins
      // become commensurable → stable moiré patterns.
      let jitter = r.spinJitter;
      if (params.harmonicLock) {
        const denom = Math.max(2, Math.round(params.harmonicDenom));
        jitter = Math.max(1, Math.round(jitter * denom)) / denom;
      }
      const spinRate = params.rotationSpeed *
                       (1 + (jitter - 1) * params.spinSpread);
      r._spinQ.setFromAxisAngle(this._axisY, r.spinPhase + this.time * spinRate);

      // Compose: spin (local) → mixed tilt → group precession.
      r.mesh.quaternion
        .copy(r._spinQ)
        .premultiply(this._mixedQ)
        .premultiply(this.groupQuat);

      // ---- Material sync -----------------------------------------
      const m = r.material;
      m.linewidth = this.material.linewidth;
      m.opacity   = this.material.opacity;
      m.resolution.copy(this.material.resolution);
      m.color.copy(this.material.color);
    }

    // ---- kNN connection mesh -------------------------------------
    if (params.connectionMesh && count >= 2) {
      this._updateKnnMesh(params);
      this.connectionMesh.visible = true;
    } else {
      this.connectionMesh.visible = false;
    }
  }

  _updateKnnMesh(params) {
    const k = Math.max(1, Math.min(8, Math.round(params.connectionNeighbors)));
    const rings = this.rings;
    const n = rings.length;

    // Reuse arrays where possible. dists[] holds {j, d2} candidates.
    const dists = new Array(n - 1);
    const seen  = new Set();
    let cursor  = 0;
    const buf   = this.connectionPositions;

    for (let i = 0; i < n; i++) {
      const pi = rings[i].mesh.position;
      let m = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const pj = rings[j].mesh.position;
        const dx = pi.x - pj.x, dy = pi.y - pj.y, dz = pi.z - pj.z;
        if (m < dists.length) dists[m++] = { j, d2: dx*dx + dy*dy + dz*dz };
      }
      // Partial sort: only need the smallest k. n is small (≤48) so a
      // full sort is fine and simpler than a heap.
      dists.sort((a, b) => a.d2 - b.d2);
      const take = Math.min(k, dists.length);
      for (let s = 0; s < take; s++) {
        const j = dists[s].j;
        const a = Math.min(i, j), b = Math.max(i, j);
        const key = a * 1024 + b;
        if (seen.has(key)) continue;
        seen.add(key);
        if (cursor + 6 > buf.length) break;
        const pj = rings[j].mesh.position;
        buf[cursor++] = pi.x; buf[cursor++] = pi.y; buf[cursor++] = pi.z;
        buf[cursor++] = pj.x; buf[cursor++] = pj.y; buf[cursor++] = pj.z;
      }
    }

    this.connectionGeom.attributes.position.needsUpdate = true;
    this.connectionGeom.setDrawRange(0, cursor / 3);
    // Recompute bounds so frustum culling (off here, but cheap insurance)
    // and any future raycasts have valid extents.
    this.connectionGeom.computeBoundingSphere();
  }
}
