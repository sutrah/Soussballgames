import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { drawSkeleton } from "../../assets/js/pose/skeleton.js";

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

const BEST_KEY = "climb-best";
let best = Number(localStorage.getItem(BEST_KEY) || 0);
bestScoreEl.textContent = best;

// ---------- Détection des mains ----------
let wristScreen = { left: null, right: null }; // positions écran {x,y} ou null si non détecté

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
  drawSkeleton(skeleton, lm, LM, { highlight: [LM.L_WRIST, LM.R_WRIST] });
  if (!lm) { wristScreen = { left: null, right: null }; return; }
  wristScreen = {
    left: { x: lm[LM.L_WRIST].x * W, y: lm[LM.L_WRIST].y * H },
    right: { x: lm[LM.R_WRIST].x * W, y: lm[LM.R_WRIST].y * H },
  };
});

// ---------- Monde d'escalade ----------
const BASE_SCREEN_Y = H * 0.56;
const GRAB_RADIUS = 60;
const MAX_REACH = 240;
const SLOW_FALL_RATE = 35;
const TARGET_HEIGHT = 3400;
const PX_PER_METER = 90;

let state = "idle";
let climbProgress = 0;
let holds = [];
let nextHoldY = 0;
let lastSide = 1;
let grip = { left: null, right: null }; // référence vers un hold ou null
let particles = [];

function resetGame() {
  climbProgress = 0;
  holds = [];
  nextHoldY = 260;
  lastSide = 1;
  grip = { left: null, right: null };
  particles = [];
  scoreVal.textContent = "0";
  generateHoldsAhead();
}

function generateHoldsAhead() {
  while (nextHoldY < climbProgress + H * 1.6) {
    const flip = Math.random() < 0.72 ? -lastSide : lastSide;
    lastSide = flip;
    const x = flip * (80 + Math.random() * 150);
    holds.push({ worldY: nextHoldY, x, id: Math.random(), grabbedBy: null });
    nextHoldY += 150 + Math.random() * 70;
  }
}

function screenYFor(worldY) { return BASE_SCREEN_Y - (worldY - climbProgress); }

function tryGrab(side) {
  const hand = wristScreen[side];
  if (!hand || grip[side]) return;
  let closest = null, bestDist = Infinity;
  for (const h of holds) {
    if (h.grabbedBy) continue;
    const sy = screenYFor(h.worldY);
    const sx = W / 2 + h.x;
    const d = Math.hypot(hand.x - sx, hand.y - sy);
    if (d < GRAB_RADIUS && d < bestDist) { bestDist = d; closest = h; }
  }
  if (closest) { closest.grabbedBy = side; grip[side] = closest; }
}

function releaseIfOverextended(side) {
  const h = grip[side];
  const hand = wristScreen[side];
  if (!h || !hand) return;
  const sy = screenYFor(h.worldY);
  const sx = W / 2 + h.x;
  if (Math.hypot(hand.x - sx, hand.y - sy) > MAX_REACH) {
    h.grabbedBy = null;
    grip[side] = null;
  }
}

function update(dt) {
  for (const side of ["left", "right"]) {
    if (!wristScreen[side]) { if (grip[side]) { grip[side].grabbedBy = null; grip[side] = null; } continue; }
    tryGrab(side);
    releaseIfOverextended(side);
  }

  const active = ["left", "right"].filter((s) => grip[s] && wristScreen[s]);
  if (active.length > 0) {
    let sum = 0;
    for (const s of active) {
      const h = grip[s];
      sum += (wristScreen[s].y - BASE_SCREEN_Y + h.worldY);
    }
    climbProgress = sum / active.length;
  } else {
    climbProgress = Math.max(0, climbProgress - SLOW_FALL_RATE * dt);
  }

  generateHoldsAhead();
  holds = holds.filter((h) => h.worldY > climbProgress - 400);

  if (Math.random() < 0.5) {
    for (const s of active) {
      particles.push({ x: W / 2 + grip[s].x + (Math.random() - 0.5) * 10, y: screenYFor(grip[s].worldY), age: 0, life: 0.4 });
    }
  }
  for (const p of particles) p.age += dt;
  particles = particles.filter((p) => p.age < p.life);

  scoreVal.textContent = Math.max(0, Math.floor(climbProgress / PX_PER_METER));

  if (climbProgress >= TARGET_HEIGHT) endGame();
}

// ---------- Rendu ----------
function drawWall() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1a1425");
  g.addColorStop(1, "#0a0712");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  const offset = climbProgress % 80;
  for (let y = -offset; y < H; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y + 40);
    ctx.stroke();
  }
}

function drawHold(h) {
  const sy = screenYFor(h.worldY);
  if (sy < -40 || sy > H + 40) return;
  const sx = W / 2 + h.x;
  ctx.save();
  const color = h.grabbedBy ? "#34d399" : "#fbbf24";
  ctx.shadowColor = color;
  ctx.shadowBlur = h.grabbedBy ? 20 : 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, 26, 16, Math.sin(h.id * 10) * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = 1 - p.age / p.life;
    ctx.fillStyle = "#7dd3fc";
    ctx.beginPath();
    ctx.arc(p.x, p.y + p.age * 40, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawClimber() {
  const shoulderY = BASE_SCREEN_Y - 40;
  const shoulders = { left: { x: W / 2 - 26, y: shoulderY }, right: { x: W / 2 + 26, y: shoulderY } };

  ctx.fillStyle = "#e0f2fe";
  ctx.shadowColor = "#7dd3fc";
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(W / 2, shoulderY - 34, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(W / 2 - 20, shoulderY - 16, 40, 60, 14) : ctx.rect(W / 2 - 20, shoulderY - 16, 40, 60);
  ctx.fill();
  ctx.shadowBlur = 0;

  for (const side of ["left", "right"]) {
    const hand = wristScreen[side] || { x: shoulders[side].x, y: shoulderY + 40 };
    const sh = shoulders[side];
    ctx.strokeStyle = grip[side] ? "#34d399" : "rgba(224,242,254,0.7)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sh.x, sh.y);
    ctx.lineTo(hand.x, hand.y);
    ctx.stroke();

    ctx.fillStyle = grip[side] ? "#34d399" : "#e0f2fe";
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeightGuide() {
  const remaining = Math.max(0, TARGET_HEIGHT - climbProgress);
  const pct = 1 - remaining / TARGET_HEIGHT;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(W - 22, 20, 8, H - 40);
  ctx.fillStyle = "#7dd3fc";
  const barH = (H - 40) * pct;
  ctx.fillRect(W - 22, 20 + (H - 40 - barH), 8, barH);
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.033, (now - prevT) / 1000);

  if (state === "playing") update(dt);

  drawWall();
  const sorted = [...holds].sort((a, b) => a.worldY - b.worldY);
  for (const h of sorted) drawHold(h);
  drawParticles();
  drawClimber();
  drawHeightGuide();

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
  const finalM = Math.floor(climbProgress / PX_PER_METER);
  if (finalM > best) { best = finalM; localStorage.setItem(BEST_KEY, String(best)); }
  finalScore.textContent = finalM;
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

// Fallback souris pour tester sans caméra / accessibilité : la main gauche
// suit le curseur, la main droite est fixée à une position symétrique.
canvas.addEventListener("mousemove", (e) => {
  if (state !== "playing") return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * W;
  const y = ((e.clientY - rect.top) / rect.height) * H;
  wristScreen.left = { x, y };
  wristScreen.right = { x: W - x, y };
});

resetGame();
state = "idle";
requestAnimationFrame(() => frame(performance.now()));
