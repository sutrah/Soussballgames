import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { EdgeTrigger, Baseline } from "../../assets/js/pose/gestures.js";
import { drawSkeleton } from "../../assets/js/pose/skeleton.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const video = document.getElementById("video");
const skeleton = document.getElementById("skeleton");
const camDot = document.getElementById("camDot");
const camLabel = document.getElementById("camLabel");
const scoreVal = document.getElementById("scoreVal");
const comboVal = document.getElementById("comboVal");
const overlayStart = document.getElementById("overlayStart");
const overlayOver = document.getElementById("overlayOver");
const finalScore = document.getElementById("finalScore");
const finalCombo = document.getElementById("finalCombo");
const bestScoreEl = document.getElementById("bestScore");
const btnStart = document.getElementById("btnStart");
const btnRetry = document.getElementById("btnRetry");

const BEST_KEY = "rhythm-best";
let best = Number(localStorage.getItem(BEST_KEY) || 0);
bestScoreEl.textContent = best;

// ---------- Détection des tapes de pied ----------
const footBaseline = { left: new Baseline(0.03), right: new Baseline(0.03) };
const footTrigger = { left: new EdgeTrigger(0.015, 0.04, 160), right: new EdgeTrigger(0.015, 0.04, 160) };
let tapQueue = []; // {lane:'left'|'right', t}

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

pose.onFrame((lm, now) => {
  drawSkeleton(skeleton, lm, LM, { highlight: [LM.L_ANKLE, LM.R_ANKLE] });
  if (!lm) return;

  for (const [side, idx] of [["left", LM.L_ANKLE], ["right", LM.R_ANKLE]]) {
    const y = lm[idx].y;
    footBaseline[side].update(y);
    const lift = footBaseline[side].value - y;
    if (footTrigger[side].update(lift)) tapQueue.push({ lane: side, t: now });
  }
});

// ---------- Chart rythmique ----------
const BPM = 108;
const BEAT = 60 / BPM;
const TRAVEL_TIME = 1.9; // secondes du haut à la ligne de frappe
const TOP_Y = 60;
const HIT_Y = H * 0.82;
const DURATION = 62; // secondes de partie

const PERFECT_WINDOW = 0.09;
const GOOD_WINDOW = 0.2;
const LANE_X = { left: W * 0.32, right: W * 0.68 };
const LANE_COLOR = { left: "#22d3ee", right: "#f472b6" };

let state = "idle";
let clockStart = 0;
let notes = [];
let nextSpawnBeat = 0;
let score = 0, combo = 0, maxCombo = 0;
let popups = [];
let hitFlash = { left: 0, right: 0 };

function resetGame() {
  notes = [];
  nextSpawnBeat = 2;
  score = 0; combo = 0; maxCombo = 0;
  popups = [];
  tapQueue = [];
  scoreVal.textContent = "0";
  comboVal.textContent = "0";
  clockStart = performance.now();
}

function generateUpTo(beatNow) {
  while (nextSpawnBeat < beatNow + 8) {
    const beat = nextSpawnBeat;
    const timeSec = beat * BEAT;
    if (timeSec < DURATION - TRAVEL_TIME - 1) {
      const roll = Math.random();
      const difficultyBonus = Math.min(0.35, timeSec / DURATION * 0.35);
      if (roll < 0.08 + difficultyBonus) {
        notes.push(mkNote("left", beat), mkNote("right", beat));
      } else if (roll < 0.54) {
        notes.push(mkNote("left", beat));
      } else {
        notes.push(mkNote("right", beat));
      }
    }
    nextSpawnBeat += Math.random() < 0.25 + Math.min(0.3, nextSpawnBeat * 0.002) ? 0.5 : 1;
  }
}

function mkNote(lane, beat) {
  const hitTime = beat * BEAT;
  return { lane, hitTime, spawnTime: hitTime - TRAVEL_TIME, hit: false, missed: false };
}

function popup(lane, text, color) {
  popups.push({ x: LANE_X[lane], text, color, age: 0 });
}

function judgeTap(tap) {
  let bestNote = null, bestDiff = Infinity;
  for (const n of notes) {
    if (n.lane !== tap.lane || n.hit || n.missed) continue;
    const diff = Math.abs((tap.t - clockStart) / 1000 - n.hitTime);
    if (diff < bestDiff) { bestDiff = diff; bestNote = n; }
  }
  if (bestNote && bestDiff <= GOOD_WINDOW) {
    bestNote.hit = true;
    const perfect = bestDiff <= PERFECT_WINDOW;
    combo++;
    maxCombo = Math.max(maxCombo, combo);
    const mult = 1 + Math.floor(combo / 10) * 0.5;
    score += Math.round((perfect ? 100 : 50) * mult);
    popup(tap.lane, perfect ? "Parfait !" : "Bien", perfect ? "#34d399" : "#7dd3fc");
    hitFlash[tap.lane] = 1;
    scoreVal.textContent = Math.floor(score);
    comboVal.textContent = combo;
  }
}

function update(dt, nowSec) {
  const beatNow = nowSec / BEAT;
  generateUpTo(beatNow);

  while (tapQueue.length) judgeTap(tapQueue.shift());

  for (const n of notes) {
    if (!n.hit && !n.missed && nowSec - n.hitTime > GOOD_WINDOW) {
      n.missed = true;
      combo = 0;
      comboVal.textContent = "0";
      popup(n.lane, "Raté", "#fb7185");
    }
  }
  notes = notes.filter((n) => nowSec - n.hitTime < 1.2);

  for (const p of popups) p.age += dt;
  popups = popups.filter((p) => p.age < 0.7);

  for (const side of ["left", "right"]) hitFlash[side] = Math.max(0, hitFlash[side] - dt * 3);

  if (nowSec >= DURATION) endGame();
}

// ---------- Rendu ----------
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0c0a1e");
  g.addColorStop(1, "#05060c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  for (const lane of ["left", "right"]) {
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.fillRect(LANE_X[lane] - 90, 0, 180, H);
  }
}

function drawHitLine() {
  for (const lane of ["left", "right"]) {
    const flash = hitFlash[lane];
    ctx.save();
    ctx.shadowColor = LANE_COLOR[lane];
    ctx.shadowBlur = 10 + flash * 30;
    ctx.strokeStyle = LANE_COLOR[lane];
    ctx.globalAlpha = 0.55 + flash * 0.45;
    ctx.lineWidth = 4 + flash * 4;
    ctx.beginPath();
    ctx.arc(LANE_X[lane], HIT_Y, 46 + flash * 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawNote(n, nowSec) {
  if (n.hit) return;
  const progress = (nowSec - n.spawnTime) / TRAVEL_TIME;
  const y = TOP_Y + progress * (HIT_Y - TOP_Y);
  if (y < -30 || y > H + 30) return;
  const x = LANE_X[n.lane];
  ctx.save();
  ctx.shadowColor = LANE_COLOR[n.lane];
  ctx.shadowBlur = n.missed ? 0 : 14;
  ctx.fillStyle = n.missed ? "rgba(255,255,255,0.15)" : LANE_COLOR[n.lane];
  roundRect(ctx, x - 44, y - 12, 88, 24, 12);
  ctx.fill();
  ctx.restore();
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

function drawPopups() {
  ctx.textAlign = "center";
  for (const p of popups) {
    const a = 1 - p.age / 0.7;
    ctx.globalAlpha = Math.max(0, a);
    ctx.fillStyle = p.color;
    ctx.font = "700 22px Inter, sans-serif";
    ctx.fillText(p.text, p.x, HIT_Y - 70 - p.age * 40);
  }
  ctx.globalAlpha = 1;
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.033, (now - prevT) / 1000);

  drawBackground();
  drawHitLine();

  if (state === "playing") {
    const nowSec = (now - clockStart) / 1000;
    update(dt, nowSec);
    for (const n of notes) drawNote(n, nowSec);
  }
  drawPopups();

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
  finalCombo.textContent = maxCombo;
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
  if (e.code === "ArrowLeft" || e.code === "KeyA") tapQueue.push({ lane: "left", t: performance.now() });
  if (e.code === "ArrowRight" || e.code === "KeyD") tapQueue.push({ lane: "right", t: performance.now() });
});

resetGame();
state = "idle";
requestAnimationFrame(() => frame(performance.now()));
