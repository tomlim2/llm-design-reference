// Paths use a 1000 × 625 design space. Per-image overrides follow visible geometry.
export const GUIDE_TYPES = Object.freeze([
  'golden', 'vanishing', 'radial', 'thirds', 'platform', 'diagonal',
  'center', 'frame', 'cross-diagonal', 'curve'
]);

export function compositionPaths(guide) {
  if (!guide || !GUIDE_TYPES.includes(guide.type)) return [];
  if (guide.paths) return guide.paths;
  const path = (d, subtle = false) => ({d, subtle});
  switch (guide.type) {
    case 'thirds':
      return [path('M333.333 0V625 M666.667 0V625 M0 208.333H1000 M0 416.667H1000')];
    case 'center':
      return [path('M500 0V625')];
    case 'vanishing': {
      const [x, y] = guide.focus || [500, 281];
      return [path(`M0 0L${x} ${y}L1000 625 M1000 0L${x} ${y}L0 625`)];
    }
    case 'radial': {
      const [x, y] = guide.focus || [500, 312.5];
      return Array.from({length:12}, (_, i) => {
        const angle = i * Math.PI / 6;
        return path(`M${x} ${y}L${x + 1100 * Math.cos(angle)} ${y + 1100 * Math.sin(angle)}`);
      });
    }
    case 'platform':
      return [path('M220 0L700 350L130 625 M0 470L700 350')];
    case 'diagonal':
      return [path('M0 500L1000 156')];
    case 'cross-diagonal':
      return [path('M0 512L1000 112 M0 94L650 375')];
    case 'frame':
      return [path('M160 75H840V550H160Z')];
    case 'curve':
      return [path('M700 625C800 460 300 430 350 344S560 240 500 156')];
    case 'golden': {
      // True golden rectangles; quarter-circle arcs form the familiar approximation.
      const phi = (1 + Math.sqrt(5)) / 2;
      let x = 0, y = (625 - 1000 / phi) / 2, w = 1000, h = 1000 / phi;
      const result = [];
      for (let i = 0; i < 8; i++) {
        const s = Math.min(w, h);
        let sx, sy, arc;
        switch (i % 4) {
          case 0:
            sx = x; sy = y;
            arc = `M${x} ${y + s}A${s} ${s} 0 0 1 ${x + s} ${y}`;
            x += s; w -= s; break;
          case 1:
            sx = x; sy = y;
            arc = `M${x} ${y}A${s} ${s} 0 0 1 ${x + s} ${y + s}`;
            y += s; h -= s; break;
          case 2:
            sx = x + w - s; sy = y;
            arc = `M${sx + s} ${sy}A${s} ${s} 0 0 1 ${sx} ${sy + s}`;
            w -= s; break;
          default:
            sx = x; sy = y + h - s;
            arc = `M${sx + s} ${sy + s}A${s} ${s} 0 0 1 ${sx} ${sy}`;
            h -= s;
        }
        result.push(path(`M${sx} ${sy}h${s}v${s}h-${s}Z`, true), path(arc));
      }
      return result.map(item => ({...item, transform:'translate(1000 625) scale(-1 -1)'}));
    }
    default: return [];
  }
}
