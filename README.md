# RADIAS

_by @newomp4_

Interlaced 3D gyroscopic ring visualizer. Live dashboard, real-time preview, video export.

## Run

```bash
npm install        # first time only — installs everything into ./node_modules
npm run dev        # opens http://127.0.0.1:5173 in your browser
```

Everything this project uses (node_modules, npm cache, Vite cache) lives inside this folder. Delete the folder and it's all gone.

## Controls

All parameters live in the right-hand dashboard.

- **Composition** — ring count, base size, **radius step** (offset rings — spaces them concentrically), thickness, color
- **Merging** — **blend amount** (how wide the metaball fusion zone is), rim falloff, exposure
- **Offset** — per-ring center offset amplitude + reproducible seed (Randomize to shuffle)
- **Pulse** — radius modulation amount + frequency
- **Motion** — rotation speed, resolve slider (0 = chaos → 1 = one unified circle), animate-resolve button
- **Export** — canvas size preset, fps, bitrate, duration, PNG snapshot, record button
- **View** — reset camera

Shortcuts: `R` reset camera · `Space` animate resolve · drag to orbit · scroll to zoom.

## Export

Video: WebM (VP9/VP8). Plays in VLC/Chrome. Convert to MP4 if you need it:

```bash
ffmpeg -i radias-YYYYMMDD-HHMMSS.webm -c:v libx264 -crf 18 out.mp4
```

Still: PNG at the chosen canvas-size resolution.

## Production build

```bash
npm run build        # outputs ./dist (fully static, openable without a server)
npm run preview      # local preview of the built site
```

## What's where

```
src/
  main.js                    — boots the app, builds the dashboard
  scene.js                   — renderer + camera + SDF raymarch material
  rings.js                   — ring state (center, normal, radius per ring)
  export.js                  — MediaRecorder wrapper for video + PNG
  shaders/raymarch.glsl.js   — fragment shader: torus SDFs + smooth-min
  styles.css                 — monochrome UI + lil-gui overrides
```

## How the merging works

Each ring is a **torus signed-distance field** — a mathematical function that tells you, for any point in space, how far you are from the ring's surface. A fragment shader combines all N of them with a **polynomial smooth-minimum**, which instead of picking the nearer surface blends them smoothly within a radius set by the **Blend amount** slider. Where two rings come within that distance, they fuse into one continuous surface — real 3D metaball merging, not a screen effect. The whole frame is then ray-marched (one shader pass, no geometry) and shaded with a fresnel rim light on black.
