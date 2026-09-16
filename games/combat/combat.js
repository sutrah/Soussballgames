import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { Baseline, EdgeTrigger, mid, dist, lateralZone, elbowExtension } from "../../assets/js/pose/gestures.js";
import { drawSkeleton } from "../../assets/js/pose/skeleton.js";
import { PeerRoom } from "../../assets/js/net/PeerRoom.js";

// ---------- DOM ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const video = document.getElementById("video");
const skeleton = document.getElementById("skeleton");
const camDot = document.getElementById("camDot");
const camLabel = document.getElementById("camLabel");
const scoreVal = document.getElementById("scoreVal");
const comboVal = document.getElementById("comboVal");

const screens = {
  mode: document.getElementById("screenMode"),
  lobby: document.getElementById("screenLobby"),
  waiting: document.getElementById("screenWaiting"),
  connecting: document.getElementById("screenConnecting"),
  bonus: document.getElementById("screenBonus"),
  cam: document.getElementById("screenCam"),
  over: document.getElementById("overlayOver"),
  error: document.getElementById("screenError"),
};
function showScreen(name) {
  for (const k in screens) screens[k].style.display = k === name ? "flex" : "none";
}

const btnModeAi = document.getElementById("btnModeAi");
const btnModeOnline = document.getElementById("btnModeOnline");
const btnHost = document.getElementById("btnHost");
const btnJoin = document.getElementById("btnJoin");
const joinCodeInput = document.getElementById("joinCode");
const roomCodeEl = document.getElementById("roomCode");
const errorLabel = document.getElementById("errorLabel");

const bonusGrid = document.getElementById("bonusGrid");
const bonusCount = document.getElementById("bonusCount");
const btnBonusReady = document.getElementById("btnBonusReady");
const bonusWaitLabel = document.getElementById("bonusWaitLabel");

const btnCam = document.getElementById("btnCam");
const peerCamStatus = document.getElementById("peerCamStatus");

const fightHud = document.getElementById("fightHud");
const promptLabel = document.getElementById("promptLabel");
const timeLeftEl = document.getElementById("timeLeft");
const vsRow = document.getElementById("vsRow");
const vsMeLabel = document.getElementById("vsMeLabel");
const vsOppLabel = document.getElementById("vsOppLabel");
const vsMeFill = document.getElementById("vsMeFill");
const vsOppFill = document.getElementById("vsOppFill");

const overTitle = document.getElementById("overTitle");
const overScoreEl = document.getElementById("overScore");
const btnRetry = document.getElementById("btnRetry");

// ---------- Bonus (3 parmi 5) ----------
const BONUSES = [
  { key: "punch", icon: "👊", name: "Punch", desc: "Coup puissant. Réussite : +10. Échec : petite pénalité." },
  { key: "dodge", icon: "🌀", name: "Shadow Dodge", desc: "Esquivez au bon moment. Esquive réussie : +10, parfaite : +15." },
  { key: "combo", icon: "🔥", name: "Combo Master", desc: "Enchaînez les coups sans interruption. 3 coups : +5, 5 : +10, 10 : +20." },
  { key: "counter", icon: "⚡", name: "Perfect Counter", desc: "Frappez juste après une esquive. Contre réussi : +15, parfait : +20." },
  { key: "air", icon: "🕊️", name: "Air Ace", desc: "Sautez puis frappez en l'air. Réussie : +10 à +15, bonus de précision." },
];

let bonuses = new Set();

function renderBonusGrid() {
  bonusGrid.innerHTML = "";
  for (const b of BONUSES) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "bonus-card" + (bonuses.has(b.key) ? " selected" : "");
    card.innerHTML = `<div class="bonus-name">${b.icon} ${b.name}</div><div class="bonus-desc">${b.desc}</div>`;
    card.addEventListener("click", () => toggleBonus(b.key));
    bonusGrid.appendChild(card);
  }
  bonusCount.textContent = `${bonuses.size} / 3 sélectionnés`;
  btnBonusReady.disabled = bonuses.size !== 3;
}

function toggleBonus(key) {
  if (bonuses.has(key)) bonuses.delete(key);
  else if (bonuses.size < 3) bonuses.add(key);
  renderBonusGrid();
}

// ---------- Mode & réseau ----------
let mode = null; // 'ai' | 'online'
let role = null; // 'host' | 'guest' (online)
const room = new PeerRoom();

let localBonusReady = false, oppBonusReady = false;
let localCamReady = false, oppCamReady = false;

btnModeAi.addEventListener("click", () => {
  mode = "ai";
  showScreen("bonus");
  renderBonusGrid();
});

btnModeOnline.addEventListener("click", () => {
  mode = "online";
  showScreen("lobby");
});

btnHost.addEventListener("click", async () => {
  btnHost.disabled = true;
  try {
    role = "host";
    await room.host(2);
  } catch (e) {
    errorLabel.textContent = "Impossible de créer le duel : " + e.message;
    showScreen("error");
  }
});

btnJoin.addEventListener("click", async () => {
  const code = joinCodeInput.value.trim();
  if (!code) return;
  btnJoin.disabled = true;
  showScreen("connecting");
  try {
    role = "guest";
    await room.join(code);
  } catch (e) {
    errorLabel.textContent = "Duel introuvable ou fermé. Vérifiez le code.";
    showScreen("error");
  }
});

room.onStatus((status, detail) => {
  if (status === "waiting-peer") { roomCodeEl.textContent = detail; showScreen("waiting"); }
  if (status === "peer-joined" && role === "host") { showScreen("bonus"); renderBonusGrid(); }
  if (status === "connected" && role === "guest") { showScreen("bonus"); renderBonusGrid(); }
  if (status === "disconnected") {
    errorLabel.textContent = "L'adversaire a quitté le duel.";
    showScreen("error");
  }
  if (status === "error") {
    errorLabel.textContent = "Erreur de connexion (" + (detail?.type || detail?.message || "inconnue") + "). Réessayez avec un nouveau code.";
    showScreen("error");
  }
});

room.onMessage((msg) => {
  if (msg.type === "bonusReady") { oppBonusReady = true; maybeAdvancePastBonus(); }
  else if (msg.type === "camReady") { oppCamReady = true; if (role === "host") maybeHostStart(); }
  else if (msg.type === "matchStart") { startMatch(); }
  else if (msg.type === "scoreUpdate") { oppScore = msg.score; updateVsBars(); }
  else if (msg.type === "matchEnd") { oppFinalScore = msg.score; finalizeIfBothDone(); }
});

function maybeAdvancePastBonus() {
  if (localBonusReady && oppBonusReady) showScreen("cam");
}

btnBonusReady.addEventListener("click", () => {
  btnBonusReady.disabled = true;
  bonusGrid.querySelectorAll("button").forEach((b) => (b.disabled = true));
  localBonusReady = true;
  if (mode === "ai") { showScreen("cam"); return; }
  bonusWaitLabel.style.display = "block";
  room.send({ type: "bonusReady" });
  maybeAdvancePastBonus();
});

function maybeHostStart() {
  if (localCamReady && oppCamReady) { room.send({ type: "matchStart" }); startMatch(); }
}

btnCam.addEventListener("click", async () => {
  btnCam.disabled = true;
  btnCam.textContent = "Activation…";
  try {
    await pose.start();
    localCamReady = true;
    if (mode === "ai") { startMatch(); return; }
    peerCamStatus.style.display = "block";
    room.send({ type: "camReady" });
    if (role === "host") maybeHostStart();
  } catch (e) {
    btnCam.disabled = false;
    btnCam.textContent = "Réessayer";
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
});

// ---------- Pose locale ----------
const REDUCED = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE];

const hipBaseline = new Baseline(0.02);
const FREEZE_GESTURE = 0.06;
const jumpTrigger = new EdgeTrigger(0.03, 0.075, 260);
const punchTrigger = { left: new EdgeTrigger(0.72, 0.88, 220), right: new EdgeTrigger(0.72, 0.88, 220) };

let lane = 0;
let crouchSignal = false;
let localFigure = null;
let pendingPunch = false;
let pendingJump = false;

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
  drawSkeleton(skeleton, lm, LM, { highlight: [LM.L_WRIST, LM.R_WRIST] });
  if (!lm) { localFigure = null; return; }
  localFigure = REDUCED.map((i) => ({ x: lm[i].x, y: lm[i].y }));

  const hip = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  if (hipBaseline.value == null || Math.abs(hip.y - hipBaseline.value) < FREEZE_GESTURE) {
    hipBaseline.update(hip.y);
  }
  const rel = hip.y - (hipBaseline.value ?? hip.y);
  if (jumpTrigger.update(-rel, now)) pendingJump = true;
  crouchSignal = rel > 0.055;
  lane = lateralZone(hip.x, lane);

  // Un bras qui pend le long du corps (poignet sous la hanche) ne doit jamais
  // déclencher un coup : on ne nourrit le détecteur d'extension que si la
  // main est levée au moins à hauteur de hanche (position de garde plausible).
  const extL = lm[LM.L_WRIST].y < hip.y ? elbowExtension(lm, LM, "left") : 0;
  const extR = lm[LM.R_WRIST].y < hip.y ? elbowExtension(lm, LM, "right") : 0;
  if (punchTrigger.left.update(extL, now)) pendingPunch = true;
  if (punchTrigger.right.update(extR, now)) pendingPunch = true;
});

function consumePunchEvent() {
  if (pendingPunch) { pendingPunch = false; return true; }
  return false;
}
function consumeJumpEvent() {
  if (pendingJump) { pendingJump = false; return true; }
  return false;
}

// Fallback clavier pour tester sans caméra / accessibilité.
window.addEventListener("keydown", (e) => {
  if (!matchRunning) return;
  if (e.code === "Space" || e.code === "ArrowUp") pendingJump = true;
  if (e.code === "KeyP" || e.code === "Enter") pendingPunch = true;
  if (e.code === "ArrowDown") crouchSignal = true;
  if (e.code === "ArrowLeft") lane = -1;
  if (e.code === "ArrowRight") lane = 1;
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowDown") crouchSignal = false;
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") lane = 0;
});

// ---------- Combat ----------
const MATCH_DURATION = 60;
const AIR_FOLLOWUP = 0.55;
const COUNTER_LEN = 0.45;
const COOLDOWN = 0.45;
const BEST_KEY = "combat-best";
let best = Number(localStorage.getItem(BEST_KEY) || 0);

let matchRunning = false;
let matchElapsed = 0;
let score = 0;
let comboStreak = 0;
let airChainStreak = 0;
let oppScore = 0;
let myFinalScore = null, oppFinalScore = null;
let lastScoreSend = 0;

let currentPrompt = null;
let waitingCooldown = false;
let cooldownT = 0;

function enabledTypes() {
  const t = [];
  if (bonuses.has("punch") || bonuses.has("combo")) t.push("punch");
  if (bonuses.has("dodge") || bonuses.has("counter")) t.push("dodge");
  if (bonuses.has("air")) t.push("air");
  return t.length ? t : ["punch"];
}

function spawnPrompt() {
  const types = enabledTypes();
  const type = types[Math.floor(Math.random() * types.length)];
  const telegraphLen = Math.max(0.35, 0.75 - matchElapsed / 150);
  const windowLen = type === "punch" ? 0.55 : type === "dodge" ? 0.65 : 0.9;
  const dir = type === "dodge" ? [-1, 0, 1][Math.floor(Math.random() * 3)] : null;
  currentPrompt = { type, dir, phase: "telegraph", phaseT: 0, telegraphLen, windowLen, jumped: false, jumpAt: 0, counterLen: COUNTER_LEN };
}

function telegraphText(p) {
  if (p.type === "punch") return "⚠️ Préparez un coup…";
  if (p.type === "dodge") return p.dir === -1 ? "⚠️ Attaque à gauche…" : p.dir === 1 ? "⚠️ Attaque à droite…" : "⚠️ Attaque basse…";
  return "⚠️ Préparez un saut…";
}
function windowText(p) {
  if (p.type === "punch") return "👊 FRAPPEZ !";
  if (p.type === "dodge") return p.dir === -1 ? "🌀 ESQUIVEZ À GAUCHE !" : p.dir === 1 ? "🌀 ESQUIVEZ À DROITE !" : "🌀 ACCROUPISSEZ-VOUS !";
  return p.jumped ? "👊 FRAPPEZ EN L'AIR !" : "🦵 SAUTEZ !";
}

function checkWindowGesture(p) {
  if (p.type === "punch") return consumePunchEvent();
  if (p.type === "dodge") return p.dir === 0 ? crouchSignal : lane === p.dir;
  if (p.type === "air") {
    if (!p.jumped) {
      if (consumeJumpEvent()) { p.jumped = true; p.jumpAt = p.phaseT; }
      return false;
    }
    if (p.phaseT - p.jumpAt > AIR_FOLLOWUP) { p.jumped = false; return false; }
    return consumePunchEvent();
  }
  return false;
}

function addScore(n) {
  score = Math.max(0, score + n);
  scoreVal.textContent = score;
}
function bumpComboOnHit() {
  comboStreak++;
  comboVal.textContent = comboStreak;
  if (bonuses.has("combo")) {
    if (comboStreak === 3) addScore(5);
    else if (comboStreak === 5) addScore(10);
    else if (comboStreak === 10) addScore(20);
  }
}
function resetCombo() {
  comboStreak = 0;
  comboVal.textContent = comboStreak;
}

function resolvePromptSuccess(p, tAt) {
  const perfect = tAt <= p.windowLen * 0.4;
  if (p.type === "punch") {
    if (bonuses.has("punch")) addScore(10);
    bumpComboOnHit();
    finishPrompt();
  } else if (p.type === "dodge") {
    if (bonuses.has("dodge")) addScore(perfect ? 15 : 10);
    if (bonuses.has("counter")) { p.phase = "counter"; p.phaseT = 0; pendingPunch = false; return; }
    finishPrompt();
  } else if (p.type === "air") {
    airChainStreak++;
    let pts = airChainStreak >= 2 ? 15 : 10;
    if (tAt - p.jumpAt <= AIR_FOLLOWUP * 0.35) pts += 5; // bonus de précision
    if (bonuses.has("air")) addScore(pts);
    bumpComboOnHit();
    finishPrompt();
  }
}

function resolvePromptMiss(p) {
  if (p.type === "punch" && bonuses.has("punch")) addScore(-2);
  if (p.type === "air") airChainStreak = 0;
  resetCombo();
  finishPrompt();
}

function awardCounter(tAt) {
  const p = currentPrompt;
  const perfect = tAt <= p.counterLen * 0.4;
  if (bonuses.has("counter")) addScore(perfect ? 20 : 15);
  bumpComboOnHit();
}

function finishPrompt() {
  currentPrompt = null;
  waitingCooldown = true;
  cooldownT = 0;
}

function updateMatch(dt, now) {
  matchElapsed += dt;
  const remain = Math.max(0, MATCH_DURATION - matchElapsed);
  timeLeftEl.textContent = Math.ceil(remain);
  if (remain <= 0) { endMatch(); return; }

  if (mode === "online" && now - lastScoreSend > 400) {
    lastScoreSend = now;
    room.send({ type: "scoreUpdate", score });
  }

  if (waitingCooldown) {
    cooldownT += dt;
    promptLabel.textContent = "En garde…";
    if (cooldownT >= COOLDOWN) { waitingCooldown = false; spawnPrompt(); }
    return;
  }

  const p = currentPrompt;
  if (!p) return;
  p.phaseT += dt;

  if (p.phase === "telegraph") {
    promptLabel.textContent = telegraphText(p);
    if (p.phaseT >= p.telegraphLen) {
      p.phase = "window"; p.phaseT = 0;
      pendingPunch = false; pendingJump = false;
    }
    return;
  }

  if (p.phase === "window") {
    promptLabel.textContent = windowText(p);
    if (checkWindowGesture(p)) { resolvePromptSuccess(p, p.phaseT); return; }
    if (p.phaseT >= p.windowLen) resolvePromptMiss(p);
    return;
  }

  if (p.phase === "counter") {
    promptLabel.textContent = "⚡ CONTRE-ATTAQUE !";
    if (consumePunchEvent()) { awardCounter(p.phaseT); finishPrompt(); return; }
    if (p.phaseT >= p.counterLen) finishPrompt();
  }
}

function startMatch() {
  for (const k in screens) screens[k].style.display = "none";
  fightHud.style.display = "block";
  vsRow.style.display = mode === "online" ? "flex" : "none";
  matchRunning = true;
  matchElapsed = 0;
  score = 0; scoreVal.textContent = "0";
  comboStreak = 0; comboVal.textContent = "0";
  airChainStreak = 0;
  oppScore = 0; myFinalScore = null; oppFinalScore = null;
  currentPrompt = null; waitingCooldown = true; cooldownT = 0;
  lastScoreSend = 0;
  updateVsBars();
}

function updateVsBars() {
  const total = Math.max(1, score + oppScore);
  vsMeFill.style.width = (score / total * 100) + "%";
  vsOppFill.style.width = (oppScore / total * 100) + "%";
  vsMeLabel.textContent = `Vous ${score}`;
  vsOppLabel.textContent = `Adversaire ${oppScore}`;
}

function endMatch() {
  matchRunning = false;
  fightHud.style.display = "none";
  if (mode === "ai") {
    best = Math.max(best, score);
    localStorage.setItem(BEST_KEY, best);
    overTitle.textContent = "🥊 Combat terminé !";
    overScoreEl.innerHTML = `Score final : <b>${score}</b> — meilleur score : <b>${best}</b>`;
    showScreen("over");
  } else {
    myFinalScore = score;
    room.send({ type: "matchEnd", score });
    finalizeIfBothDone();
  }
}

function finalizeIfBothDone() {
  if (myFinalScore == null || oppFinalScore == null) return;
  let outcome;
  if (myFinalScore > oppFinalScore) outcome = "🏆 Victoire !";
  else if (myFinalScore < oppFinalScore) outcome = "💥 Défaite…";
  else outcome = "🤝 Égalité !";
  overTitle.textContent = outcome;
  overScoreEl.innerHTML = `Vous : <b>${myFinalScore}</b> — Adversaire : <b>${oppFinalScore}</b>`;
  showScreen("over");
}

btnRetry.addEventListener("click", () => {
  if (mode === "ai") { startMatch(); return; }
  location.reload();
});

// ---------- Rendu ----------
function buildFigure(points) {
  const [nose, lsh, rsh, lel, rel, lwr, rwr, lhip, rhip, lkn, rkn] = points;
  const shoulderMid = mid(lsh, rsh);
  const hipMid = mid(lhip, rhip);
  const torso = Math.max(0.06, dist(shoulderMid, hipMid));
  return { nose, lsh, rsh, lel, rel, lwr, rwr, lhip, rhip, lkn, rkn, shoulderMid, torso };
}

function drawFigure(fig, anchorX, anchorY, color, glow) {
  if (!fig) return;
  const built = buildFigure(fig);
  const scale = 130 / built.torso;
  const P = (p) => ({ x: anchorX + (p.x - built.shoulderMid.x) * scale, y: anchorY + (p.y - built.shoulderMid.y) * scale });
  const pairs = [
    ["lsh", "rsh"], ["lsh", "lhip"], ["rsh", "rhip"], ["lhip", "rhip"],
    ["lsh", "lel"], ["lel", "lwr"], ["rsh", "rel"], ["rel", "rwr"],
    ["lhip", "lkn"], ["rhip", "rkn"],
  ];
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = glow ? 22 : 10;
  for (const [a, b] of pairs) {
    const pa = P(built[a]), pb = P(built[b]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  const head = P(built.nose);
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(head.x, head.y - 6, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawOpponent(active) {
  const x = W * 0.74, y = H * 0.5;
  const pulse = active ? 0.7 + 0.3 * Math.sin(performance.now() / 120) : 1;
  ctx.save();
  ctx.strokeStyle = mode === "online" ? "#f472b6" : "#fb923c";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = active ? 26 * pulse : 8;
  ctx.beginPath(); ctx.moveTo(x, y - 60); ctx.lineTo(x, y + 50); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 40, y - 30); ctx.lineTo(x, y - 10); ctx.lineTo(x + 40, y - 30); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 22, y + 50); ctx.lineTo(x - 30, y + 110); ctx.moveTo(x + 22, y + 50); ctx.lineTo(x + 30, y + 110); ctx.stroke();
  ctx.beginPath(); ctx.fillStyle = ctx.strokeStyle; ctx.arc(x, y - 78, 22, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawBackdrop() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1a1030");
  g.addColorStop(1, "#05060c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, H * 0.82, W, H * 0.18);
}

function drawPromptExtras(p) {
  if (!p) return;
  if (p.type === "dodge") {
    const cx = W * 0.28;
    for (const l of [-1, 0, 1]) {
      const mx = cx + l * 70;
      ctx.fillStyle = l === p.dir ? "rgba(125,211,252,0.9)" : "rgba(255,255,255,0.15)";
      ctx.fillRect(mx - 24, H * 0.86, 48, 10);
    }
  } else if (p.type === "air" && p.phase === "window" && !p.jumped) {
    ctx.fillStyle = "rgba(251,191,36,0.9)";
    ctx.font = "700 28px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⬆️", W * 0.28, H * 0.28);
  }
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.05, (now - prevT) / 1000);

  if (matchRunning) updateMatch(dt, now);

  drawBackdrop();
  drawPromptExtras(currentPrompt);
  drawOpponent(!!(currentPrompt && currentPrompt.phase === "window"));
  drawFigure(localFigure, W * 0.28, H * 0.6, "#7dd3fc", !!(currentPrompt && currentPrompt.phase === "window"));

  requestAnimationFrame(() => frame(now));
}

requestAnimationFrame(() => frame(performance.now()));
