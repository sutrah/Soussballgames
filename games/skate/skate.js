import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { EdgeTrigger, Baseline, kneeLift, shoulderTilt, handsRaised } from "../../assets/js/pose/gestures.js";
import { drawSkeleton } from "../../assets/js/pose/skeleton.js";
import { createPerspective } from "../../assets/js/render/perspective.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const video = document.getElementById("video");
const skeleton = document.getElementById("skeleton");
const camDot = document.getElementById("camDot");
const camLabel = document.getElementById("camLabel");
const scoreVal = document.getElementById("scoreVal");
const overlayStart = document.getElementById("overlayStart");
const overlayOver = document.getElementById("overlayOver");
const finalScore = document.getElementById("finalScore");
const bestScoreEl = document.getElementById("bestScore");
const btnStart = document.getElementById("btnStart");
const btnRetry = document.getElementById("btnRetry");

const BEST_KEY = "skate-best";
let best = Number(localStorage.getItem(BEST_KEY) || 0);
bestScoreEl.textContent = best;

// ---------- Détection corporelle ----------
const pushBaseline = new Baseline(0.03);
const pushTrigger = new EdgeTrigger(0.02, 0.055, 200);
let pushQueued = 0;
let tilt = 0;
let handsState = { left: false, right: false };

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

pose.onFrame((lm) => {
  drawSkeleton(skeleton, lm, LM, { highlight: [LM.L_KNEE, LM.R_KNEE, LM.L_WRIST, LM.R_WRIST] });
  if (!lm) return;

  const lift = kneeLift(lm, LM);
  pushBaseline.update(lift);
  if (pushTrigger.update(lift - pushBaseline.value)) pushQueued++;

  tilt = shoulderTilt(lm, LM);
  handsState = handsRaised(lm, LM);
});

// ---------- Monde pseudo-3D façon Tron ----------
const HORIZON_Y = H * 0.3;
const GROUND_Y = H * 0.88;
const CENTER_X = W / 2;
const TRACK_HALF_WIDTH = 300;

const persp = createPerspective({ horizonY: HORIZON_Y, groundY: GROUND_Y, centerX: CENTER_X, farScale: 0.1 });
const { scaleAt, yAt, xAt } = persp;

const MIN_SPEED = 90;
const MAX_SPEED = 620;
const PUSH_BOOST = 150;
const FRICTION = 0.7;
const MAX_STEER_VEL = 520;
const STEER_DEADZONE = 0.05;
const STEER_MAX_ANGLE = 0.4;

let state = "idle";
let player, orbs, score, t, spawnTimer, trail;

function resetGame() {
  player = { x: 0, lateralVel: 0, speed: MIN_SPEED, bob: 0 };
  orbs = [];
  trail = [];
  score = 0;
  t = 0;
  spawnTimer = 0;
  scoreVal.textContent = "0";
}

function spawnOrb() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const x = side * (60 + Math.random() * (TRACK_HALF_WIDTH - 90));
  orbs.push({ x, z: 1.05, side, caught: false, missed: false });
}

function update(dt) {
  t += dt;

  const speedRatio = (player.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  let steerTilt = tilt;
  if (Math.abs(steerTilt) < STEER_DEADZONE) steerTilt = 0;
  else steerTilt -= Math.sign(steerTilt) * STEER_DEADZONE;
  const steerNorm = Math.max(-1, Math.min(1, steerTilt / STEER_MAX_ANGLE));
  const targetLateralVel = steerNorm * MAX_STEER_VEL * (0.45 + 0.55 * Math.max(0, speedRatio));
  player.lateralVel += (targetLateralVel - player.lateralVel) * Math.min(1, 7 * dt);
  player.x += player.lateralVel * dt;

  while (pushQueued > 0) {
    player.speed = Math.min(MAX_SPEED, player.speed + PUSH_BOOST);
    pushQueued--;
  }
  player.speed += (MIN_SPEED - player.speed) * Math.min(1, FRICTION * dt);
  player.bob += dt * (4 + player.speed * 0.01);

  spawnTimer += dt;
  const interval = Math.max(0.55, 1.3 - player.speed / MAX_SPEED);
  if (spawnTimer >= interval) { spawnTimer = 0; spawnOrb(); }

  const distPerSec = player.speed * 0.9;
  for (const o of orbs) o.z -= (distPerSec / 900) * dt;
  orbs = orbs.filter((o) => o.z > -0.05);

  for (const o of orbs) {
    if (o.caught || o.missed) continue;
    if (o.z < 0.12 && o.z > -0.02) {
      const near = Math.abs(o.x - player.x) < 90;
      const handOk = o.side < 0 ? handsState.left : handsState.right;
      if (near && handOk) {
        o.caught = true;
        score += 25;
        player.speed = Math.min(MAX_SPEED, player.speed + 60);
      } else if (o.z < -0.005) {
        o.missed = true;
      }
    }
  }

  score += dt * player.speed * 0.04;
  scoreVal.textContent = Math.floor(score);

  if (Math.random() < 0.7) {
    trail.push({ x: player.x, age: 0, life: 0.35 + Math.random() * 0.15 });
  }
  for (const tr of trail) tr.age += dt;
  trail = trail.filter((tr) => tr.age < tr.life);

  return Math.abs(player.x) > TRACK_HALF_WIDTH;
}

// ---------- Rendu ----------
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#04030a");
  g.addColorStop(0.4, "#0a0518");
  g.addColorStop(1, "#000103");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const sunY = HORIZON_Y - 10;
  const sunGrad = ctx.createRadialGradient(CENTER_X, sunY, 10, CENTER_X, sunY, 260);
  sunGrad.addColorStop(0, "rgba(236,72,153,0.35)");
  sunGrad.addColorStop(1, "rgba(236,72,153,0)");
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, 0, W, HORIZON_Y + 40);
}

function drawTrack() {
  ctx.beginPath();
  ctx.moveTo(xAt(-TRACK_HALF_WIDTH * 1.5, 1), yAt(1));
  ctx.lineTo(xAt(TRACK_HALF_WIDTH * 1.5, 1), yAt(1));
  ctx.lineTo(xAt(TRACK_HALF_WIDTH * 1.5, 0), yAt(0));
  ctx.lineTo(xAt(-TRACK_HALF_WIDTH * 1.5, 0), yAt(0));
  ctx.closePath();
  ctx.fillStyle = "rgba(6,182,212,0.05)";
  ctx.fill();

  ctx.lineWidth = 2.4;
  ctx.strokeStyle = "rgba(34,211,238,0.55)";
  ctx.shadowColor = "#22d3ee";
  ctx.shadowBlur = 10;
  for (const edge of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(xAt(edge * TRACK_HALF_WIDTH, 1), yAt(1));
    ctx.lineTo(xAt(edge * TRACK_HALF_WIDTH, 0), yAt(0));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  const scrollOffset = (t * (player?.speed || MIN_SPEED) * 0.55) % 60;
  ctx.strokeStyle = "rgba(125,211,252,0.18)";
  ctx.lineWidth = 1.5;
  for (let gz = 1 - scrollOffset / 900; gz > 0; gz -= 60 / 900) {
    if (gz <= 0) continue;
    ctx.beginPath();
    ctx.moveTo(xAt(-TRACK_HALF_WIDTH, gz), yAt(gz));
    ctx.lineTo(xAt(TRACK_HALF_WIDTH, gz), yAt(gz));
    ctx.stroke();
  }
  const laneCount = 5;
  for (let i = 1; i < laneCount; i++) {
    const lx = -TRACK_HALF_WIDTH + (i * 2 * TRACK_HALF_WIDTH) / laneCount;
    ctx.beginPath();
    ctx.moveTo(xAt(lx, 1), yAt(1));
    ctx.lineTo(xAt(lx, 0), yAt(0));
    ctx.strokeStyle = "rgba(125,211,252,0.08)";
    ctx.stroke();
  }
}

function drawOrb(o) {
  if (o.caught || o.missed) return;
  const s = scaleAt(o.z);
  const x = xAt(o.x, o.z);
  const y = yAt(o.z) - 50 * s;
  const r = 15 * s;
  ctx.save();
  ctx.shadowColor = o.side < 0 ? "#22d3ee" : "#f472b6";
  ctx.shadowBlur = 18 * s;
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, o.side < 0 ? "#22d3ee" : "#f472b6");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const x = xAt(player.x, 0);
  const y = yAt(0) - Math.abs(Math.sin(player.bob)) * 6;
  const lean = Math.max(-0.5, Math.min(0.5, player.lateralVel / MAX_STEER_VEL));

  for (const tr of trail) {
    const a = 1 - tr.age / tr.life;
    ctx.globalAlpha = a * 0.4;
    ctx.fillStyle = "#22d3ee";
    const tx = xAt(tr.x, 0.015);
    ctx.beginPath();
    ctx.arc(tx, y + 30, 5 * a + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean * 0.6);

  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 20;
  const grad = ctx.createLinearGradient(-30, -60, 30, 10);
  grad.addColorStop(0, "#e0f2fe");
  grad.addColorStop(1, "#22d3ee");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, -60);
  ctx.lineTo(20, -10);
  ctx.lineTo(10, 12);
  ctx.lineTo(-10, 12);
  ctx.lineTo(-20, -10);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = handsState.left ? "#f472b6" : "rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.arc(-24 - (handsState.left ? 10 : 0), -20, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = handsState.right ? "#f472b6" : "rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.arc(24 + (handsState.right ? 10 : 0), -20, 6, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawSpeedLines() {
  const speedRatio = (player.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  if (speedRatio < 0.35) return;
  ctx.strokeStyle = `rgba(224,242,254,${0.05 + speedRatio * 0.12})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const rx = (Math.sin(i * 12.9898 + Math.floor(t * 6)) * 0.5 + 0.5) * W;
    const len = 40 + speedRatio * 90;
    ctx.beginPath();
    ctx.moveTo(rx, HORIZON_Y + 20);
    ctx.lineTo(rx, HORIZON_Y + 20 + len);
    ctx.stroke();
  }
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.033, (now - prevT) / 1000);

  if (state === "playing") {
    const dead = update(dt);
    if (dead) endGame();
  }

  drawBackground();
  drawTrack();
  drawSpeedLines();
  const sorted = [...orbs].sort((a, b) => b.z - a.z);
  for (const o of sorted) drawOrb(o);
  drawPlayer();

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
  const finalS = Math.floor(score);
  if (finalS > best) { best = finalS; localStorage.setItem(BEST_KEY, String(best)); }
  finalScore.textContent = finalS;
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

// Fallback clavier pour tester sans caméra / accessibilité.
window.addEventListener("keydown", (e) => {
  if (state !== "playing") return;
  if (e.code === "Space") pushQueued++;
  if (e.code === "ArrowLeft") tilt = -0.3;
  if (e.code === "ArrowRight") tilt = 0.3;
  if (e.code === "KeyA") handsState.left = true;
  if (e.code === "KeyD") handsState.right = true;
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") tilt = 0;
  if (e.code === "KeyA") handsState.left = false;
  if (e.code === "KeyD") handsState.right = false;
});

resetGame();
requestAnimationFrame(() => frame(performance.now()));
