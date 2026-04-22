/**
 * Video + still-image export.
 *
 * Video: we call canvas.captureStream() which gives us a MediaStream of the
 * rendered frames, feed it to a MediaRecorder, and collect chunks until stop.
 * Zero extra dependencies — this is a built-in browser API.
 *
 * Container: WebM (VP9 if available, falling back to VP8). WebM plays in VLC,
 * Chrome, and most modern players; converts cleanly to MP4 with ffmpeg if
 * needed (`ffmpeg -i in.webm out.mp4`).
 *
 * Still: toBlob on the canvas at PNG.
 */
export const SIZE_PRESETS = {
  'Square 1080':             { w: 1080, h: 1080 },
  'Square 2160':             { w: 2160, h: 2160 },
  'Square 2880 (5K)':        { w: 2880, h: 2880 },
  'Square 4320 (8K)':        { w: 4320, h: 4320 },
  'Portrait 1080 (9:16)':    { w: 1080, h: 1920 },
  'Portrait 2160 (9:16 4K)': { w: 2160, h: 3840 },
  'Portrait 2880 (9:16 5K)': { w: 2880, h: 5120 },
  'Landscape 1080 (16:9)':   { w: 1920, h: 1080 },
  'Landscape 1440 (16:9)':   { w: 2560, h: 1440 },
  'Landscape 2160 (16:9 4K)':{ w: 3840, h: 2160 },
  'Landscape 2880 (16:9 5K)':{ w: 5120, h: 2880 },
  'Landscape 4320 (16:9 8K)':{ w: 7680, h: 4320 },
  'Fit viewport':            { w: 0, h: 0 }
};

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
}

export class Recorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.recorder = null;
    this.chunks = [];
    this.state = 'idle'; // idle | recording
    this.onStateChange = () => {};
    this.onTick = () => {};
    this._tickTimer = null;
    this._startedAt = 0;
    this._stopTimer = null;
  }

  start({ fps = 60, bitrateMbps = 24, durationSec = 0, alpha = false } = {}) {
    if (this.state !== 'idle') return;

    const stream = this.canvas.captureStream(fps);
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: bitrateMbps * 1_000_000
    });

    this.chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: 'video/webm' });
      const suffix = alpha ? '-alpha' : '';
      this._download(blob, `radias${suffix}-${timestamp()}.webm`);
      this.state = 'idle';
      this.onStateChange('idle');
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    };

    recorder.start(250); // 250ms chunks
    this.recorder   = recorder;
    this.state      = 'recording';
    this._startedAt = performance.now();
    this.onStateChange('recording');

    this._tickTimer = setInterval(() => {
      const elapsed = (performance.now() - this._startedAt) / 1000;
      this.onTick(elapsed);
    }, 100);

    if (durationSec > 0) {
      this._stopTimer = setTimeout(() => this.stop(), durationSec * 1000);
    }
  }

  stop() {
    if (this.state !== 'recording') return;
    if (this._stopTimer) {
      clearTimeout(this._stopTimer);
      this._stopTimer = null;
    }
    this.recorder.stop();
  }

  snapshot({ alpha = false } = {}) {
    const suffix = alpha ? '-alpha' : '';
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      this._download(blob, `radias${suffix}-${timestamp()}.png`);
    }, 'image/png');
  }

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
