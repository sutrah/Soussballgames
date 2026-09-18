import { PoseController, LM } from "../../assets/js/pose/PoseController.js";
import { drawSkeleton } from "../../assets/js/pose/skeleton.js";

// Route de glace façon Tron, inspirée du "Pas de Patineur" (squelette.html,
// sutrah/weballgames — déjà la base du jeu Flappy de ce dépôt, cf. CLAUDE.md).
// La demande d'origine visait le moteur 3D Ursina — mais Ursina est un moteur
// Python (Panda3D) : il ne peut pas tourner dans une page statique servie par
// GitHub Pages, ce qui est l'architecture entière de ce site. On utilise donc
// Three.js (WebGL, chargé depuis un CDN comme MediaPipe/PeerJS le sont déjà)
// pour une vraie 3D qui reste 100% navigateur. Chargée via l'import map
// déclarée dans index.html ("three" / "three/addons/") — nécessaire pour que
// les modules de post-traitement (qui importent "three" en spécificateur nu
// en interne) se résolvent depuis un CDN, sans bundler.

// Accepté pour coller à la convention du fichier de référence (une page,
// plusieurs exercices sélectionnés via ?exo=). Ce jeu n'implémente qu'un seul
// exercice : le paramètre est lu par cohérence documentée, pas pour brancher
// un comportement différent — inutile de reconstruire ici l'architecture
// multi-exercices de squelette.html alors que chaque jeu de Soussballgames a
// déjà son propre dossier/URL.
const EXO_ID = new URLSearchParams(location.search).get("exo") || "patinage";
void EXO_ID;

// ---------- DOM ----------
const canvas = document.getElementById("game");
const video = document.getElementById("video");
const skeleton = document.getElementById("skeleton");
const camDot = document.getElementById("camDot");
const camLabel = document.getElementById("camLabel");
const scoreVal = document.getElementById("scoreVal");
const overlayStart = document.getElementById("overlayStart");
const overlayOver = document.getElementById("overlayOver");
const finalScore = document.getElementById("finalScore");
const finalTiles = document.getElementById("finalTiles");
const bestScoreEl = document.getElementById("bestScore");
const btnStart = document.getElementById("btnStart");
const btnRetry = document.getElementById("btnRetry");
const pillLeft = document.getElementById("pillLeft");
const pillRight = document.getElementById("pillRight");

const BEST_KEY = "patinage-best";
let best = Number(localStorage.getItem(BEST_KEY) || 0);
bestScoreEl.textContent = best;

// ---------- Détection des pas (repris de flappy.js — même mécanique "Pas de
// Patineur" : zones gauche/droite au sol, détectées via les chevilles) ----------
const FOOT_MIN_VIS = 0.12;
const DALLE_Y_FRAC = 0.6;

let feetVisible = false;
let sideFresh = { left: true, right: true };
let pendingStep = null;

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
    if (p.y < DALLE_Y_FRAC) continue;
    if (p.x < 0.5) active.left = true; else active.right = true;
  }

  for (const side of ["left", "right"]) if (!active[side]) sideFresh[side] = true;
  for (const side of ["left", "right"]) {
    if (active[side] && sideFresh[side]) {
      sideFresh[side] = false;
      pendingStep = side;
    }
  }
});

function consumeStep() {
  if (!pendingStep) return null;
  const s = pendingStep;
  pendingStep = null;
  return s;
}

// Fallback clavier pour tester sans caméra / accessibilité.
window.addEventListener("keydown", (e) => {
  if (state !== "playing" && state !== "intro") return;
  if (e.code === "ArrowLeft") { feetVisible = true; pendingStep = "left"; }
  if (e.code === "ArrowRight") { feetVisible = true; pendingStep = "right"; }
});

// ---------- Physique de la glisse ----------
const SPEED_MAX = 26;
const FRICTION = 0.55; // fraction de vitesse perdue par seconde — la "friction de la glace" : on ralentit, on ne s'arrête jamais net
const STEP_BOOST = 7.5;
const FAST_INTERVAL = 0.38, SLOW_INTERVAL = 0.75;
const STEP_BOOST_FAST = 1.35, STEP_BOOST_SLOW = 0.7;
const TURN_GAIN = 0.9;
const TURN_DECAY = 1.6;
const LATERAL_RATE = 3.2;
const LATERAL_MAX = 1;
const TILE_TOL = 0.35;
const INTRO_SECONDS = 3;
const SESSION_DURATION = 45;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

let state = "idle"; // idle | intro | playing | over
let introLeft = INTRO_SECONDS;
let sessionT = 0;
let speed = 0;
let distance = 0;
let lastStepSide = null;
let lastStepAt = 0;
let turnBias = 0;
let lateralOffset = 0;
let stepFlash = { left: 0, right: 0 };
let bonusCount = 0;
let bonusScore = 0;

function resetGame() {
  state = "idle";
  introLeft = INTRO_SECONDS;
  sessionT = 0;
  speed = 0;
  distance = 0;
  lastStepSide = null;
  lastStepAt = 0;
  turnBias = 0;
  lateralOffset = 0;
  stepFlash = { left: 0, right: 0 };
  bonusCount = 0;
  bonusScore = 0;
  sideFresh = { left: true, right: true };
  pendingStep = null;
  tileTimer = 0;
  nextTileAt = TILE_SPAWN_MIN;
  for (const t of tiles) removeTileMesh(t);
  tiles = [];
  scoreVal.textContent = "0";
}

function applyStep(side, now) {
  const interval = lastStepAt > 0 ? now - lastStepAt : null;
  let mult = 1;
  if (interval != null) {
    if (interval < FAST_INTERVAL) mult = STEP_BOOST_FAST;
    else if (interval > SLOW_INTERVAL) mult = STEP_BOOST_SLOW;
  }
  speed = Math.min(SPEED_MAX, speed + STEP_BOOST * mult);
  stepFlash[side] = 1;
  if (side === lastStepSide) {
    turnBias = clamp(turnBias + TURN_GAIN * (side === "left" ? -1 : 1), -1, 1);
  } else {
    turnBias *= 0.4;
  }
  lastStepSide = side;
  lastStepAt = now;
}

// ---------- Dalles bonus (facultatives, juste à ramasser en passant) ----------
const TILE_SPAWN_MIN = 2.2, TILE_SPAWN_MAX = 4.0;
const TILE_SPAWN_Z = -60, TILE_COLLECT_Z = -2, TILE_DESPAWN_Z = 4;
const TILE_LANES = [-0.7, 0, 0.7];
const TILE_COLORS = [0x38bdf8, 0xf472b6, 0xfbbf24, 0x34d399];

let tiles = [];
let tileTimer = 0;
let nextTileAt = TILE_SPAWN_MIN;

function spawnTile() {
  const lane = TILE_LANES[Math.floor(Math.random() * TILE_LANES.length)];
  const color = TILE_COLORS[Math.floor(Math.random() * TILE_COLORS.length)];
  tiles.push({ lane, z: TILE_SPAWN_Z, color, collected: false, mesh: null });
}

function updateTiles(dt) {
  tileTimer += dt;
  if (tileTimer >= nextTileAt) {
    tileTimer = 0;
    nextTileAt = TILE_SPAWN_MIN + Math.random() * (TILE_SPAWN_MAX - TILE_SPAWN_MIN);
    spawnTile();
  }
  for (const t of tiles) {
    if (!t.mesh) spawnTileMesh(t);
    t.z += speed * dt;
    t.mesh.position.z = t.z;
    if (!t.collected && t.z >= TILE_COLLECT_Z - 1.2 && t.z <= TILE_COLLECT_Z + 1.2) {
      if (Math.abs(t.lane - lateralOffset) < TILE_TOL) {
        t.collected = true;
        bonusCount++;
        bonusScore += 25;
      }
    }
    if (t.collected) {
      t.mesh.material.opacity = Math.max(0, t.mesh.material.opacity - dt * 3);
      t.mesh.scale.multiplyScalar(1 + dt * 3);
    }
  }
  const keep = [];
  for (const t of tiles) {
    if (t.z > TILE_DESPAWN_Z) removeTileMesh(t);
    else keep.push(t);
  }
  tiles = keep;
}

// ---------- Boucle de jeu (physique + score, indépendante du rendu 3D) ----------
function update(dt) {
  if (!feetVisible) return;

  if (state === "intro") {
    introLeft -= dt;
    if (introLeft <= 0) { state = "playing"; sessionT = 0; }
    return;
  }
  if (state !== "playing") return;

  sessionT += dt;
  if (sessionT >= SESSION_DURATION) { endGame(); return; }

  const side = consumeStep();
  if (side) applyStep(side, sessionT);

  speed = Math.max(0, speed - speed * FRICTION * dt);
  turnBias *= Math.max(0, 1 - TURN_DECAY * dt);
  lateralOffset = clamp(lateralOffset + turnBias * LATERAL_RATE * dt, -LATERAL_MAX, LATERAL_MAX);

  distance += speed * dt;
  scoreVal.textContent = String(Math.floor(distance + bonusScore));

  for (const s of ["left", "right"]) stepFlash[s] = Math.max(0, stepFlash[s] - dt * 3);
  pillLeft.classList.toggle("hit", stepFlash.left > 0.15);
  pillRight.classList.toggle("hit", stepFlash.right > 0.15);

  updateTiles(dt);
}

function startGame() {
  resetGame();
  state = "intro";
  overlayStart.style.display = "none";
  overlayOver.style.display = "none";
}

function endGame() {
  state = "over";
  const finalScoreVal = Math.floor(distance + bonusScore);
  if (finalScoreVal > best) { best = finalScoreVal; localStorage.setItem(BEST_KEY, String(best)); }
  finalScore.textContent = finalScoreVal;
  finalTiles.textContent = String(bonusCount);
  bestScoreEl.textContent = best;
  overlayOver.style.display = "flex";
}

btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  btnStart.textContent = "Activation…";
  try {
    await pose.start();
    await ensureThree();
    startGame();
  } catch (e) {
    btnStart.disabled = false;
    btnStart.textContent = "Réessayer";
    alert("Impossible d'accéder à la caméra : " + e.message);
  }
});

btnRetry.addEventListener("click", startGame);

// ---------- Rendu 3D (Three.js) ----------
// Trois cibles pour coller à l'image de référence : (1) un vrai bloom (les
// matériaux "unlit" de Three.js ne rayonnent pas tout seuls comme un
// ctx.shadowBlur en canvas 2D — sans passe de post-traitement, aucune ligne
// néon ne "brille" réellement), (2) des montagnes en amas de cristaux
// facettés dégradés (pas de simples cônes fil-de-fer épars), (3) un fond qui
// rayonne (rais de lumière + grille "plafond"), pas un ciel vide.
let THREE = null;
let renderer = null, scene = null, camera = null, composer = null;
let roadTexture = null, tileTexture = null;
const ROAD_HALF_W = 7;

async function ensureThree() {
  if (THREE) return;
  const [threeMod, { EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
    import("three"),
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/UnrealBloomPass.js"),
  ]);
  THREE = threeMod;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);
  scene.fog = new THREE.FogExp2(0x03040a, 0.018);

  camera = new THREE.PerspectiveCamera(72, 1, 0.1, 260);
  camera.position.set(0, 1.5, 4);
  camera.rotation.order = "YXZ";
  camera.lookAt(0, 1.2, -20);

  buildSky();
  buildRoad();
  buildMountains();
  buildSun();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.4));

  resizeRenderer();
  window.addEventListener("resize", resizeRenderer);
}

function resizeRenderer() {
  if (!renderer) return;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(w, h);
}

// Fond du ciel : une grande sphère vue de l'intérieur (BackSide), texturée
// avec des rais de lumière rayonnants + une grille "plafond" — remplace le
// noir vide du premier jet, qui manquait le principal repère d'ambiance de
// l'image de référence.
function buildSky() {
  const size = 1024;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#03040a";
  g.fillRect(0, 0, size, size);
  const cx = size * 0.5, cy = size * 0.6;
  const rayColors = ["rgba(56,189,248,0.16)", "rgba(167,139,250,0.14)", "rgba(244,114,182,0.12)"];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.strokeStyle = rayColors[i % rayColors.length];
    g.lineWidth = 3 + Math.random() * 7;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
    g.stroke();
  }
  g.strokeStyle = "rgba(125,211,252,0.22)";
  g.lineWidth = 1.5;
  for (let y = 0; y < size * 0.4; y += size / 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
  for (let x = 0; x < size; x += size / 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size * 0.4); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(230, 24, 16), mat);
  scene.add(sky);
}

function makeRoadTexture() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#050510";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "rgba(125,180,255,0.22)";
  g.lineWidth = 1.5;
  const step = size / 10;
  for (let x = step; x < size; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke(); }
  for (let y = step; y < size; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
  g.strokeStyle = "rgba(167,139,250,0.5)";
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(size / 2, 0); g.lineTo(size / 2, size); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 70);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildRoad() {
  roadTexture = makeRoadTexture();
  const geo = new THREE.PlaneGeometry(ROAD_HALF_W * 2, 400, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ map: roadTexture, fog: true });
  const road = new THREE.Mesh(geo, mat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -190);
  scene.add(road);

  // Glissières lumineuses sur les deux bords — bien plus marquantes qu'une
  // simple texture, et c'est elles (avec le bloom) qui donnent la ligne néon
  // continue vue sur l'image de référence.
  for (const side of [-1, 1]) {
    const railGeo = new THREE.PlaneGeometry(0.35, 400);
    const railMat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.95, fog: true });
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.rotation.x = -Math.PI / 2;
    rail.position.set(side * ROAD_HALF_W, 0.02, -190);
    scene.add(rail);
  }
}

// Un amas de cristaux facettés (pas un simple cône fil-de-fer) : remplissage
// dégradé (pointe claire → base saturée, via des couleurs par sommet), arêtes
// vives par-dessus, et des nervures pointe→base pour le détail "lignes
// verticales" du grand pic de l'image de référence.
function makeCrystalCluster(topColorHex, bottomColorHex) {
  const group = new THREE.Group();
  const pieces = 2 + Math.floor(Math.random() * 3);
  const top = new THREE.Color(topColorHex), bottom = new THREE.Color(bottomColorHex);
  for (let i = 0; i < pieces; i++) {
    const h = 3 + Math.random() * 9;
    const r = 1 + Math.random() * 2.4;
    const seg = 5 + Math.floor(Math.random() * 3);
    const geo = new THREE.ConeGeometry(r, h, seg);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + h / 2) / h;
      const c = bottom.clone().lerp(top, t);
      colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.18, fog: true, side: THREE.FrontSide,
    }));

    const edges = new THREE.EdgesGeometry(geo);
    const edgeMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: bottomColorHex, transparent: true, opacity: 0.95, fog: true,
    }));

    const ribPositions = [];
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      ribPositions.push(0, h / 2, 0, Math.cos(a) * r, -h / 2, Math.sin(a) * r);
    }
    const ribGeo = new THREE.BufferGeometry();
    ribGeo.setAttribute("position", new THREE.Float32BufferAttribute(ribPositions, 3));
    const ribs = new THREE.LineSegments(ribGeo, new THREE.LineBasicMaterial({
      color: topColorHex, transparent: true, opacity: 0.55, fog: true,
    }));

    const px = (Math.random() - 0.5) * r * 1.6, pz = (Math.random() - 0.5) * r * 1.6;
    const rot = Math.random() * Math.PI;
    for (const obj of [mesh, edgeMesh, ribs]) {
      obj.position.set(px, h / 2 - 0.3, pz);
      obj.rotation.y = rot;
      group.add(obj);
    }
  }
  return group;
}

function buildMountains() {
  // Couleurs de pointe volontairement moins pâles que la première version :
  // un blanc/cyan quasi pur sous bloom devient un aplat blanc sans relief —
  // en restant sur des teintes plus saturées, le dégradé pointe→base reste
  // lisible même une fois la passe de bloom appliquée.
  const palettes = [
    [0x7dd3fc, 0x1d5fae],
    [0xc4b5fd, 0x6d28d9],
    [0xf9a8d4, 0xbe185d],
  ];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const [t, b] = palettes[Math.floor(Math.random() * palettes.length)];
      const cluster = makeCrystalCluster(t, b);
      const near = i < 2; // quelques amas plus gros, en retrait sur les côtés, comme au premier plan de l'image
      cluster.scale.setScalar(near ? 1.1 + Math.random() * 0.5 : 0.7 + Math.random() * 1.1);
      const x = side * (near ? 12 + Math.random() * 5 : 10 + Math.random() * 24);
      const z = near ? -14 - Math.random() * 14 : -16 - Math.random() * 150;
      cluster.position.set(x, 0, z);
      scene.add(cluster);
    }
  }
}

function buildSun() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "#f0fbff");
  grad.addColorStop(0.4, "#7dd3fc");
  grad.addColorStop(0.75, "#38bdf8");
  grad.addColorStop(1, "rgba(56,189,248,0)");
  g.fillStyle = grad;
  g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#03040a";
  let y = size * 0.38, bandH = 5, gap = 9;
  while (y < size) { g.fillRect(0, y, size, bandH); bandH = Math.min(22, bandH + 1.6); y += bandH + gap; gap = Math.max(3, gap - 0.6); }
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
  sprite.scale.set(38, 38, 1);
  sprite.position.set(0, 13, -160);
  scene.add(sprite);
}

// Texture de grille blanche partagée, teintée par matériau (`color`) pour
// chaque dalle — évite de refabriquer une texture par couleur.
function getTileTexture() {
  if (tileTexture) return tileTexture;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  g.strokeStyle = "#ffffff";
  g.lineWidth = 8;
  g.strokeRect(6, 6, size - 12, size - 12);
  g.lineWidth = 2;
  g.globalAlpha = 0.7;
  const step = size / 6;
  for (let x = step; x < size; x += step) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x, size - 6); g.stroke(); }
  for (let y = step; y < size; y += step) { g.beginPath(); g.moveTo(6, y); g.lineTo(size - 6, y); g.stroke(); }
  tileTexture = new THREE.CanvasTexture(c);
  return tileTexture;
}

function spawnTileMesh(t) {
  const geo = new THREE.PlaneGeometry(1.3, 1.3);
  const mat = new THREE.MeshBasicMaterial({ map: getTileTexture(), color: t.color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(t.lane * 3.2, 0.04, t.z);
  scene.add(mesh);
  t.mesh = mesh;
}

function removeTileMesh(t) {
  if (!t.mesh) return;
  scene.remove(t.mesh);
  t.mesh.geometry.dispose();
  t.mesh.material.dispose();
  t.mesh = null;
}

function updateScene(dt) {
  if (!composer) return;
  if (roadTexture) roadTexture.offset.y = (roadTexture.offset.y + speed * dt * 0.05) % 1;

  const targetX = lateralOffset * 3.2;
  camera.position.x += (targetX - camera.position.x) * Math.min(1, dt * 4);
  const targetYaw = -lateralOffset * 0.16;
  camera.rotation.y += (targetYaw - camera.rotation.y) * Math.min(1, dt * 4);
  const targetRoll = (stepFlash.left - stepFlash.right) * 0.05;
  camera.rotation.z += (targetRoll - camera.rotation.z) * Math.min(1, dt * 6);
  camera.position.y = 1.5 + Math.sin(sessionT * 3) * 0.01 * Math.min(1, speed / 10);

  composer.render();
}

function frame(prevT) {
  const now = performance.now();
  const dt = Math.min(0.05, (now - prevT) / 1000);

  update(dt);
  updateScene(dt);

  requestAnimationFrame(() => frame(now));
}

requestAnimationFrame(() => frame(performance.now()));
