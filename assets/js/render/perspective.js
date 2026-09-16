// Petite projection pseudo-3D partagée (route qui défile vers le joueur),
// utilisée par le runner. z=1 = horizon (loin), z=0 = joueur (près).

export function createPerspective({ horizonY, groundY, centerX, farScale = 0.16 }) {
  const scaleAt = (z) => 1 - z * (1 - farScale);
  const yAt = (z) => groundY - z * (groundY - horizonY);
  const xAt = (offsetUnits, z) => centerX + offsetUnits * scaleAt(z);
  return { scaleAt, yAt, xAt, horizonY, groundY, centerX };
}
