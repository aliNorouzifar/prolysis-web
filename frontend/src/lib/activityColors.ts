// Consistent activity colors across views: the same activity always gets the same
// color (assignment over the sorted union of activities — color follows the entity).
// Identity is never color-alone: chevrons and legend chips always carry the label.

// Validated categorical palette (dataviz six-checks, light surface).
const BASE = [
  "#4263eb", "#0ca678", "#e8590c", "#9c36b5", "#1098ad", "#d6336c", "#5c940d",
];
// A lighter companion step per hue doubles the distinct fills to 14.
const LIGHTER = [
  "#748ffc", "#38d9a9", "#ffa94d", "#da77f2", "#66d9e8", "#faa2c1", "#a9e34b",
];

export interface ActivityStyle {
  bg: string;
  ink: string; // label color with sufficient contrast on bg
}

function inkFor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#212529" : "#ffffff";
}

/** Deterministic color assignment for a set of activities (sorted union). */
export function activityColors(activities: string[]): Map<string, ActivityStyle> {
  const sorted = [...new Set(activities)].sort((a, b) => a.localeCompare(b));
  const map = new Map<string, ActivityStyle>();
  sorted.forEach((act, i) => {
    const ramp = Math.floor(i / BASE.length) % 2 === 0 ? BASE : LIGHTER;
    const bg = ramp[i % BASE.length];
    map.set(act, { bg, ink: inkFor(bg) });
  });
  return map;
}
