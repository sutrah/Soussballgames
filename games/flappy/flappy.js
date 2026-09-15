import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { EdgeTrigger, Baseline, kneeLift, mid } from "../../assets/js/pose/gestures.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const video = document.getElementById("video");
const skeleton = document.getElementById("skeleton");
const skelCtx = skeleton.getContext("2d");
const camDot = document.getElementById("camDot");
const camLabel = document.getElementById("camLabel");
const scoreVal = document.getElementById("scoreVal");
const overlayStart = document.getElementById("overlayStart");
const overlayOver = document.getElementById("overlayOver");
const finalScore = document.getElementById("finalScore");
const bestScoreEl = document.getElementById("bestScore");
const btnStart = document.getElementById("btnStart");
const btnRetry = document.getElementById("btnRetry");

const BEST_KEY = "flappy-patineur-best";
let best = Number(localStorage.getItem(BEST_KEY) || 0);
bestScoreEl.textContent = best;

// ---------- Détection des pas (genoux) ----------
const liftBaseline = new Baseline(0.03);
const stepTrigger = new EdgeTrigger(0.02, 0.055, 220);
let liftSignal = 0;

const pose = new PoseController({ video, mirror: true });
pose.onStatus((status) => {
  camDot.classList.toggle("ok", status === "ready");
  camLabel.textContent = {
    idle: "Caméra inactive",
    requesting: "Autorisation caméra…",
    "loading-model": "Chargement du modèle…",
    ready: "Caméra active",
    error: "Erreur caméra",
  }[status] || status;
});

let flapQueued = 0;
pose.onFrame((lm) => {
  drawSkeleton(lm);
  if (!lm) return;
  const hip = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  const lift = kneeLift(lm, LM);
  liftBaseline.update(lift);
  liftSignal = lift - liftBaseline.value;
  if (stepTrigger.update(liftSignal)) flapQueued++;
});

function drawSkeleton(lm) {
  skeleton.width = skeleton.clientWidth;
  skeleton.height = skeleton.clientHeight;
  skelCtx.clearRect(0, 0, skeleton.width, skeleton.height);
  if (!lm) return;
  const pairs = [
    [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
    [LM.L_HIP, LM.R_HIP], [LM.L_HIP, LM.L_KNEE], [LM.R_HIP, LM.R_KNEE],
    [LM.L_KNEE, LM.L_ANKLE], [LM.R_KNEE, LM.R_ANKLE],
  ];
  skelCtx.strokeStyle = "rgba(125,211,252,0.85)";
  skelCtx.lineWidth = 3;
  for (const [a, b] of pairs) {
    const pa = lm[a], pb = lm[b];
    skelCtx.beginPath();
    skelCtx.moveTo(pa.x * skeleton.width, pa.y * skeleton.height);
    skelCtx.lineTo(pb.x * skeleton.width, pb.y * skeleton.height);
    skelCtx.stroke();
  }
  skelCtx.fillStyle = "#a78bfa";
  for (const i of [LM.L_KNEE, LM.R_KNEE]) {
    const p = lm[i];
    skelCtx.beginPath();
    skelCtx.arc(p.x * skeleton.width, p.y * skeleton.height, 5, 0, Math.PI * 2);
    skelCtx.fill();
  }
}

// ---------- État du jeu ----------
const GRAVITY = 1800; // px/s^2
const FLAP_VELOCITY = -560; // px/s
const PIPE_GAP = 230;
const PIPE_WIDTH = 96;
const PIPE_SPEED = 230; // px/s
const SPAWN_INTERVAL = 1.35; // s
const BIRD_X = W * 0.28;
const BIRD_R = 22;

let state = "idle"; // idle | playing | dead
let bird, pipes, score, spawnTimer, t, particles, stars;

function resetGame() {
  bird = { y: H / 2, vy: 0, tilt: 0 };
  pipes = [];
  particles = [];
  score = 0;
  spawnTimer = 0;
  t = 0;
  scoreVal.textContent = "0";
  stars = Array.from({ length: 60 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.6 + 0.4,
    s: Math.random() * 20 + 8,
  }));
}

function spawnPipe() {
  const margin = 90;
  const gapY = margin + Math.random() * (H - margin * 2 - PIPE_GAP);
  pipes.push({ x: W + PIPE_WIDTH, gapY, passed: false });
}

function flap() {
  bird.vy = FLAP_VELOCITY;
  for (let i = 0; i < 10; i++) {
    particles.push({
      x: BIRD_X - BIRD_R * 0.6, y: bird.y + BIRD_R * 0.4,
      vx: -120 - Math.random() * 80, vy: (Math.random() - 0.5) * 140,
      life: 0.5 + Math.random() * 0.3, age: 0,
    });
  }
}

function update(dt) {
  t += dt;

  while (flapQueued > 0) { flap(); flapQueued--; }

  bird.vy += GRAVITY * dt;
  bird.y += bird.vy * dt;
  bird.tilt = Math.max(-0.5, Math.min(1.1, bird.vy / 700));

  spawnTimer += dt;
  if (spawnTimer >= SPAWN_INTERVAL) { spawnTimer = 0; spawnPipe(); }

  for (const p of pipes) p.x -= PIPE_SPEED * dt;
  while (pipes.length && pipes[0].x < -PIPE_WIDTH) pipes.shift();

  for (const p of pipes) {
    if (!p.passed && p.x + PIPE_WIDTH < BIRD_X) { p.passed = true; score++; scoreVal.textContent = score; }
  }

  for (const s of stars) { s.x -= s.s * dt; if (s.x < 0) s.x = W; }

  for (const pt of particles) { pt.age += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; }
  particles = particles.filter((pt) => pt.age < pt.life);

  // Le plafond freine sans tuer (comme un vrai flappy) : seul le sol est fatal,
  // pour ne pas punir un joueur qui marche un peu trop vite.
  if (bird.y - BIRD_R < 0) { bird.y = BIRD_R; bird.vy = Math.max(bird.vy, 0); }
  if (bird.y + BIRD_R > H) return true;
  for (const p of pipes) {
    const withinX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_WIDTH;
    if (!withinX) continue;
    const inGap = bird.y - BIRD_R > p.gapY && bird.y + BIRD_R < p.gapY + PIPE_GAP;
    if (!inGap) return true;
  }
  return false;
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0c1024");
  g.addColorStop(1, "#05060c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (const s of stars) {
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin((t + s.x) * 0.5);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPipe(p) {
  const grad = ctx.createLinearGradient(p.x, 0, p.x + PIPE_WIDTH, 0);
  grad.addColorStop(0, "rgba(125,211,252,0.18)");
  grad.addColorStop(0.5, "rgba(125,211,252,0.32)");
  grad.addColorStop(1, "rgba(125,211,252,0.18)");

  roundRect(ctx, p.x, 0, PIPE_WIDTH, p.gapY, 18);
  ctx.fillStyle = grad;
  ctx.fill();
  roundRect(ctx, p.x, p.gapY + PIPE_GAP, PIPE_WIDTH, H - (p.gapY + PIPE_GAP), 18);
  ctx.fill();

  ctx.strokeStyle = "rgba(167,139,250,0.9)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 14;
  line(ctx, p.x + 6, p.gapY, p.x + PIPE_WIDTH - 6, p.gapY);
  line(ctx, p.x + 6, p.gapY + PIPE_GAP, p.x + PIPE_WIDTH - 6, p.gapY + PIPE_GAP);
  ctx.shadowBlur = 0;
}

function line(c, x1, y1, x2, y2) {
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
}

function roundRect(c, x, y, w, h, r) {
  if (h <= 0) { c.beginPath(); return; }
  r = Math.min(r, w / 2, Math.max(h / 2, 1));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawBird() {
  ctx.save();
  ctx.translate(BIRD_X, bird.y);
  ctx.rotate(bird.tilt * 0.5);

  for (const pt of particles) {
    ctx.globalAlpha = 1 - pt.age / pt.life;
    ctx.fillStyle = "#7dd3fc";
    ctx.beginPath();
    ctx.arc(pt.x - BIRD_X, pt.y - bird.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const grad = ctx.createRadialGradient(-6, -6, 2, 0, 0, BIRD_R);
  grad.addColorStop(0, "#e0f2fe");
  grad.addColorStop(0.5, "#7dd3fc");
  grad.addColorStop(1, "#a78bfa");
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#06070d";
  ctx.beginPath();
  ctx.arc(BIRD_R * 0.35, -BIRD_R * 0.2, 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.033, (now - prevT) / 1000);

  if (state === "playing") {
    const dead = update(dt);
    if (dead) endGame();
  }

  drawBackground();
  for (const p of pipes) drawPipe(p);
  drawBird();

  requestAnimationFrame(() => frame(now));
}

function startGame() {
  resetGame();
  state = "playing";
  overlayStart.style.display = "none";
  overlayOver.style.display = "none";
}

function endGame() {
  state = "dead";
  if (score > best) { best = score; localStorage.setItem(BEST_KEY, String(best)); }
  finalScore.textContent = score;
  bestScoreEl.textContent = best;
  overlayOver.style.display = "flex";
}

btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  btnStart.textContent = "Activation…";
  try {
    await pose.start();
    startGame();
  } catch (e) {
    btnStart.disabled = false;
    btnStart.textContent = "Réessayer";
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
});

btnRetry.addEventListener("click", startGame);

// Fallback clavier (espace) pour tester sans caméra / accessibilité.
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && state === "playing") flapQueued++;
});

resetGame();
requestAnimationFrame(() => frame(performance.now()));
