// GLSL source exported as a JS string so Vite bundles it with no extra plugins.
// Uses GLSL ES 3.00 (WebGL2) — enabled via ShaderMaterial { glslVersion: THREE.GLSL3 }.

export const MAX_RINGS = 32;

export const VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const FRAG = /* glsl */ `
precision highp float;
precision highp int;

#define MAX_RINGS ${MAX_RINGS}

in vec2 vUv;
out vec4 fragColor;

uniform mat4  uInvView;   // camera.matrixWorld
uniform mat4  uInvProj;   // camera.projectionMatrixInverse
uniform vec3  uCamPos;

uniform int   uRingCount;
uniform vec3  uRingCenter[MAX_RINGS];
uniform vec3  uRingNormal[MAX_RINGS];
uniform float uRingRadius[MAX_RINGS];

uniform float uThickness;   // torus minor radius
uniform float uBlend;       // smooth-min 'k' — how aggressively merges spread
uniform float uFresnelPow;  // rim falloff exponent
uniform float uExposure;    // final brightness scalar
uniform vec3  uColor;       // ring color (usually white)

// --- Torus signed-distance field -----------------------------------------
// A torus sitting in a plane defined by a point c and a normal n, with
// major radius R (the ring size) and minor radius r (the tube thickness).
// We project the sample point into the ring's local axial/radial frame,
// then the problem collapses to a 2D circle-distance in that plane.
float sdTorus(vec3 p, vec3 c, vec3 n, float R, float r) {
  vec3  local  = p - c;
  float axial  = dot(local, n);
  vec3  radial = local - axial * n;
  float rad    = length(radial);
  return length(vec2(rad - R, axial)) - r;
}

// --- Polynomial smooth-minimum -------------------------------------------
// Standard iq smin. When two SDFs are within 'k' of each other, we blend
// them smoothly instead of picking the nearer. This is what turns ring
// intersections into continuous blobs — the "metaball" look.
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sceneDist(vec3 p) {
  float d = 1e5;
  for (int i = 0; i < MAX_RINGS; i++) {
    if (i >= uRingCount) break;
    float di = sdTorus(p, uRingCenter[i], uRingNormal[i], uRingRadius[i], uThickness);
    d = smin(d, di, uBlend);
  }
  return d;
}

// --- Normals via central-difference gradient -----------------------------
vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    sceneDist(p + e.xyy) - sceneDist(p - e.xyy),
    sceneDist(p + e.yxy) - sceneDist(p - e.yxy),
    sceneDist(p + e.yyx) - sceneDist(p - e.yyx)
  ));
}

// --- Ambient occlusion -----------------------------------------------------
// Samples the SDF a few times along the surface normal. Where the surface
// is concave (e.g. right where two rings fuse), nearby samples read very
// small distances, so AO returns lower → those seams darken slightly,
// which visually reads as soft volumetric merging.
float calcAO(vec3 p, vec3 n) {
  float ao = 0.0;
  float scale = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = float(i) * 0.06;
    ao += (h - sceneDist(p + n * h)) * scale;
    scale *= 0.6;
  }
  return clamp(1.0 - ao * 1.5, 0.0, 1.0);
}

void main() {
  // Unproject the fragment's NDC into a world-space ray.
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 clip = vec4(ndc, -1.0, 1.0);
  vec4 eye  = uInvProj * clip;
  eye = vec4(eye.xy, -1.0, 0.0);            // direction vector, w=0
  vec3 rd = normalize((uInvView * eye).xyz);
  vec3 ro = uCamPos;

  // Sphere-trace the combined SDF.
  float t = 0.0;
  bool  hit = false;
  const int MAX_STEPS = 96;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = sceneDist(p);
    if (d < 0.0015) { hit = true; break; }
    if (t > 120.0)  break;
    // Slight under-step for cleaner normals at the thin tube scale.
    t += d * 0.92;
  }

  vec3 col = vec3(0.0);
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), uFresnelPow);
    float ao  = calcAO(p, n);

    // Monochrome shading: dim core + bright fresnel rim, modulated by AO.
    vec3 core = uColor * 0.08;
    vec3 edge = uColor;
    col = mix(core, edge, rim) * ao * uExposure;
  }

  fragColor = vec4(col, 1.0);
}
`;
