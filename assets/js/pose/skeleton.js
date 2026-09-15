// Rendu du squelette de calibration, partagé par tous les jeux (mini aperçu caméra).

const DEFAULT_PAIRS = (LM) => [
  [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_SHOULDER, LM.L_HIP], [LM.R_SHOULDER, LM.R_HIP],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
];

/**
 * Dessine le squelette normalisé (points 0..1) dans un canvas d'aperçu.
 * @param {HTMLCanvasElement} canvas
 * @param {Array|null} lm - landmarks normalisés (déjà miroités si besoin)
 * @param {object} LM - table d'indices (voir PoseController)
 * @param {object} [opts]
 * @param {number[]} [opts.highlight] - indices à mettre en évidence (points plus gros)
 * @param {Array} [opts.pairs] - paires de connexions personnalisées
 */
export function drawSkeleton(canvas, lm, LM, opts = {}) {
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;

  const pairs = opts.pairs || DEFAULT_PAIRS(LM);
  const highlight = new Set(opts.highlight || []);

  ctx.strokeStyle = "rgba(125,211,252,0.85)";
  ctx.lineWidth = 3;
  for (const [a, b] of pairs) {
    const pa = lm[a], pb = lm[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * canvas.width, pa.y * canvas.height);
    ctx.lineTo(pb.x * canvas.width, pb.y * canvas.height);
    ctx.stroke();
  }

  for (const i of highlight) {
    const p = lm[i];
    if (!p) continue;
    ctx.fillStyle = "#a78bfa";
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
