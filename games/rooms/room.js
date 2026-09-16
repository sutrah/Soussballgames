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
  waitingGuest: document.getElementById("screenWaitingGuest"),
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
const maxPlayersSelect = document.getElementById("maxPlayers");
const btnStartRoom = document.getElementById("btnStartRoom");
const rosterLabel = document.getElementById("rosterLabel");
const rosterLabelGuest = document.getElementById("rosterLabelGuest");
const btnCam = document.getElementById("btnCam");
const peerCamStatus = document.getElementById("peerCamStatus");
const errorLabel = document.getElementById("errorLabel");

const levelBanner = document.getElementById("levelBanner");
const levelTitle = document.getElementById("levelTitle");
const levelHint = document.getElementById("levelHint");
const levelProgress = document.getElementById("levelProgress");

const SEAT_COLORS = ["#7dd3fc", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"];
const seatLabel = (seat) => `Joueur ${seat + 1}`;

// ---------- Réseau ----------
const room = new PeerRoom();
let role = null;
let mySeat = 0;
let roster = []; // sièges figés au lancement, triés (ex: [0,1,2])
let camReadySeats = new Set();
let localCamReady = false;

room.onStatus((status, detail) => {
  if (status === "waiting-peer") { roomCodeEl.textContent = detail; showScreen("waiting"); renderRoster(); }
  if (status === "peer-joined" || status === "peer-left") {
    renderRoster();
    room.send({ type: "rosterUpdate", seats: room.seats });
  }
  if (status === "connecting-peer") connectingLabel.textContent = "Connexion à la room " + room.code + "…";
  if (status === "connected" && role === "guest") showScreen("waitingGuest");
  if (status === "disconnected") {
    errorLabel.textContent = "Un joueur a quitté la room.";
    showScreen("error");
  }
  if (status === "error") {
    errorLabel.textContent = "Erreur de connexion (" + (detail?.type || detail?.message || "inconnue") + "). Réessayez avec un nouveau code.";
    showScreen("error");
  }
});

function renderRoster() {
  const n = room.seats.length;
  if (role === "host") {
    rosterLabel.textContent = n + (n > 1 ? " joueurs connectés" : " joueur connecté");
    btnStartRoom.disabled = n < 2;
  }
}

room.onMessage((msg, fromSeat) => {
  if (msg.type === "camReady") {
    camReadySeats.add(fromSeat);
    if (role === "host") maybeAllCamReady();
  } else if (msg.type === "rosterUpdate") {
    const n = msg.seats.length;
    rosterLabelGuest.textContent = n + (n > 1 ? " joueurs connectés" : " joueur connecté");
  } else if (msg.type === "roomStart") {
    roster = msg.roster;
    showScreen("cam");
  } else if (msg.type === "pose") {
    playerStates[fromSeat] = { figure: msg.figure, g: msg.g };
  } else if (msg.type === "action") {
    (pendingActions[fromSeat] ||= []).push(msg.kind);
  } else if (msg.type === "state") {
    // Le·la guest reflète l'état autoritaire envoyé par l'hôte.
    if (role === "guest") {
      for (const seat of Object.keys(msg.players)) {
        if (Number(seat) === mySeat) continue; // on garde notre propre pose locale, plus réactive
        playerStates[seat] = msg.players[seat];
      }
      applyHostLevelState(msg.level);
    }
  } else if (msg.type === "win") {
    finishGame();
  }
});

btnHost.addEventListener("click", async () => {
  btnHost.disabled = true;
  try {
    role = "host";
    mySeat = 0;
    await room.host(Number(maxPlayersSelect.value));
  } catch (e) {
    errorLabel.textContent = "Impossible de créer la room : " + e.message;
    showScreen("error");
  }
});

btnStartRoom.addEventListener("click", () => {
  roster = room.seats.slice();
  room.send({ type: "roomStart", roster });
  showScreen("cam");
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
let prevHandsUp = false;

let localFigure = null;
let localG = { handsUp: false, spread: false, crouch: false, lane: 0 };
let playerStates = {}; // seat -> {figure, g}
let pendingActions = {}; // seat -> [kind,...] (hôte seulement)

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
  const handsUp = raised.left && raised.right;

  localG = { handsUp, spread: armsSpread(lm, LM), crouch: rel > 0.055, lane };
  playerStates[mySeat] = { figure: localFigure, g: localG };

  // Front montant de "mains levées" = action discrète (attraper / faire passer / lancer le seau).
  if (handsUp && !prevHandsUp) {
    if (role === "host") (pendingActions[mySeat] ||= []).push("handsUpEdge");
    else room.send({ type: "action", kind: "handsUpEdge" });
  }
  prevHandsUp = handsUp;

  if (now - lastSend > 80) {
    lastSend = now;
    if (role === "guest") room.send({ type: "pose", figure: localFigure, g: localG });
  }
});

btnCam.addEventListener("click", async () => {
  btnCam.disabled = true;
  btnCam.textContent = "Activation…";
  try {
    await pose.start();
    localCamReady = true;
    camReadySeats.add(mySeat);
    room.send({ type: "camReady" });
    if (role === "host") maybeAllCamReady();
    peerCamStatus.textContent = "En attente des autres joueurs…";
  } catch (e) {
    btnCam.disabled = false;
    btnCam.textContent = "Réessayer";
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
});

function maybeAllCamReady() {
  if (!roster.length) return;
  const allReady = roster.every((s) => camReadySeats.has(s));
  if (allReady && !gameStarted) startGame();
}

// ---------- Niveaux (logique autoritaire côté hôte) ----------
const LEVELS = [
  { key: "switches", title: "Niveau 1 — Interrupteurs", hint: "Levez les deux mains, tout le monde en même temps.", hold: 1.6 },
  { key: "press", title: "Niveau 2 — Presser ensemble", hint: "Accroupissez-vous tous en même temps.", hold: 1.6 },
  { key: "mirror", title: "Niveau 3 — Position miroir", hint: "", rounds: 3, hold: 1.0 },
  { key: "bridge", title: "Niveau 4 — Pont suspendu", hint: "Écartez grand les bras tous en même temps, et tenez.", hold: 3.0 },
  { key: "fire", title: "Niveau 5 — Chaîne du seau", hint: "", isFire: true },
];

const LANE_LABEL = { [-1]: "Gauche", 0: "Centre", 1: "Droite" };
const FIRE_FILL_TIME = 3;
const FIRE_TURN_TIMEOUT = 5;
const FIRE_THROWS_NEEDED = 3;

let gameStarted = false;
let level = { index: 0, progress: 0, round: 0, roundTargets: null, roundProgress: 0, fire: null };

function randomLane() { return [-1, 0, 1][Math.floor(Math.random() * 3)]; }

function allHave(prop) {
  return roster.every((s) => playerStates[s]?.g?.[prop]);
}

function newMirrorRound() {
  level.roundTargets = {};
  for (const s of roster) level.roundTargets[s] = randomLane();
  level.roundProgress = 0;
}

function newFireState() {
  return { holderPos: -1, fillProgress: 0, turnTimer: 0, extinguishCount: 0 };
}

function initLevel(idx) {
  level.index = idx;
  level.progress = 0;
  level.round = 0;
  const def = LEVELS[idx];
  if (def.key === "mirror") newMirrorRound();
  if (def.isFire) level.fire = newFireState();
  broadcastState();
}

function consumeAction(seat, kind) {
  const q = pendingActions[seat];
  if (!q) return false;
  const i = q.indexOf(kind);
  if (i === -1) return false;
  q.splice(i, 1);
  return true;
}

function updateFire(dt) {
  const f = level.fire;
  const def = LEVELS[level.index];
  if (f.holderPos === -1) {
    f.fillProgress = Math.min(1, f.fillProgress + dt / FIRE_FILL_TIME);
    if (f.fillProgress >= 1) { f.holderPos = 0; f.fillProgress = 0; f.turnTimer = 0; }
  } else {
    f.turnTimer += dt;
    const actorSeat = roster[f.holderPos];
    if (consumeAction(actorSeat, "handsUpEdge")) {
      if (f.holderPos === roster.length - 1) {
        f.extinguishCount++;
        f.holderPos = -1; f.fillProgress = 0; f.turnTimer = 0;
        if (f.extinguishCount >= FIRE_THROWS_NEEDED) { nextLevel(); return; }
      } else {
        f.holderPos++; f.turnTimer = 0;
      }
    } else if (f.turnTimer > FIRE_TURN_TIMEOUT) {
      f.holderPos = -1; f.fillProgress = 0; f.turnTimer = 0; // le seau se renverse, retour à la source
    }
  }
  level.progress = clamp01(f.extinguishCount / FIRE_THROWS_NEEDED);
}

function updateLevelHost(dt) {
  const def = LEVELS[level.index];
  if (def.key === "switches" || def.key === "press" || def.key === "bridge") {
    const prop = def.key === "switches" ? "handsUp" : def.key === "press" ? "crouch" : "spread";
    const ok = allHave(prop);
    const decay = def.key === "bridge" ? def.hold * 1.4 : def.hold * 0.6;
    level.progress = clamp01(level.progress + (ok ? dt / def.hold : -dt / decay));
    if (level.progress >= 1) nextLevel();
  } else if (def.key === "mirror") {
    const ok = roster.every((s) => playerStates[s]?.g?.lane === level.roundTargets[s]);
    level.roundProgress = clamp01(level.roundProgress + (ok ? dt / def.hold : -dt / (def.hold * 0.7)));
    if (level.roundProgress >= 1) {
      level.round++;
      if (level.round >= def.rounds) { nextLevel(); return; }
      newMirrorRound();
    }
    level.progress = clamp01((level.round + level.roundProgress) / def.rounds);
  } else if (def.isFire) {
    updateFire(dt);
  }
  broadcastState();
}

function nextLevel() {
  if (level.index >= LEVELS.length - 1) {
    room.send({ type: "win" });
    finishGame();
  } else {
    initLevel(level.index + 1);
  }
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function broadcastState() {
  room.send({
    type: "state",
    players: playerStates,
    level: {
      index: level.index,
      progress: level.progress,
      roundTargets: level.roundTargets,
      fire: level.fire,
    },
  });
  renderHud();
}

function applyHostLevelState(msg) {
  level.index = msg.index;
  level.progress = msg.progress;
  level.roundTargets = msg.roundTargets;
  level.fire = msg.fire;
  renderHud();
}

function renderHud() {
  const def = LEVELS[level.index];
  levelTitle.textContent = def.title;
  let hint = def.hint;
  if (def.key === "mirror" && level.roundTargets) {
    hint = roster.map((s) => `${seatLabel(s)} → ${LANE_LABEL[level.roundTargets[s]]}`).join(" · ");
  }
  if (def.isFire && level.fire) {
    const f = level.fire;
    if (f.holderPos === -1) hint = "Le seau se remplit à la source…";
    else hint = `Au tour de ${seatLabel(roster[f.holderPos])} : levez la main pour ${f.holderPos === roster.length - 1 ? "lancer sur le feu" : "faire passer le seau"} !`;
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

function anchorFor(posInRoster, count) {
  const x = W * (posInRoster + 1) / (count + 1);
  return { x, y: H * 0.62 };
}

function drawFigure(fig, anchorX, anchorY, color, isTurn) {
  if (!fig) return;
  const built = buildFigure(fig);
  const scale = 130 / built.torso;
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
  ctx.shadowBlur = isTurn ? 24 : 12;
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

  if (isTurn) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(performance.now() / 180);
    ctx.beginPath();
    ctx.ellipse(anchorX, anchorY + 190, 60, 16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
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
  if (!gameStarted || !roster.length) return;
  const def = LEVELS[level.index];
  const n = roster.length;
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "600 15px Inter, sans-serif";
  if (def.key === "switches") {
    for (let i = 0; i < n; i++) {
      const { x } = anchorFor(i, n);
      const active = playerStates[roster[i]]?.g?.handsUp;
      drawSwitch(x, H * 0.24, active);
    }
  } else if (def.key === "press") {
    drawGate(level.progress);
  } else if (def.key === "mirror" && level.roundTargets) {
    for (let i = 0; i < n; i++) {
      const { x } = anchorFor(i, n);
      drawLaneMarkers(x / W, level.roundTargets[roster[i]]);
    }
  } else if (def.key === "bridge") {
    drawBridge(level.progress);
  } else if (def.isFire && level.fire) {
    drawFireScene(roster, level.fire);
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

function drawLaneMarkers(cx01, targetLane) {
  const labels = [-1, 0, 1];
  for (const l of labels) {
    const x = W * cx01 + l * 60;
    ctx.fillStyle = l === targetLane ? "rgba(125,211,252,0.9)" : "rgba(255,255,255,0.15)";
    ctx.fillRect(x - 20, H * 0.78, 40, 8);
  }
}

function drawBridge(progress) {
  const y = H * 0.5;
  ctx.strokeStyle = "rgba(52,211,153,0.7)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(W * 0.12, y);
  ctx.lineTo(W * 0.12 + (W * 0.76) * progress, y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.moveTo(W * 0.12 + (W * 0.76) * progress, y);
  ctx.lineTo(W * 0.88, y);
  ctx.stroke();
}

function drawFlame(x, y, intensity) {
  const s = 24 + intensity * 30;
  const flick = Math.sin(performance.now() / 90) * 0.12 + 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flick, 1);
  for (const [ry, rw, color] of [[0, s, "#fb923c"], [-s * 0.28, s * 0.62, "#fbbf24"], [-s * 0.5, s * 0.3, "#fff7d6"]]) {
    ctx.beginPath();
    ctx.ellipse(0, ry, rw * 0.42, rw * 0.62, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = "#fb923c";
    ctx.shadowBlur = 20;
    ctx.fill();
  }
  ctx.restore();
  ctx.shadowBlur = 0;
}

function drawBucket(x, y, fillFrac) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#cbd5f5";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-16, -18); ctx.lineTo(-12, 14); ctx.lineTo(12, 14); ctx.lineTo(16, -18);
  ctx.stroke();
  if (fillFrac > 0) {
    ctx.fillStyle = "rgba(56,189,248,0.85)";
    ctx.beginPath();
    ctx.moveTo(-13.5, 14 - 30 * fillFrac); ctx.lineTo(-12, 14); ctx.lineTo(12, 14); ctx.lineTo(13.5, 14 - 30 * fillFrac);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath();
  ctx.ellipse(0, -18, 3, 8, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.restore();
}

function drawFireScene(rosterArr, f) {
  const n = rosterArr.length;
  const intensity = 1 - f.extinguishCount / FIRE_THROWS_NEEDED;
  drawFlame(W / 2, H * 0.2, Math.max(0.15, intensity));

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "600 12px Inter, sans-serif";
  ctx.fillText(`${f.extinguishCount}/${FIRE_THROWS_NEEDED} seaux jetés`, W / 2, H * 0.2 + 46);

  const sourceX = 60, sourceY = H * 0.4;
  ctx.fillStyle = "rgba(125,211,252,0.5)";
  ctx.beginPath();
  ctx.ellipse(sourceX, sourceY, 26, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "600 11px Inter, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("Source", sourceX, sourceY + 32);

  let bx = sourceX, by = sourceY - 30, fillFrac = f.fillProgress;
  if (f.holderPos >= 0) {
    const { x } = anchorFor(f.holderPos, n);
    bx = x; by = H * 0.62 - 190; fillFrac = 1;
  }
  drawBucket(bx, by, fillFrac);
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.05, (now - prevT) / 1000);

  if (gameStarted && role === "host") updateLevelHost(dt);

  drawRoom();
  drawLevelProps();

  const n = roster.length || 1;
  const activeSeat = level.fire && LEVELS[level.index]?.isFire && level.fire.holderPos >= 0 ? roster[level.fire.holderPos] : null;
  const order = roster.length ? roster : [mySeat];
  order.forEach((seat, i) => {
    const fig = seat === mySeat ? localFigure : playerStates[seat]?.figure;
    const { x, y } = anchorFor(i, n);
    drawFigure(fig, x, y, SEAT_COLORS[seat % SEAT_COLORS.length], seat === activeSeat);
  });

  requestAnimationFrame(() => frame(now));
}

requestAnimationFrame(() => frame(performance.now()));
