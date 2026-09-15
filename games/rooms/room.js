import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { Baseline, mid, dist, handsRaised, armsSpread, lateralZone } from "../../assets/js/pose/gestures.js";
import { PeerRoom } from "../../assets/js/net/PeerRoom.js";

// ---------- DOM ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

const video = document.getElementById("video");
const camDot = document.getElementById("camDot");
const camLabel = document.getElementById("camLabel");
const levelPill = document.getElementById("levelPill");

const screens = {
  lobby: document.getElementById("screenLobby"),
  waiting: document.getElementById("screenWaiting"),
  connecting: document.getElementById("screenConnecting"),
  cam: document.getElementById("screenCam"),
  win: document.getElementById("screenWin"),
  error: document.getElementById("screenError"),
};
function showScreen(name) {
  for (const k in screens) screens[k].style.display = k === name ? "flex" : "none";
}

const roomCodeEl = document.getElementById("roomCode");
const connectingLabel = document.getElementById("connectingLabel");
const btnHost = document.getElementById("btnHost");
const btnJoin = document.getElementById("btnJoin");
const joinCodeInput = document.getElementById("joinCode");
const btnCam = document.getElementById("btnCam");
const peerCamStatus = document.getElementById("peerCamStatus");
const errorLabel = document.getElementById("errorLabel");

const levelBanner = document.getElementById("levelBanner");
const levelTitle = document.getElementById("levelTitle");
const levelHint = document.getElementById("levelHint");
const levelProgress = document.getElementById("levelProgress");

// ---------- Réseau ----------
const room = new PeerRoom();
let role = null;
let localCamReady = false;
let remoteCamReady = false;

room.onStatus((status, detail) => {
  if (status === "waiting-peer") { roomCodeEl.textContent = detail; showScreen("waiting"); }
  if (status === "connecting-peer") connectingLabel.textContent = "Connexion à la room " + room.code + "…";
  if (status === "connected") showScreen("cam");
  if (status === "disconnected") {
    errorLabel.textContent = "L'autre joueur a quitté la room.";
    showScreen("error");
  }
  if (status === "error") {
    errorLabel.textContent = "Erreur de connexion (" + (detail?.type || detail?.message || "inconnue") + "). Réessayez avec un nouveau code.";
    showScreen("error");
  }
});

room.onMessage((msg) => {
  if (msg.type === "camReady") {
    remoteCamReady = true;
    maybeStart();
  } else if (msg.type === "pose") {
    remoteFigure = msg.lm;
    remoteG = msg.g;
  } else if (msg.type === "level") {
    // Le guest se contente de refléter l'état autoritaire envoyé par l'hôte.
    if (role === "guest") applyHostLevelState(msg);
  }
});

btnHost.addEventListener("click", async () => {
  btnHost.disabled = true;
  try {
    role = "host";
    await room.host();
  } catch (e) {
    errorLabel.textContent = "Impossible de créer la room : " + e.message;
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
    errorLabel.textContent = "Room introuvable ou fermée. Vérifiez le code.";
    showScreen("error");
  }
});

// ---------- Pose locale ----------
const REDUCED = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE];

const hipBaseline = new Baseline(0.02);
const FREEZE_GESTURE = 0.06;
let lane = 0;

let localFigure = null; // 11 points réduits {x,y}
let localG = { handsUp: false, spread: false, crouch: false, lane: 0 };
let remoteFigure = null;
let remoteG = { handsUp: false, spread: false, crouch: false, lane: 0 };

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

let lastSend = 0;
pose.onFrame((lm, now) => {
  if (!lm) { localFigure = null; return; }
  localFigure = REDUCED.map((i) => ({ x: lm[i].x, y: lm[i].y }));

  const hip = mid(lm[LM.L_HIP], lm[LM.R_HIP]);
  if (hipBaseline.value == null || Math.abs(hip.y - hipBaseline.value) < FREEZE_GESTURE) {
    hipBaseline.update(hip.y);
  }
  const rel = hip.y - (hipBaseline.value ?? hip.y);
  const raised = handsRaised(lm, LM);
  lane = lateralZone(hip.x, lane);

  localG = {
    handsUp: raised.left && raised.right,
    spread: armsSpread(lm, LM),
    crouch: rel > 0.055,
    lane,
  };

  if (now - lastSend > 80) {
    lastSend = now;
    room.send({ type: "pose", lm: localFigure, g: localG });
  }
});

btnCam.addEventListener("click", async () => {
  btnCam.disabled = true;
  btnCam.textContent = "Activation…";
  try {
    await pose.start();
    localCamReady = true;
    room.send({ type: "camReady" });
    peerCamStatus.textContent = remoteCamReady ? "L'autre joueur est prêt !" : "En attente de l'autre joueur…";
    maybeStart();
  } catch (e) {
    btnCam.disabled = false;
    btnCam.textContent = "Réessayer";
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
});

function maybeStart() {
  if (localCamReady && remoteCamReady && !gameStarted) startGame();
  if (remoteCamReady) peerCamStatus.textContent = localCamReady ? "L'autre joueur est prêt !" : peerCamStatus.textContent;
}

// ---------- Niveaux (logique autoritaire côté hôte) ----------
const LEVELS = [
  {
    key: "switches",
    title: "Niveau 1 — Interrupteurs miroir",
    hint: "Levez les deux mains, tous les deux en même temps.",
    hold: 1.6,
  },
  {
    key: "press",
    title: "Niveau 2 — Presser ensemble",
    hint: "Accroupissez-vous tous les deux, en même temps.",
    hold: 1.6,
  },
  {
    key: "mirror",
    title: "Niveau 3 — Position miroir",
    hint: "",
    rounds: 3,
    hold: 1.0,
  },
  {
    key: "bridge",
    title: "Niveau 4 — Pont suspendu",
    hint: "Écartez grand les bras tous les deux, et tenez.",
    hold: 3.0,
  },
  {
    key: "finale",
    title: "Niveau 5 — Finale",
    hint: "",
    rounds: 3,
    hold: 1.2,
  },
];

const LANE_LABEL = { [-1]: "Gauche", 0: "Centre", 1: "Droite" };
const COMBO_LABEL = { handsUp: "mains levées", crouch: "accroupi(e)", spread: "bras écartés" };

let gameStarted = false;
let level = { index: 0, progress: 0, round: null, roundTarget: null, roundProgress: 0 };

function matchesSpec(g, spec) {
  if (spec.startsWith("lane:")) return g.lane === Number(spec.split(":")[1]);
  return !!g[spec];
}

function specLabel(spec) {
  if (spec.startsWith("lane:")) return LANE_LABEL[Number(spec.split(":")[1])];
  return COMBO_LABEL[spec];
}

function randomLane() { return [-1, 0, 1][Math.floor(Math.random() * 3)]; }
const FINALE_POOL = ["handsUp", "crouch", "spread", "lane:-1", "lane:1"];

function newMirrorRound() {
  level.roundTarget = { a: randomLane(), b: randomLane() };
  level.roundProgress = 0;
}

function newFinaleRound() {
  const shuffled = [...FINALE_POOL].sort(() => Math.random() - 0.5);
  level.roundTarget = { a: shuffled[0], b: shuffled[1] };
  level.roundProgress = 0;
}

function initLevel(idx) {
  level.index = idx;
  level.progress = 0;
  level.round = 0;
  if (LEVELS[idx].key === "mirror") newMirrorRound();
  if (LEVELS[idx].key === "finale") newFinaleRound();
  broadcastLevel();
}

function updateLevelHost(dt) {
  const def = LEVELS[level.index];
  if (def.key === "switches") {
    const ok = localG.handsUp && remoteG.handsUp;
    level.progress = clamp01(level.progress + (ok ? dt / def.hold : -dt / (def.hold * 0.6)));
    if (level.progress >= 1) nextLevel();
  } else if (def.key === "press") {
    const ok = localG.crouch && remoteG.crouch;
    level.progress = clamp01(level.progress + (ok ? dt / def.hold : -dt / (def.hold * 0.6)));
    if (level.progress >= 1) nextLevel();
  } else if (def.key === "bridge") {
    const ok = localG.spread && remoteG.spread;
    level.progress = clamp01(level.progress + (ok ? dt / def.hold : -dt / (def.hold * 1.4)));
    if (level.progress >= 1) nextLevel();
  } else if (def.key === "mirror" || def.key === "finale") {
    const ok = def.key === "mirror"
      ? localG.lane === level.roundTarget.a && remoteG.lane === level.roundTarget.b
      : matchesSpec(localG, level.roundTarget.a) && matchesSpec(remoteG, level.roundTarget.b);
    level.roundProgress = clamp01(level.roundProgress + (ok ? dt / def.hold : -dt / (def.hold * 0.7)));
    if (level.roundProgress >= 1) {
      level.round++;
      if (level.round >= def.rounds) { nextLevel(); }
      else { def.key === "mirror" ? newMirrorRound() : newFinaleRound(); }
    }
    level.progress = clamp01((level.round + level.roundProgress) / def.rounds);
  }
  broadcastLevel();
}

function nextLevel() {
  if (level.index >= LEVELS.length - 1) {
    room.send({ type: "level", win: true });
    finishGame();
  } else {
    initLevel(level.index + 1);
  }
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function broadcastLevel() {
  room.send({
    type: "level",
    index: level.index,
    progress: level.progress,
    roundTarget: level.roundTarget,
  });
  renderHud();
}

function applyHostLevelState(msg) {
  if (msg.win) { finishGame(); return; }
  level.index = msg.index;
  level.progress = msg.progress;
  level.roundTarget = msg.roundTarget;
  renderHud();
}

function renderHud() {
  const def = LEVELS[level.index];
  levelTitle.textContent = def.title;
  let hint = def.hint;
  if (def.key === "mirror" && level.roundTarget) {
    hint = `Joueur A → ${LANE_LABEL[level.roundTarget.a]} · Joueur B → ${LANE_LABEL[level.roundTarget.b]}`;
  }
  if (def.key === "finale" && level.roundTarget) {
    hint = `Joueur A : ${specLabel(level.roundTarget.a)} · Joueur B : ${specLabel(level.roundTarget.b)}`;
  }
  levelHint.textContent = hint;
  levelProgress.style.width = Math.round(level.progress * 100) + "%";

  levelPill.innerHTML = "";
  for (let i = 0; i < LEVELS.length; i++) {
    const dot = document.createElement("span");
    if (i < level.index) dot.className = "done";
    else if (i === level.index) dot.className = "active";
    levelPill.appendChild(dot);
  }
}

function startGame() {
  gameStarted = true;
  for (const k in screens) screens[k].style.display = "none";
  levelBanner.style.display = "block";
  if (role === "host") initLevel(0);
  renderHud();
}

function finishGame() {
  levelBanner.style.display = "none";
  showScreen("win");
}

// ---------- Rendu ----------
function buildFigure(points) {
  const [nose, lsh, rsh, lel, rel, lwr, rwr, lhip, rhip, lkn, rkn] = points;
  const shoulderMid = mid(lsh, rsh);
  const hipMid = mid(lhip, rhip);
  const torso = Math.max(0.06, dist(shoulderMid, hipMid));
  return { nose, lsh, rsh, lel, rel, lwr, rwr, lhip, rhip, lkn, rkn, shoulderMid, torso };
}

function drawFigure(fig, anchorX, anchorY, color) {
  if (!fig) return;
  const built = buildFigure(fig);
  const scale = 140 / built.torso;
  const P = (p) => ({
    x: anchorX + (p.x - built.shoulderMid.x) * scale,
    y: anchorY + (p.y - built.shoulderMid.y) * scale,
  });

  const pairs = [
    ["lsh", "rsh"], ["lsh", "lhip"], ["rsh", "rhip"], ["lhip", "rhip"],
    ["lsh", "lel"], ["lel", "lwr"], ["rsh", "rel"], ["rel", "rwr"],
    ["lhip", "lkn"], ["rhip", "rkn"],
  ];
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
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

function drawRoom() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#141733");
  g.addColorStop(1, "#05060c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, H * 0.82, W, H * 0.18);
}

function drawLevelProps() {
  if (!gameStarted) return;
  const def = LEVELS[level.index];
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "600 15px Inter, sans-serif";
  if (def.key === "switches") {
    drawSwitch(W * 0.3, H * 0.28, localG.handsUp || (role === "guest" && remoteG.handsUp));
    drawSwitch(W * 0.7, H * 0.28, remoteG.handsUp || (role === "guest" && localG.handsUp));
  } else if (def.key === "press") {
    drawGate(level.progress);
  } else if (def.key === "mirror" && level.roundTarget) {
    drawLaneMarkers(0.3, level.roundTarget.a);
    drawLaneMarkers(0.7, level.roundTarget.b);
  } else if (def.key === "bridge") {
    drawBridge(level.progress);
  } else if (def.key === "finale" && level.roundTarget) {
    drawBadge(W * 0.3, H * 0.24, specLabel(level.roundTarget.a));
    drawBadge(W * 0.7, H * 0.24, specLabel(level.roundTarget.b));
  }
  ctx.restore();
}

function drawSwitch(x, y, active) {
  ctx.fillStyle = active ? "rgba(52,211,153,0.85)" : "rgba(255,255,255,0.12)";
  ctx.shadowColor = "#34d399";
  ctx.shadowBlur = active ? 18 : 0;
  ctx.beginPath();
  ctx.roundRect(x - 30, y - 16, 60, 32, 16);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawGate(progress) {
  const w = 240, x = W / 2 - w / 2, y = H * 0.14, h = 30 * (1 - progress);
  ctx.fillStyle = "rgba(167,139,250,0.5)";
  ctx.fillRect(x, y, w, Math.max(4, h));
}

function drawLaneMarkers(cx, targetLane) {
  const labels = [-1, 0, 1];
  for (const l of labels) {
    const x = W * cx + l * 70;
    ctx.fillStyle = l === targetLane ? "rgba(125,211,252,0.9)" : "rgba(255,255,255,0.15)";
    ctx.fillRect(x - 22, H * 0.78, 44, 8);
  }
}

function drawBridge(progress) {
  const y = H * 0.5;
  ctx.strokeStyle = "rgba(52,211,153,0.7)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(W * 0.22, y);
  ctx.lineTo(W * 0.22 + (W * 0.56) * progress, y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.moveTo(W * 0.22 + (W * 0.56) * progress, y);
  ctx.lineTo(W * 0.78, y);
  ctx.stroke();
}

function drawBadge(x, y, text) {
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(text, x, y);
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.05, (now - prevT) / 1000);

  if (gameStarted && role === "host") updateLevelHost(dt);

  drawRoom();
  drawLevelProps();
  const leftFig = role === "host" ? localFigure : remoteFigure;
  const rightFig = role === "host" ? remoteFigure : localFigure;
  drawFigure(leftFig, W * 0.3, H * 0.62, "#7dd3fc");
  drawFigure(rightFig, W * 0.7, H * 0.62, "#a78bfa");

  requestAnimationFrame(() => frame(now));
}

requestAnimationFrame(() => frame(performance.now()));
