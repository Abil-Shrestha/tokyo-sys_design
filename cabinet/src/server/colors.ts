import type { ColorSwatch } from "../shared/types";

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb({ l, a, b }: Lab): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;
  const R = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const G = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const B = x * 0.0557 + y * -0.204 + z * 1.057;
  return [linearToSrgb(R), linearToSrgb(G), linearToSrgb(B)];
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

export function deltaE(x: Lab, y: Lab): number {
  return Math.sqrt((x.l - y.l) ** 2 + (x.a - y.a) ** 2 + (x.b - y.b) ** 2);
}

/** Reference swatches used to put every extracted colour into a family. */
const FAMILIES: Record<string, string[]> = {
  red: ["#d32f2f", "#e53935", "#b71c1c", "#ff1744", "#c62828", "#8b0000", "#ff3b30", "#a4161a"],
  orange: ["#ff9800", "#f57c00", "#ff6f00", "#e65100", "#ffa726", "#ff7043", "#e2711d"],
  yellow: ["#ffeb3b", "#fdd835", "#fbc02d", "#ffd600", "#fff176", "#f2d024", "#c9a43a"],
  green: ["#4caf50", "#388e3c", "#2e7d32", "#8bc34a", "#1b5e20", "#689f38", "#a5d6a7", "#556b2f", "#9acd32"],
  teal: ["#009688", "#00796b", "#26a69a", "#004d40", "#00bcd4", "#4dd0e1", "#00acc1", "#80cbc4"],
  blue: ["#2196f3", "#1976d2", "#0d47a1", "#64b5f6", "#3f51b5", "#1a237e", "#90caf9", "#1d2c5e", "#4169e1"],
  purple: ["#9c27b0", "#7b1fa2", "#673ab7", "#4a148c", "#b39ddb", "#ba68c8", "#5e35b1"],
  pink: ["#e91e63", "#f06292", "#f8bbd0", "#ec407a", "#ff80ab", "#d81b60", "#f4a6c0", "#c2185b"],
  brown: ["#795548", "#5d4037", "#8d6e63", "#6d4c41", "#3e2723", "#a0522d", "#8b5a2b", "#6f4e37"],
  beige: ["#f5f5dc", "#e8d8b8", "#d2b48c", "#efe6d8", "#e3d3b5", "#c8b79e", "#f3ead3"],
  black: ["#000000", "#121212", "#1c1c1c", "#262626"],
  white: ["#ffffff", "#fafafa", "#f4f4f2", "#ececec"],
  gray: ["#9e9e9e", "#757575", "#bdbdbd", "#616161", "#424242", "#cfd8dc", "#607d8b", "#d6d6d6"],
};

const FAMILY_ALIASES: Record<string, string> = {
  grey: "gray",
  navy: "blue",
  violet: "purple",
  magenta: "pink",
  cyan: "teal",
  cream: "beige",
  gold: "yellow",
};

const FAMILY_LABS: { name: string; lab: Lab }[] = Object.entries(FAMILIES).flatMap(([name, hexes]) =>
  hexes.map((hex) => ({ name, lab: hexToLab(hex) })),
);

export function colorFamily(nameOrAlias: string): string | null {
  const n = nameOrAlias.toLowerCase();
  if (FAMILIES[n]) return n;
  return FAMILY_ALIASES[n] ?? null;
}

export function classifyColor(lab: Lab): string {
  const chroma = Math.hypot(lab.a, lab.b);
  // Near-neutral colours are judged on lightness alone.
  if (chroma < 9) {
    if (lab.l < 18) return "black";
    if (lab.l > 92) return "white";
    if (lab.l > 78 && Math.abs(lab.b) > 3 && lab.b > 0) return "beige";
    return "gray";
  }
  let best = FAMILY_LABS[0];
  let bestD = Infinity;
  for (const f of FAMILY_LABS) {
    const d = deltaE(lab, f.lab);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best.name;
}

/**
 * Extracts a small palette from raw RGBA pixels using k-means in Lab space.
 * Transparent pixels are ignored. Returns up to `max` swatches by coverage.
 */
export function extractPalette(pixels: Uint8Array | Buffer, channels: number, max = 5): ColorSwatch[] {
  const points: Lab[] = [];
  for (let i = 0; i + channels - 1 < pixels.length; i += channels) {
    if (channels === 4 && pixels[i + 3] < 128) continue;
    points.push(rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]));
  }
  if (!points.length) return [];

  const k = Math.min(8, points.length);
  // Deterministic k-means++ style seeding: start from the first point, then
  // repeatedly take the point farthest from all current centres.
  const centres: Lab[] = [points[Math.floor(points.length / 2)]];
  const dist = new Float64Array(points.length).fill(Infinity);
  while (centres.length < k) {
    const last = centres[centres.length - 1];
    let far = 0;
    for (let i = 0; i < points.length; i++) {
      const d = deltaE(points[i], last);
      if (d < dist[i]) dist[i] = d;
      if (dist[i] > dist[far]) far = i;
    }
    if (dist[far] < 4) break;
    centres.push(points[far]);
  }

  const assign = new Int32Array(points.length);
  for (let iter = 0; iter < 10; iter++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = deltaE(points[i], centres[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    const sums = centres.map(() => ({ l: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i]];
      s.l += points[i].l;
      s.a += points[i].a;
      s.b += points[i].b;
      s.n++;
    }
    for (let c = 0; c < centres.length; c++) {
      const s = sums[c];
      if (s.n) centres[c] = { l: s.l / s.n, a: s.a / s.n, b: s.b / s.n };
    }
    if (!moved && iter > 0) break;
  }

  const counts = new Array(centres.length).fill(0);
  for (let i = 0; i < points.length; i++) counts[assign[i]]++;
  let clusters = centres.map((lab, i) => ({ lab, n: counts[i] })).filter((c) => c.n > 0);

  // Merge clusters that look the same to a person.
  clusters.sort((x, y) => y.n - x.n);
  const merged: { lab: Lab; n: number }[] = [];
  for (const c of clusters) {
    const near = merged.find((m) => deltaE(m.lab, c.lab) < 12);
    if (near) {
      const n = near.n + c.n;
      near.lab = {
        l: (near.lab.l * near.n + c.lab.l * c.n) / n,
        a: (near.lab.a * near.n + c.lab.a * c.n) / n,
        b: (near.lab.b * near.n + c.lab.b * c.n) / n,
      };
      near.n = n;
    } else {
      merged.push({ ...c });
    }
  }
  clusters = merged.sort((x, y) => y.n - x.n);
  const total = points.length;
  return clusters
    .filter((c) => c.n / total >= 0.03)
    .slice(0, max)
    .map((c) => {
      const [r, g, b] = labToRgb(c.lab);
      return { hex: rgbToHex(r, g, b), weight: Math.round((c.n / total) * 1000) / 1000 };
    });
}
