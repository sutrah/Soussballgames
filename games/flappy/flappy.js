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

const BEST_KEY = "flappy-patineur-best";
let best = Number(localStorage.getItem(BEST_KEY) || 0);
bestScoreEl.textContent = best;

// ---------- Dalles gauche/droite (repris du "Pas de Patineur" de webballgames) ----------
// Deux grandes zones au sol, détectées via la position des chevilles : on
// pose le pied dans la dalle qui s'allume, en alternance, au rythme d'un
// métronome. C'est ce pas — pas un "lever de genou" — qui fait monter le
// personnage : plus robuste, car il ne dépend que de la position du pied,
// visible dès qu'on recule un peu, pas d'un geste précis à calibrer.
const DALLE_Y_FRAC = 0.62;
const BPM = 92;
const BEAT_INT = 60 / BPM;
const FOOT_MIN_VIS = 0.12;

let feetVisible = false;
let zoneTarget = "left";
let zoneFresh = { left: true, right: true };
let nextBeat = 0;
let alreadyHit = false;
let hitFlash = { left: 0, right: 0 };
let missFlash = { left: 0, right: 0 };
let hitQueued = false;

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
  drawSkeleton(skeleton, lm, LM, { highlight: [LM.L_ANKLE, LM.R_ANKLE] });
  if (!lm) { feetVisible = false; return; }

  const feet = [];
  for (const i of [LM.L_ANKLE, LM.R_ANKLE]) {
    const p = lm[i];
    if (p && (p.v ?? 0) >= FOOT_MIN_VIS) feet.push(p);
  }
  feetVisible = feet.length > 0;
  if (!feetVisible) return;

  const active = { left: false, right: false };
  for (const p of feet) {
    if (p.y < DALLE_Y_FRAC) continue; // pied pas encore assez bas dans l'image
    if (p.x < 0.5) active.left = true; else active.right = true;
  }

  for (const side of ["left", "right"]) {
    if (!active[side]) zoneFresh[side] = true;
  }

  if (active[zoneTarget] && zoneFresh[zoneTarget] && !alreadyHit) {
    zoneFresh[zoneTarget] = false;
    hitFlash[zoneTarget] = 1;
    hitQueued = true;
    advanceBeat(t);
  }
});

// Fait passer la cible à l'autre dalle et réarme la fenêtre de tir — appelé
// aussi bien sur une réussite (le pas vient d'être posé) que sur un raté
// (le temps du battement s'est écoulé sans pas) : le rythme ne s'arrête
// jamais, comme dans le jeu de référence.
function advanceBeat(now) {
  zoneTarget = zoneTarget === "left" ? "right" : "left";
  nextBeat = now + BEAT_INT;
  alreadyHit = false;
}

// ---------- État du jeu ----------
// Gravité douce + vitesse de chute plafonnée : un pas raté (ça arrive) ne
// doit jamais être une chute punitive et soudaine — juste une descente
// progressive qu'on peut encore rattraper au pas suivant.
const GRAVITY = 500;
const MAX_FALL_SPEED = 150;
const HIT_VELOCITY = -240;
const LATE_GRACE = 0.22; // un pas un peu en retard compte encore avant de déclarer un raté
const PIPE_GAP = 220;
const PIPE_WIDTH = 96;
const PIPE_SPEED = 210;
const SPAWN_INTERVAL = 1.5;
const FIRST_SPAWN_DELAY = 1.4; // laisse le temps de caler le premier pas
const INTRO_SECONDS = 3;
const BIRD_X = W * 0.28;
const BIRD_R = 22;
const DALLE_TOP = H * DALLE_Y_FRAC;

let state = "idle"; // idle | intro | playing | dead
let bird, pipes, score, spawnTimer, t, particles, stars, introLeft;

function resetGame() {
  bird = { y: H / 2, vy: 0, tilt: 0 };
  pipes = [];
  particles = [];
  score = 0;
  spawnTimer = -FIRST_SPAWN_DELAY;
  t = 0;
  scoreVal.textContent = "0";
  stars = Array.from({ length: 60 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (DALLE_TOP - 10),
    r: Math.random() * 1.6 + 0.4,
    s: Math.random() * 20 + 8,
  }));
  zoneTarget = "left";
  zoneFresh = { left: true, right: true };
  alreadyHit = false;
  hitFlash = { left: 0, right: 0 };
  missFlash = { left: 0, right: 0 };
  hitQueued = false;
  introLeft = INTRO_SECONDS;
  nextBeat = INTRO_SECONDS + BEAT_INT;
}

function spawnPipe() {
  const margin = 65;
  const gapY = margin + Math.random() * (DALLE_TOP - margin * 2 - PIPE_GAP);
  pipes.push({ x: W + PIPE_WIDTH, gapY, passed: false });
}

function flap() {
  bird.vy = HIT_VELOCITY;
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

  // Le jeu attend d'avoir des pieds détectés avant de faire quoi que ce soit :
  // pas de chute punitive pendant que le joueur se recule / se cale.
  if (!feetVisible) return;

  if (state === "intro") {
    introLeft -= dt;
    if (introLeft <= 0) {
      state = "playing";
      nextBeat = t + BEAT_INT;
    }
    return;
  }

  if (hitQueued) { flap(); hitQueued = false; }

  if (t >= nextBeat + LATE_GRACE && !alreadyHit) {
    missFlash[zoneTarget] = 1;
    advanceBeat(t);
  }

  bird.vy = Math.min(MAX_FALL_SPEED, bird.vy + GRAVITY * dt);
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

  for (const side of ["left", "right"]) {
    hitFlash[side] = Math.max(0, hitFlash[side] - dt * 2.5);
    missFlash[side] = Math.max(0, missFlash[side] - dt * 2.5);
  }

  if (bird.y - BIRD_R < 0) { bird.y = BIRD_R; bird.vy = Math.max(bird.vy, 0); }
  if (bird.y + BIRD_R > DALLE_TOP) return true;
  for (const p of pipes) {
    const withinX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_WIDTH;
    if (!withinX) continue;
    const inGap = bird.y - BIRD_R > p.gapY && bird.y + BIRD_R < p.gapY + PIPE_GAP;
    if (!inGap) return true;
  }
  return false;
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, DALLE_TOP);
  g.addColorStop(0, "#0c1024");
  g.addColorStop(1, "#05060c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, DALLE_TOP);
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
  roundRect(ctx, p.x, p.gapY + PIPE_GAP, PIPE_WIDTH, DALLE_TOP - (p.gapY + PIPE_GAP), 18);
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

function drawDalles() {
  const y1 = DALLE_TOP, h = H - DALLE_TOP;
  for (const side of ["left", "right"]) {
    const x1 = side === "left" ? 0 : W / 2;
    const isTarget = state === "playing" && zoneTarget === side;
    const hf = hitFlash[side], mf = missFlash[side];

    let fill;
    if (hf > 0) fill = `rgba(52,211,153,${0.15 + hf * 0.55})`;
    else if (mf > 0) fill = `rgba(251,113,133,${0.1 + mf * 0.35})`;
    else if (isTarget) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 7);
      fill = `rgba(125,211,252,${0.16 + pulse * 0.14})`;
    } else fill = "rgba(255,255,255,0.04)";

    ctx.fillStyle = fill;
    ctx.fillRect(x1, y1, W / 2, h);
    ctx.strokeStyle = isTarget ? "rgba(125,211,252,0.9)" : "rgba(255,255,255,0.08)";
    ctx.lineWidth = isTarget ? 3 : 1;
    ctx.strokeRect(x1 + 2, y1 + 2, W / 2 - 4, h - 4);

    if (isTarget) {
      const ratio = Math.max(0, Math.min(1, (nextBeat - t) / BEAT_INT));
      const bw = W / 2 - 24, bx = x1 + 12, by = H - 14;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle = ratio > 0.4 ? "#34d399" : "#fb923c";
      ctx.fillRect(bx, by, bw * ratio, 5);
    }

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "600 13px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(side === "left" ? "GAUCHE" : "DROITE", x1 + W / 4, y1 + 24);
  }

  if (!feetVisible && state !== "idle" && state !== "dead") {
    ctx.fillStyle = "rgba(6,7,13,0.55)";
    ctx.fillRect(0, y1, W, h);
    ctx.fillStyle = "#fbbf24";
    ctx.font = "600 16px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Reculez-vous : pieds non détectés", W / 2, y1 + h / 2);
  }
  ctx.textAlign = "left";
}

function drawIntro() {
  if (state !== "intro") return;
  ctx.fillStyle = "rgba(6,7,13,0.45)";
  ctx.fillRect(0, 0, W, DALLE_TOP);
  ctx.fillStyle = "#fff";
  ctx.font = "700 64px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(Math.max(1, Math.ceil(introLeft))), W / 2, DALLE_TOP / 2 + 20);
  ctx.font = "600 15px Inter, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("Préparez-vous, placez vos pieds…", W / 2, DALLE_TOP / 2 + 60);
  ctx.textAlign = "left";
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.033, (now - prevT) / 1000);

  if (state === "playing" || state === "intro") {
    const dead = update(dt);
    if (dead) endGame();
  }

  drawBackground();
  for (const p of pipes) drawPipe(p);
  drawBird();
  drawDalles();
  drawIntro();

  requestAnimationFrame(() => frame(now));
}

function startGame() {
  resetGame();
  state = "intro";
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

// Fallback clavier (flèches) pour tester sans caméra / accessibilité.
window.addEventListener("keydown", (e) => {
  if (state !== "playing" && state !== "intro") return;
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    feetVisible = true;
    const side = e.code === "ArrowLeft" ? "left" : "right";
    if (side === zoneTarget && !alreadyHit) {
      alreadyHit = true;
      hitQueued = true;
    }
  }
});

resetGame();
requestAnimationFrame(() => frame(performance.now()));
