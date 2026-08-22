// Route templates for the Play Designer. Each generates a simple polyline
// (normalized 0-1 field coordinates, offense driving toward y=0) from a
// player's start position — no curve libraries, just a handful of points.
// "custom" (hand-drawn) routes don't use this at all; their points[] come
// directly from the coach's drag gesture. Deliberately simple shapes —
// V1, not a route-tree simulator.

export const ROUTE_TEMPLATES = [
  { value: 'go', label: 'Go / Fly' },
  { value: 'slant', label: 'Slant' },
  { value: 'out', label: 'Out' },
  { value: 'in', label: 'In / Dig' },
  { value: 'post', label: 'Post' },
  { value: 'corner', label: 'Corner' },
  { value: 'drag', label: 'Drag / Shallow Cross' },
  { value: 'curl', label: 'Curl / Hook' },
  { value: 'screen', label: 'Screen' },
  { value: 'custom', label: 'Custom (hand-drawn)' },
];

/**
 * Generates a template route's points. `flipped` mirrors the break
 * direction (a coach applies the template, then can flip it if the
 * default guess about left/right was wrong for that formation).
 * Returns { points: [{x,y}...], approxDepthYards }.
 */
export function generateTemplateRoute(routeType, startX, startY, flipped) {
  const dir = flipped ? -1 : 1; // break direction multiplier
  const p = (x, y) => ({ x: clamp01(x), y: clamp01(y) });

  switch (routeType) {
    case 'go':
      return { points: [p(startX, startY), p(startX, startY - 0.45)], approxDepthYards: 15 };
    case 'slant':
      return {
        points: [p(startX, startY), p(startX, startY - 0.08), p(startX + dir * 0.18, startY - 0.2)],
        approxDepthYards: 5,
      };
    case 'out':
      return {
        points: [p(startX, startY), p(startX, startY - 0.14), p(startX + dir * 0.22, startY - 0.14)],
        approxDepthYards: 6,
      };
    case 'in':
      return {
        points: [p(startX, startY), p(startX, startY - 0.2), p(startX - dir * 0.22, startY - 0.2)],
        approxDepthYards: 8,
      };
    case 'post':
      return {
        points: [p(startX, startY), p(startX, startY - 0.2), p(startX - dir * 0.14, startY - 0.4)],
        approxDepthYards: 15,
      };
    case 'corner':
      return {
        points: [p(startX, startY), p(startX, startY - 0.2), p(startX + dir * 0.18, startY - 0.38)],
        approxDepthYards: 15,
      };
    case 'drag':
      return {
        points: [p(startX, startY), p(startX, startY - 0.04), p(startX - dir * 0.4, startY - 0.06)],
        approxDepthYards: 3,
      };
    case 'curl':
      return {
        points: [p(startX, startY), p(startX, startY - 0.16), p(startX, startY - 0.1)],
        approxDepthYards: 7,
      };
    case 'screen':
      return {
        points: [p(startX, startY), p(startX + dir * 0.1, startY + 0.02)],
        approxDepthYards: -1,
      };
    default:
      return { points: [p(startX, startY)], approxDepthYards: null };
  }
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
