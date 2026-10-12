/**
 * Branded feature image for a post or product: a 1200x630 card (the OG/social size) drawn in the browser and saved through the
 * normal Media Library upload flow. No model call is involved, so it is fast, free and always on-brand. The accent colour is
 * derived from the title, so different items look related but not identical.
 */
import { mediaApi, type CmsMedia } from "./api";

export const FEATURE_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export interface Palette { from: string; to: string; accent: string }

const PALETTES: Palette[] = [
  { from: "#0b0a1a", to: "#3b1d8f", accent: "#a78bfa" }, // violet
  { from: "#0a1030", to: "#2b3aa8", accent: "#818cf8" }, // indigo
  { from: "#06181f", to: "#0e6f86", accent: "#22d3ee" }, // teal
  { from: "#160a24", to: "#7a1f7a", accent: "#e879f9" }, // magenta
];

/** Stable pick from the text, so regenerating the same title gives the same colours. */
export function pickPalette(seed: string): Palette {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length]!;
}

/** Greedy word wrap with an ellipsis on the last allowed line. `measure` is injected so this can be tested without a canvas. */
export function wrapLines(measure: (text: string) => number, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i]!;
    if (measure(next) <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = words[i]!;
      if (lines.length === maxLines - 1) {
        const rest = [current, ...words.slice(i + 1)].join(" ");
        lines.push(fit(measure, rest, maxWidth));
        return lines;
      }
    }
  }
  if (current) lines.push(fit(measure, current, maxWidth));
  return lines.slice(0, maxLines);
}

function fit(measure: (t: string) => number, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

const FONT = `'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif`;

export interface FeatureImageInput { title: string; subtitle?: string; label?: string }

export async function renderFeatureImage(input: FeatureImageInput): Promise<Blob> {
  const { width, height } = FEATURE_IMAGE_SIZE;
  try { await Promise.all([document.fonts.load(`800 64px ${FONT}`), document.fonts.load(`500 28px ${FONT}`)]); } catch { /* fall back to system fonts */ }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw images.");
  const palette = pickPalette(input.title);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, palette.from);
  bg.addColorStop(1, palette.to);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const glow = (x: number, y: number, r: number, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `${palette.accent}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`);
    g.addColorStop(1, `${palette.accent}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  };
  glow(width * 0.92, height * 0.08, 520, 0.42);
  glow(width * 0.05, height * 0.98, 460, 0.22);

  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let x = 40; x < width; x += 40) for (let y = 40; y < height; y += 40) ctx.fillRect(x, y, 2, 2);

  const pad = 72;
  const textWidth = width - pad * 2 - 80;

  // Label pill
  const label = (input.label ?? "").trim().toUpperCase();
  if (label) {
    ctx.font = `700 22px ${FONT}`;
    const w = ctx.measureText(label).width + 40;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.roundRect(pad, pad, w, 44, 22);
    ctx.fill();
    ctx.fillStyle = palette.accent;
    ctx.textBaseline = "middle";
    ctx.fillText(label, pad + 20, pad + 23);
  }

  // Title (shrinks until it fits in three lines)
  let size = 68;
  let lines: string[] = [];
  for (; size >= 44; size -= 4) {
    ctx.font = `800 ${size}px ${FONT}`;
    lines = wrapLines((t) => ctx.measureText(t).width, input.title, textWidth, 3);
    if (lines.length < 3 || !lines[2]!.endsWith("…")) break;
  }
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  const titleTop = label ? 190 : 150;
  lines.forEach((line, i) => ctx.fillText(line, pad, titleTop + size + i * (size * 1.14)));

  // Subtitle
  const subtitle = (input.subtitle ?? "").trim();
  if (subtitle) {
    ctx.font = `500 28px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    const subTop = titleTop + size + lines.length * (size * 1.14) + 18;
    const room = Math.max(1, Math.min(2, Math.floor((height - 140 - subTop) / 38)));
    const subLines = wrapLines((t) => ctx.measureText(t).width, subtitle, textWidth, room);
    subLines.forEach((line, i) => ctx.fillText(line, pad, subTop + 28 + i * 38));
  }

  // Accent rule + brand footer
  ctx.fillStyle = palette.accent;
  ctx.fillRect(pad, height - 118, 72, 5);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.roundRect(pad, height - 92, 44, 44, 12);
  ctx.fill();
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(pad + 22, height - 70, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 28px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText("Artify Solutions", pad + 60, height - 69);
  ctx.font = `500 24px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.textAlign = "right";
  ctx.fillText("artifysols.com", width - pad, height - 69);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image."))), "image/png"));
}

const fileSafe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "feature";

/** Draw the card and add it to the Media Library. The caller attaches the returned asset as the featured image (which also makes it public). */
export async function createFeatureImage(input: FeatureImageInput): Promise<CmsMedia> {
  const blob = await renderFeatureImage(input);
  const file = new File([blob], `${fileSafe(input.title)}-feature.png`, { type: "image/png" });
  return mediaApi.uploadFile(file, { mimeType: "image/png", displayName: `${input.title} - feature image`.slice(0, 200), altText: input.title.slice(0, 200) });
}
