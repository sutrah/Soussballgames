import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { EMA, Baseline, EdgeTrigger, mid } from "../../assets/js/pose/gestures.js";
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

const BEST_KEY = "subway-runner-best";
let best = Number(localStorage.getItem(BEST_KEY) || 0);
bestScoreEl.textContent = best;

// ---------- Détection corporelle ----------
const hipBaseline = new Baseline(0.02);
const jumpTrigger = new EdgeTrigger(0.03, 0.075, 260);
const hipXSmooth = new EMA(0.35);
const FREEZE_GESTURE = 0.07; // au-delà, on gèle la baseline pour ne pas "absorber" le geste

let wantJump = false;
let crouchSignal = false;
let laneSignal = 0; // -1, 0, 1

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
  drawSkeleton(skeleton, lm, LM, { highlight: [LM.L_HIP, LM.R_HIP] });
  if (!lm) return;
  const hip = mid(lm[LM.L_HIP], lm[LM.R_HIP]);

  if (hipBaseline.value == null || Math.abs(hip.y - hipBaseline.value) < FREEZE_GESTURE) {
    hipBaseline.update(hip.y);
  }
  const rel = hip.y - (hipBaseline.value ?? hip.y);

  if (jumpTrigger.update(-rel)) wantJump = true;
  crouchSignal = rel > 0.05;

  const x = hipXSmooth.push(hip.x);
  if (x < 0.36) laneSignal = -1;
  else if (x > 0.64) laneSignal = 1;
  else if (x > 0.42 && x < 0.58) laneSignal = 0;
  // zone intermédiaire : on garde la dernière voie détectée (hystérésis)
});

// ---------- Monde pseudo-3D ----------
const HORIZON_Y = H * 0.34;
const GROUND_Y = H * 0.84;
const CENTER_X = W / 2;
const LANE_OFFSET_NEAR = 165;
const LANES = [-1, 0, 1];

const persp = createPerspective({ horizonY: HORIZON_Y, groundY: GROUND_Y, centerX: CENTER_X, farScale: 0.16 });
const { scaleAt, yAt } = persp;
function laneX(lane, z) { return persp.xAt(lane * LANE_OFFSET_NEAR, z); }

const GRAVITY = 2600;
const JUMP_VELOCITY = -980;
const LANE_LERP = 10;

let state = "idle";
let player, objects, score, spawnTimer, speed, t, dust, coinCount;

function resetGame() {
  player = { lane: 0, laneAnim: 0, jumpY: 0, jumpVy: 0, crouch: false, runPhase: 0 };
  objects = [];
  dust = [];
  score = 0;
  coinCount = 0;
  spawnTimer = 0;
  speed = 0.5;
  t = 0;
  scoreVal.textContent = "0";
}

function spawnWave() {
  const blockedLanes = new Set();
  const roll = Math.random();
  if (roll < 0.55) {
    blockedLanes.add(LANES[Math.floor(Math.random() * 3)]);
  } else if (roll < 0.8) {
    const a = LANES[Math.floor(Math.random() * 3)];
    let b = LANES[Math.floor(Math.random() * 3)];
    if (b !== a) blockedLanes.add(a), blockedLanes.add(b);
    else blockedLanes.add(a);
  }
  for (const lane of LANES) {
    if (blockedLanes.has(lane)) {
      const type = Math.random() < 0.5 ? "block" : "bar";
      objects.push({ lane, z: 1.05, type, hit: false });
    } else if (Math.random() < 0.6) {
      objects.push({ lane, z: 1.05, type: "coin", hit: false });
    }
  }
}

function update(dt) {
  t += dt;
  speed = Math.min(1.35, 0.5 + t * 0.012);

  if (wantJump && player.jumpY <= 0.5) {
    player.jumpVy = JUMP_VELOCITY;
  }
  wantJump = false;
  player.jumpVy += GRAVITY * dt;
  player.jumpY += -player.jumpVy * dt;
  if (player.jumpY < 0) { player.jumpY = 0; player.jumpVy = 0; }
  player.crouch = crouchSignal && player.jumpY < 4;

  player.lane = laneSignal;
  player.laneAnim += (player.lane - player.laneAnim) * Math.min(1, LANE_LERP * dt);
  player.runPhase += dt * (8 + speed * 4);

  spawnTimer += dt;
  const interval = Math.max(0.62, 1.15 - speed * 0.35);
  if (spawnTimer >= interval) { spawnTimer = 0; spawnWave(); }

  for (const o of objects) o.z -= speed * dt;
  objects = objects.filter((o) => o.z > -0.08);

  for (const o of objects) {
    if (o.hit) continue;
    if (o.z < 0.1 && o.z > -0.02 && Math.round(player.laneAnim) === o.lane) {
      if (o.type === "coin") {
        o.hit = true; coinCount++; score += 5; scoreVal.textContent = score;
      } else if (o.type === "block") {
        if (player.jumpY > 60) { o.hit = true; }
        else return true;
      } else if (o.type === "bar") {
        if (player.crouch) { o.hit = true; }
        else return true;
      }
    }
  }

  score += dt * 12 * speed;
  scoreVal.textContent = Math.floor(score);

  if (Math.random() < 0.6) {
    dust.push({ x: CENTER_X + (Math.random() - 0.5) * 40, y: GROUND_Y + 6, life: 0.4, age: 0, vx: (Math.random() - 0.5) * 30 });
  }
  for (const d of dust) { d.age += dt; d.y += 40 * dt; d.x += d.vx * dt; }
  dust = dust.filter((d) => d.age < d.life);

  return false;
}

// ---------- Rendu ----------
function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
  g.addColorStop(0, "#120f24");
  g.addColorStop(1, "#1a1f3a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HORIZON_Y);

  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 6; i++) {
    const bx = (i * 137 - (t * 20) % 137) % (W + 200) - 100;
    const bh = 40 + (i % 3) * 30;
    ctx.fillStyle = i % 2 ? "rgba(125,211,252,0.12)" : "rgba(167,139,250,0.12)";
    ctx.fillRect(bx, HORIZON_Y - bh, 70, bh);
  }
  ctx.restore();
}

function drawRoad() {
  ctx.fillStyle = "#05060c";
  ctx.fillRect(0, HORIZON_Y, W, H - HORIZON_Y);

  ctx.beginPath();
  ctx.moveTo(laneX(-1.6, 1), yAt(1));
  ctx.lineTo(laneX(1.6, 1), yAt(1));
  ctx.lineTo(laneX(1.6, 0), yAt(0));
  ctx.lineTo(laneX(-1.6, 0), yAt(0));
  ctx.closePath();
  const rg = ctx.createLinearGradient(0, HORIZON_Y, 0, GROUND_Y);
  rg.addColorStop(0, "#141935");
  rg.addColorStop(1, "#0a0d1e");
  ctx.fillStyle = rg;
  ctx.fill();

  ctx.strokeStyle = "rgba(125,211,252,0.35)";
  ctx.lineWidth = 2;
  for (const edge of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(laneX(edge * 1.6, 1), yAt(1));
    ctx.lineTo(laneX(edge * 1.6, 0), yAt(0));
    ctx.stroke();
  }

  const dashSpeed = (t * speed * 1.6) % 0.14;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  for (const lane of [-0.5, 0.5]) {
    for (let z = 1 - dashSpeed; z > 0; z -= 0.14) {
      const z2 = z - 0.07;
      if (z2 <= 0) continue;
      ctx.lineWidth = 2 * scaleAt(z);
      ctx.beginPath();
      ctx.moveTo(laneX(lane, z), yAt(z));
      ctx.lineTo(laneX(lane, z2), yAt(z2));
      ctx.stroke();
    }
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawObject(o) {
  const s = scaleAt(o.z);
  const x = laneX(o.lane, o.z);
  const y = yAt(o.z);
  if (o.type === "coin") {
    if (o.hit) return;
    const r = 16 * s;
    ctx.save();
    ctx.translate(x, y - 30 * s);
    ctx.shadowColor = "#fbbf24";
    ctx.shadowBlur = 16 * s;
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
    g.addColorStop(0, "#fff7d6");
    g.addColorStop(1, "#fbbf24");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const w = 86 * s, h = (o.type === "block" ? 46 : 26) * s;
  const oy = o.type === "block" ? y - h : y - 96 * s;
  ctx.save();
  ctx.shadowColor = o.hit ? "transparent" : (o.type === "block" ? "#fb7185" : "#fb923c");
  ctx.shadowBlur = 14 * s;
  const grad = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  if (o.hit) {
    grad.addColorStop(0, "rgba(255,255,255,0.06)");
    grad.addColorStop(1, "rgba(255,255,255,0.06)");
  } else if (o.type === "block") {
    grad.addColorStop(0, "rgba(251,113,133,0.35)");
    grad.addColorStop(1, "rgba(251,113,133,0.6)");
  } else {
    grad.addColorStop(0, "rgba(251,146,60,0.35)");
    grad.addColorStop(1, "rgba(251,146,60,0.6)");
  }
  roundRect(ctx, x - w / 2, oy, w, h, 8 * s);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const x = laneX(player.laneAnim, 0);
  const groundY = GROUND_Y;
  const y = groundY - player.jumpY;
  const crouch = player.crouch ? 0.55 : 1;
  const bodyH = 92 * crouch;
  const legSwing = Math.sin(player.runPhase) * (player.jumpY > 4 ? 4 : 14);

  for (const d of dust) {
    ctx.globalAlpha = 1 - d.age / d.life;
    ctx.fillStyle = "rgba(180,190,220,0.5)";
    ctx.beginPath();
    ctx.arc(d.x, d.y, 6 * (1 - d.age / d.life), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = "#a78bfa";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-10, -bodyH * 0.35); ctx.lineTo(-10 - legSwing, 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(10, -bodyH * 0.35); ctx.lineTo(10 + legSwing, 4); ctx.stroke();

  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 20;
  const grad = ctx.createLinearGradient(0, -bodyH, 0, 0);
  grad.addColorStop(0, "#e0f2fe");
  grad.addColorStop(1, "#7dd3fc");
  roundRect(ctx, -22, -bodyH, 44, bodyH * 0.75, 16);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.fillStyle = "#e0f2fe";
  ctx.arc(0, -bodyH - 14, 16, 0, Math.PI * 2);
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

  drawSky();
  drawRoad();

  const sorted = [...objects].sort((a, b) => b.z - a.z);
  for (const o of sorted) drawObject(o);
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
  if (e.code === "Space" || e.code === "ArrowUp") wantJump = true;
  if (e.code === "ArrowDown") crouchSignal = true;
  if (e.code === "ArrowLeft") laneSignal = Math.max(-1, laneSignal - 1);
  if (e.code === "ArrowRight") laneSignal = Math.min(1, laneSignal + 1);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowDown") crouchSignal = false;
});

resetGame();
requestAnimationFrame(() => frame(performance.now()));
