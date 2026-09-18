import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { EdgeTrigger, mid, lateralZone, kneeLift } from "../../assets/js/pose/gestures.js";
import { drawSkeleton } from "../../assets/js/pose/skeleton.js";

// ---------- DOM ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const video = document.getElementById("video");
const skeleton = document.getElementById("skeleton");
const camDot = document.getElementById("camDot");
const camLabel = document.getElementById("camLabel");
const scorePlayerEl = document.getElementById("scorePlayer");
const scoreAiEl = document.getElementById("scoreAi");

const overlayStart = document.getElementById("overlayStart");
const overlayOver = document.getElementById("overlayOver");
const btnStart = document.getElementById("btnStart");
const btnRetry = document.getElementById("btnRetry");
const overTitle = document.getElementById("overTitle");
const overScoreEl = document.getElementById("overScore");

const phaseBanner = document.getElementById("phaseBanner");
const phaseLabel = document.getElementById("phaseLabel");
const roundPill = document.getElementById("roundPill");

// ---------- Pose locale ----------
const kickTrigger = new EdgeTrigger(0.05, 0.12, 350);

let lane = 0;
let pendingKick = false;

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
  drawSkeleton(skeleton, lm, LM, { highlight: [LM.L_KNEE, LM.R_KNEE] });
  if (!lm) return;
  const hip = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  lane = lateralZone(hip.x, lane);
  if (kickTrigger.update(kneeLift(lm, LM), now)) pendingKick = true;
});

function consumeKickEvent() {
  if (pendingKick) { pendingKick = false; return true; }
  return false;
}

// Fallback clavier pour tester sans caméra / accessibilité.
window.addEventListener("keydown", (e) => {
  if (state !== "playing") return;
  if (e.code === "Space" || e.code === "KeyP" || e.code === "Enter") pendingKick = true;
  if (e.code === "ArrowLeft") lane = -1;
  if (e.code === "ArrowRight") lane = 1;
  if (e.code === "ArrowUp" || e.code === "ArrowDown") lane = 0;
});

// ---------- Match ----------
const REGULAR_ROUNDS = 5;
const AIM_TIMEOUT = 6;
const RESULT_LEN = 1.0;
const DEFEND_TELEGRAPH_BASE = 0.85;
const DEFEND_WINDOW = 0.6;
const ZONE_LABEL = { [-1]: "gauche", 0: "centre", 1: "droite" };

let state = "idle"; // idle | playing | over
let phase = "attackAim"; // attackAim | attackResult | defendTelegraph | defendWindow | defendResult
let phaseT = 0;
let round = 1;
let suddenDeath = false;
let playerGoals = 0, aiGoals = 0;

let shotZone = 0, keeperZone = 0, attackOutcome = null;
let aiShotZone = 0, defendOutcome = null;
let playerDiveCounts = { [-1]: 0, 0: 0, 1: 0 };

function resolveKeeperDive(currentRound, actualShotZone) {
  const acc = Math.min(0.62, 0.2 + currentRound * 0.07);
  if (Math.random() < acc) return actualShotZone;
  const others = [-1, 0, 1].filter((z) => z !== actualShotZone);
  return others[Math.floor(Math.random() * others.length)];
}

function pickAiShotZone() {
  if (Math.random() < 0.5) return [-1, 0, 1][Math.floor(Math.random() * 3)];
  const entries = Object.entries(playerDiveCounts).sort((a, b) => a[1] - b[1]);
  return Number(entries[0][0]);
}

function startRound() {
  phase = "attackAim";
  phaseT = 0;
  attackOutcome = null;
  defendOutcome = null;
  renderRoundPill();
}

function renderRoundPill() {
  roundPill.innerHTML = "";
  const total = Math.max(REGULAR_ROUNDS, round);
  for (let i = 1; i <= total; i++) {
    const dot = document.createElement("span");
    if (i < round) dot.className = "done";
    else if (i === round) dot.className = "active";
    roundPill.appendChild(dot);
  }
}

function checkMatchEnd() {
  const inRegulation = round < REGULAR_ROUNDS && !suddenDeath;
  if (inRegulation) return false;
  if (playerGoals !== aiGoals) { endMatch(); return true; }
  suddenDeath = true;
  return false;
}

function updateMatch(dt) {
  phaseT += dt;

  if (phase === "attackAim") {
    phaseLabel.textContent = `⚽ Visez (zone : ${ZONE_LABEL[lane]}) puis levez le genou pour tirer !`;
    if (consumeKickEvent() || phaseT >= AIM_TIMEOUT) {
      shotZone = lane;
      keeperZone = resolveKeeperDive(round, shotZone);
      attackOutcome = keeperZone === shotZone ? "save" : "goal";
      if (attackOutcome === "goal") { playerGoals++; scorePlayerEl.textContent = playerGoals; }
      phase = "attackResult"; phaseT = 0;
    }
    return;
  }

  if (phase === "attackResult") {
    phaseLabel.textContent = attackOutcome === "goal" ? "⚽ BUT !" : "🧤 ARRÊTÉ par le gardien !";
    if (phaseT >= RESULT_LEN) { phase = "defendTelegraph"; phaseT = 0; }
    return;
  }

  if (phase === "defendTelegraph") {
    phaseLabel.textContent = "🧤 En place… l'IA s'apprête à tirer !";
    const len = Math.max(0.5, DEFEND_TELEGRAPH_BASE - (round - 1) * 0.05);
    if (phaseT >= len) {
      aiShotZone = pickAiShotZone();
      phase = "defendWindow"; phaseT = 0;
    }
    return;
  }

  if (phase === "defendWindow") {
    phaseLabel.textContent = "🧤 PLONGEZ DU BON CÔTÉ !";
    if (lane === aiShotZone) {
      defendOutcome = "save";
      playerDiveCounts[lane]++;
      phase = "defendResult"; phaseT = 0;
    } else if (phaseT >= DEFEND_WINDOW) {
      defendOutcome = "goal";
      aiGoals++; scoreAiEl.textContent = aiGoals;
      playerDiveCounts[lane]++;
      phase = "defendResult"; phaseT = 0;
    }
    return;
  }

  if (phase === "defendResult") {
    phaseLabel.textContent = defendOutcome === "save" ? "🧤 ARRÊTÉ !" : "⚽ But de l'IA…";
    if (phaseT >= RESULT_LEN) {
      if (checkMatchEnd()) return;
      round++;
      startRound();
    }
  }
}

function startMatch() {
  state = "playing";
  overlayStart.style.display = "none";
  overlayOver.style.display = "none";
  phaseBanner.style.display = "block";
  round = 1;
  suddenDeath = false;
  playerGoals = 0; aiGoals = 0;
  scorePlayerEl.textContent = "0";
  scoreAiEl.textContent = "0";
  playerDiveCounts = { [-1]: 0, 0: 0, 1: 0 };
  startRound();
}

function endMatch() {
  state = "over";
  phaseBanner.style.display = "none";
  let outcome;
  if (playerGoals > aiGoals) outcome = "🏆 Victoire !";
  else if (playerGoals < aiGoals) outcome = "💥 Défaite…";
  else outcome = "🤝 Égalité !"; // ne devrait pas arriver (les tirs au but supplémentaires tranchent), gardé par sécurité
  overTitle.textContent = outcome;
  overScoreEl.innerHTML = `Score final : <b>${playerGoals}</b> — <b>${aiGoals}</b>${suddenDeath ? " (tirs au but supplémentaires)" : ""}`;
  overlayOver.style.display = "flex";
}

btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  btnStart.textContent = "Activation…";
  try {
    await pose.start();
    startMatch();
  } catch (e) {
    btnStart.disabled = false;
    btnStart.textContent = "Réessayer";
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
});

btnRetry.addEventListener("click", startMatch);

// ---------- Rendu ----------
function drawPitch() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#102818");
  g.addColorStop(1, "#05060c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let x = 80; x <= W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
}

function zoneX(zone, centerX, spread) {
  return centerX + zone * spread;
}

function drawGoal(centerX, y, width, height, activeZone, keeperAt) {
  const zoneW = width / 3;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 4;
  ctx.strokeRect(centerX - width / 2, y, width, height);
  for (const z of [-1, 0, 1]) {
    const zx = centerX - width / 2 + (z + 1) * zoneW;
    ctx.fillStyle = z === activeZone ? "rgba(125,211,252,0.28)" : "rgba(255,255,255,0.04)";
    ctx.fillRect(zx, y, zoneW, height);
  }
  if (keeperAt != null) {
    drawKeeper(centerX + keeperAt * (width / 3), y + height * 0.55, "#fb923c");
  }
}

function drawKeeper(x, y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.moveTo(x, y - 34); ctx.lineTo(x, y + 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 30, y - 20); ctx.lineTo(x, y - 6); ctx.lineTo(x + 30, y - 20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 14, y + 20); ctx.lineTo(x - 18, y + 50); ctx.moveTo(x + 14, y + 20); ctx.lineTo(x + 18, y + 50); ctx.stroke();
  ctx.beginPath(); ctx.fillStyle = color; ctx.arc(x, y - 46, 16, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}

function drawBall(x, y, r) {
  ctx.beginPath();
  ctx.fillStyle = "#f5f7ff";
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawPlayerMarker(x, y, color) {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// Les ancres verticales restent volontairement resserrées (~0.2H à ~0.7H) :
// le conteneur `.stage` impose un aspect-ratio 4/5 (portrait) au canvas 960×600
// (16:10), donc tout composé du haut (0.1H) au bas (0.9H) s'étire en un grand
// vide sur un écran de téléphone. Les autres jeux (combat, rooms) restent déjà
// dans cette plage centrale — on s'y aligne ici aussi.
function drawAttackScene() {
  const goalCx = W / 2, goalY = H * 0.24, goalW = 380, goalH = 120;
  const keeperAt = phase === "attackResult" || phase === "defendTelegraph" || phase === "defendWindow" || phase === "defendResult" ? keeperZone : null;
  drawGoal(goalCx, goalY, goalW, goalH, phase === "attackAim" ? lane : shotZone, keeperAt);

  const baseX = W / 2, baseY = H * 0.68;
  drawPlayerMarker(zoneX(lane, baseX, 140), baseY, "#7dd3fc");

  let ballX = zoneX(phase === "attackAim" ? lane : shotZone, baseX, 140), ballY = baseY - 30;
  if (phase === "attackResult") {
    const t = Math.min(1, phaseT / RESULT_LEN);
    ballX = baseX + (zoneX(shotZone, goalCx, goalW / 3) - baseX) * t;
    ballY = baseY - 30 + (goalY + goalH * 0.6 - (baseY - 30)) * t;
  }
  drawBall(ballX, ballY, 12);
}

function drawDefendScene() {
  const goalCx = W / 2, goalY = H * 0.5, goalW = 460, goalH = 150;
  const ballStartY = H * 0.22;
  drawGoal(goalCx, goalY, goalW, goalH, phase === "defendWindow" || phase === "defendResult" ? aiShotZone : null, null);
  drawPlayerMarker(zoneX(lane, goalCx, goalW / 3), goalY + goalH * 0.55, "#7dd3fc");

  if (phase === "defendTelegraph") {
    drawBall(W / 2, ballStartY, 8);
  } else if (phase === "defendWindow" || phase === "defendResult") {
    const elapsed = phase === "defendWindow" ? phaseT : DEFEND_WINDOW;
    const t = Math.min(1, elapsed / DEFEND_WINDOW);
    const bx = W / 2 + zoneX(aiShotZone, 0, goalW / 3) * t;
    const by = ballStartY + (goalY + goalH * 0.55 - ballStartY) * t;
    drawBall(bx, by, 8 + t * 8);
  }
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.05, (now - prevT) / 1000);

  if (state === "playing") updateMatch(dt);

  drawPitch();
  if (state === "playing" || state === "over") {
    if (phase === "attackAim" || phase === "attackResult") drawAttackScene();
    else drawDefendScene();
  }

  requestAnimationFrame(() => frame(now));
}

requestAnimationFrame(() => frame(performance.now()));
