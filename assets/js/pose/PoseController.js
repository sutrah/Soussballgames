// Contrôleur de pose partagé — MediaPipe Tasks Vision, 100% navigateur.
// Aucune image ne quitte l'appareil : tout tourne en local (WASM + webcam).

const VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Indices des repères de pose utilisés par les jeux (format BlazePose 33 pts).
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
  L_FOOT: 31, R_FOOT: 32,
};

export class PoseController {
  /**
   * @param {object} opts
   * @param {HTMLVideoElement} opts.video - élément vidéo (peut être caché) recevant le flux caméra.
   * @param {boolean} [opts.mirror=true] - inverse l'axe X pour correspondre à ce que voit l'utilisateur.
   */
  constructor({ video, mirror = true }) {
    this.video = video;
    this.mirror = mirror;
    this.landmarker = null;
    this.running = false;
    this.lastResult = null;
    this.listeners = new Set();
    this._statusListeners = new Set();
    this.status = "idle"; // idle | requesting | loading-model | ready | error
  }

  onFrame(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  onStatus(cb) { this._statusListeners.add(cb); return () => this._statusListeners.delete(cb); }

  _setStatus(s, detail) {
    this.status = s;
    for (const cb of this._statusListeners) cb(s, detail);
  }

  async start() {
    if (this.running) return;
    try {
      this._setStatus("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();

      this._setStatus("loading-model");
      const { PoseLandmarker, FilesetResolver } = await import(VISION_CDN);
      const files = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.landmarker = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.running = true;
      this._setStatus("ready");
      this._loop();
    } catch (err) {
      this._setStatus("error", err);
      throw err;
    }
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    if (this.video.readyState >= 2) {
      const result = this.landmarker.detectForVideo(this.video, now);
      const landmarks = result?.landmarks?.[0] || null;
      const points = landmarks ? this._normalize(landmarks) : null;
      this.lastResult = points;
      for (const cb of this.listeners) cb(points, now);
    }
    requestAnimationFrame(() => this._loop());
  }

  _normalize(landmarks) {
    return landmarks.map((p) => ({
      x: this.mirror ? 1 - p.x : p.x,
      y: p.y,
      z: p.z,
      v: p.visibility ?? 1,
    }));
  }

  stop() {
    this.running = false;
    const stream = this.video.srcObject;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this._setStatus("idle");
  }
}
