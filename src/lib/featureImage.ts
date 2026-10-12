/**
 * Branded feature image for a post or product, laid out like a marketing banner: logo, category pill, benefit headline,
 * subtitle and key names on the left; a laptop and a phone on the right. The copy is written by the AI from the same brief
 * as the article/product text, so the picture says what the text says.
 *
 * The devices show the user's own screenshots when given; otherwise an abstract dashboard (shapes only, no numbers or text)
 * so nothing fabricated is ever drawn. Drawn in the browser and saved through the normal Media Library upload flow.
 */
import { mediaApi, type CmsMedia } from "./api";

export const FEATURE_IMAGE_SIZE = { width: 1200, height: 630 } as const;
const LOGO_URL = "/artify-logo.png";

export interface FeatureImageInput {
  /** Used for the file name, display name and alt text. */
  title: string;
  headline: string;
  subtitle?: string;
  label?: string;
  tagline?: string;
  screenshots?: { desktop?: Blob; mobile?: Blob };
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
      // The line is full. If it is the last one allowed, it takes the rest of the text and ends with an ellipsis.
      if (lines.length === maxLines - 1) return [...lines, fit(measure, [current, ...words.slice(i)].join(" "), maxWidth)];
      lines.push(current);
      current = words[i]!;
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
const INK = "#0b1033";
const SLATE = "#475569";
const ACCENT = "#4f46e5";

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    img.onload = () => { if (typeof src !== "string") URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (typeof src !== "string") URL.revokeObjectURL(url); reject(new Error("image failed to load")); };
    img.src = url;
  });
}

/** Cover-fit an image into a box, anchored to the top (screenshots read best from the top). */
function drawCover(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y, dw, dh);
}

function bars(ctx: Ctx, x: number, y: number, widths: number[], h: number, gap: number, color: string) {
  ctx.fillStyle = color;
  widths.forEach((w, i) => { rr(ctx, x, y + i * (h + gap), w, h, h / 2); ctx.fill(); });
}

/** Abstract desktop dashboard: sidebar, top bar, KPI cards, line + bar charts. Shapes only. */
function drawDesktopWireframe(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.save();
  rr(ctx, x, y, w, h, 10);
  ctx.clip();
  ctx.fillStyle = "#eef2f7";
  ctx.fillRect(x, y, w, h);
  const sb = Math.round(w * 0.17);
  ctx.fillStyle = "#0f1a36";
  ctx.fillRect(x, y, sb, h);
  ctx.fillStyle = "#22d3ee";
  rr(ctx, x + 10, y + 12, 26, 8, 4); ctx.fill();
  ctx.fillStyle = "#e2e8f0";
  rr(ctx, x + 40, y + 12, sb - 52, 8, 4); ctx.fill();
  ctx.fillStyle = "#2563eb";
  rr(ctx, x + 8, y + 42, sb - 16, 12, 5); ctx.fill();
  for (let i = 0; i < 9; i++) { ctx.fillStyle = "#1e2b52"; rr(ctx, x + 12, y + 66 + i * 17, sb - 30 - (i % 3) * 8, 6, 3); ctx.fill(); }
  const mx = x + sb;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(mx, y, w - sb, 26);
  ctx.fillStyle = "#cbd5e1";
  rr(ctx, mx + 12, y + 9, 70, 8, 4); ctx.fill();
  rr(ctx, mx + 130, y + 7, 110, 12, 6); ctx.fill();
  ctx.fillStyle = "#2563eb";
  rr(ctx, w + x - 92, y + 7, 70, 12, 6); ctx.fill();
  const cw = (w - sb - 16 * 2 - 3 * 8) / 4;
  const tints = ["#2563eb", "#f59e0b", "#10b981", "#64748b"];
  tints.forEach((c, i) => {
    const cx = mx + 16 + i * (cw + 8);
    ctx.fillStyle = "#ffffff"; rr(ctx, cx, y + 38, cw, 44, 6); ctx.fill();
    ctx.fillStyle = c; rr(ctx, cx, y + 38, 3, 44, 2); ctx.fill();
    bars(ctx, cx + 10, y + 46, [cw * 0.5], 5, 0, "#cbd5e1");
    bars(ctx, cx + 10, y + 60, [cw * 0.7], 10, 0, c);
  });
  const chX = mx + 16, chY = y + 94, chW = w - sb - 32, chH = h - 94 - 14;
  ctx.fillStyle = "#ffffff"; rr(ctx, chX, chY, chW, chH, 8); ctx.fill();
  ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(chX + 14, chY + 22 + i * 28); ctx.lineTo(chX + chW - 14, chY + 22 + i * 28); ctx.stroke(); }
  const groups = 5, gw = (chW - 60) / groups;
  for (let i = 0; i < groups; i++) {
    const bx = chX + 30 + i * gw;
    const a = [50, 95, 30, 70, 85][i]!, b = [28, 40, 22, 38, 30][i]!;
    ctx.fillStyle = "#3b82f6"; rr(ctx, bx, chY + chH - 18 - a, gw * 0.28, a, 2); ctx.fill();
    ctx.fillStyle = "#f59e0b"; rr(ctx, bx + gw * 0.32, chY + chH - 18 - b, gw * 0.28, b, 2); ctx.fill();
  }
  ctx.strokeStyle = "#10b981"; ctx.lineWidth = 2.5; ctx.beginPath();
  const pts = [[0.06, 0.62], [0.28, 0.3], [0.5, 0.8], [0.74, 0.4], [0.95, 0.5]] as const;
  pts.forEach(([px, py], i) => { const X = chX + 20 + px * (chW - 40), Y = chY + 20 + py * (chH - 50); if (i === 0) ctx.moveTo(X, Y); else { const [qx, qy] = pts[i - 1]!; const PX = chX + 20 + qx * (chW - 40), PY = chY + 20 + qy * (chH - 50); ctx.bezierCurveTo((PX + X) / 2, PY, (PX + X) / 2, Y, X, Y); } });
  ctx.stroke();
  ctx.restore();
}

/** Abstract phone dashboard: header, scope card, period chips, KPI tiles, bottom navigation and a floating action button. */
function drawPhoneWireframe(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.save();
  rr(ctx, x, y, w, h, 26);
  ctx.clip();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, w, 46);
  ctx.fillStyle = "#0f172a";
  for (let i = 0; i < 3; i++) { rr(ctx, x + 16, y + 20 + i * 5, 14, 2, 1); ctx.fill(); }
  ctx.fillStyle = "#22d3ee"; rr(ctx, x + 40, y + 19, 18, 10, 4); ctx.fill();
  ctx.fillStyle = "#0f172a"; rr(ctx, x + 64, y + 20, 54, 8, 4); ctx.fill();
  ctx.fillStyle = "#0f172a"; rr(ctx, x + w - 78, y + 14, 38, 20, 10); ctx.fill();
  ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(x + w - 22, y + 24, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; rr(ctx, x + 12, y + 58, w - 24, 52, 10); ctx.fill();
  bars(ctx, x + 22, y + 68, [60], 6, 0, "#cbd5e1");
  ctx.fillStyle = "#f1f5f9"; rr(ctx, x + 22, y + 82, w - 44, 20, 8); ctx.fill();
  ctx.fillStyle = "#0f172a"; rr(ctx, x + 12, y + 120, 54, 18, 9); ctx.fill();
  [64, 56, 64].forEach((cw, i) => { ctx.fillStyle = "#e2e8f0"; rr(ctx, x + 74 + i * 62, y + 120, cw, 18, 9); ctx.fill(); });
  const tw = (w - 24 - 8) / 2;
  const tiles = [["#2563eb", 0], ["#2563eb", 1], ["#f59e0b", 2], ["#10b981", 3]] as const;
  tiles.forEach(([c, i]) => {
    const tx = x + 12 + (i % 2) * (tw + 8), ty = y + 152 + Math.floor(i / 2) * 70;
    ctx.fillStyle = "#ffffff"; rr(ctx, tx, ty, tw, 60, 8); ctx.fill();
    bars(ctx, tx + 10, ty + 10, [tw * 0.5], 5, 0, "#cbd5e1");
    bars(ctx, tx + 10, ty + 24, [tw * 0.72], 11, 0, c);
    bars(ctx, tx + 10, ty + 44, [tw * 0.6], 4, 0, "#e2e8f0");
  });
  ctx.fillStyle = "#ffffff"; rr(ctx, x + 12, y + 296, w - 24, 44, 8); ctx.fill();
  bars(ctx, x + 22, y + 306, [50, 80], 5, 8, "#cbd5e1");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y + h - 56, w, 56);
  ctx.strokeStyle = "#e2e8f0"; ctx.beginPath(); ctx.moveTo(x, y + h - 56); ctx.lineTo(x + w, y + h - 56); ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const nx = x + 24 + i * ((w - 48) / 4);
    ctx.fillStyle = i === 0 ? ACCENT : "#94a3b8"; rr(ctx, nx - 8, y + h - 44, 16, 16, 5); ctx.fill();
    ctx.fillStyle = i === 0 ? ACCENT : "#cbd5e1"; rr(ctx, nx - 12, y + h - 22, 24, 4, 2); ctx.fill();
  }
  ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(x + w - 30, y + h - 82, 20, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + w - 30, y + h - 91); ctx.lineTo(x + w - 30, y + h - 73); ctx.moveTo(x + w - 39, y + h - 82); ctx.lineTo(x + w - 21, y + h - 82); ctx.stroke();
  ctx.restore();
}

export async function renderFeatureImage(input: FeatureImageInput): Promise<Blob> {
  const { width, height } = FEATURE_IMAGE_SIZE;
  try { await Promise.all([document.fonts.load(`800 60px ${FONT}`), document.fonts.load(`500 22px ${FONT}`), document.fonts.load(`700 15px ${FONT}`)]); } catch { /* system fonts */ }

  const [logo, desktopShot, mobileShot] = await Promise.all([
    loadImage(LOGO_URL).catch(() => null),
    input.screenshots?.desktop ? loadImage(input.screenshots.desktop).catch(() => null) : Promise.resolve(null),
    input.screenshots?.mobile ? loadImage(input.screenshots.mobile).catch(() => null) : Promise.resolve(null),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw images.");

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#eef2ff");
  bg.addColorStop(1, "#f8faff");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.8, height * 0.1, 0, width * 0.8, height * 0.1, 520);
  glow.addColorStop(0, "rgba(129,140,248,0.30)");
  glow.addColorStop(1, "rgba(129,140,248,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // ---- devices (drawn first so the text column sits on top)
  const shadow = (on: boolean) => { ctx.shadowColor = on ? "rgba(15,23,42,0.28)" : "transparent"; ctx.shadowBlur = on ? 38 : 0; ctx.shadowOffsetY = on ? 18 : 0; };
  const lx = 600, ly = 120, lw = 540, lh = 330;
  shadow(true);
  ctx.fillStyle = "#0f172a"; rr(ctx, lx, ly, lw, lh, 16); ctx.fill();
  shadow(false);
  const base = ctx.createLinearGradient(0, ly + lh, 0, ly + lh + 18);
  base.addColorStop(0, "#e2e8f0"); base.addColorStop(1, "#b6c0cf");
  ctx.fillStyle = base; rr(ctx, lx - 52, ly + lh, lw + 104, 18, 9); ctx.fill();
  ctx.fillStyle = "#94a3b8"; rr(ctx, lx + lw / 2 - 44, ly + lh, 88, 5, 3); ctx.fill();
  if (desktopShot) { ctx.save(); rr(ctx, lx + 8, ly + 8, lw - 16, lh - 16, 10); ctx.clip(); drawCover(ctx, desktopShot, lx + 8, ly + 8, lw - 16, lh - 16); ctx.restore(); }
  else drawDesktopWireframe(ctx, lx + 8, ly + 8, lw - 16, lh - 16);

  const px = 930, py = 168, pw = 215, ph = 420;
  shadow(true);
  ctx.fillStyle = "#0f172a"; rr(ctx, px, py, pw, ph, 36); ctx.fill();
  shadow(false);
  if (mobileShot) { ctx.save(); rr(ctx, px + 8, py + 8, pw - 16, ph - 16, 28); ctx.clip(); drawCover(ctx, mobileShot, px + 8, py + 8, pw - 16, ph - 16); ctx.restore(); }
  else drawPhoneWireframe(ctx, px + 8, py + 8, pw - 16, ph - 16);

  // ---- left column
  const colX = 64, colW = 470;
  if (logo) {
    const lh2 = 56;
    ctx.drawImage(logo, colX - 4, 48, (logo.width / logo.height) * lh2, lh2);
  } else {
    ctx.fillStyle = INK; ctx.font = `800 26px ${FONT}`; ctx.textBaseline = "middle"; ctx.fillText("Artify Solutions", colX, 76);
  }

  let y = 150;
  const label = (input.label ?? "").trim().toUpperCase();
  if (label) {
    ctx.font = `700 15px ${FONT}`;
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "2.5px";
    const w = Math.min(colW, ctx.measureText(label).width + 44);
    ctx.fillStyle = ACCENT; rr(ctx, colX, y, w, 36, 18); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.textBaseline = "middle"; ctx.fillText(label, colX + 22, y + 19);
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
    y += 36 + 28;
  }

  let size = 58;
  let lines: string[] = [];
  for (; size >= 36; size -= 3) {
    ctx.font = `800 ${size}px ${FONT}`;
    lines = wrapLines((t) => ctx.measureText(t).width, input.headline, colW, 3);
    if (lines.length < 3 || !lines[2]!.endsWith("…")) break;
  }
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.fillStyle = INK; ctx.textBaseline = "alphabetic";
  lines.forEach((line, i) => ctx.fillText(line, colX, y + size * 0.95 + i * size * 1.08));
  y += lines.length * size * 1.08 + 16;

  const subtitle = (input.subtitle ?? "").trim();
  if (subtitle) {
    ctx.font = `500 21px ${FONT}`;
    ctx.fillStyle = SLATE;
    const room = Math.max(1, Math.min(2, Math.floor((height - 112 - y) / 30)));
    wrapLines((t) => ctx.measureText(t).width, subtitle, colW + 40, room).forEach((line, i) => ctx.fillText(line, colX, y + 20 + i * 30));
  }

  const tagline = (input.tagline ?? "").trim();
  if (tagline) {
    ctx.font = `700 24px ${FONT}`;
    ctx.fillStyle = ACCENT; ctx.textBaseline = "alphabetic";
    ctx.fillText(wrapLines((t) => ctx.measureText(t).width, tagline, colW + 40, 1)[0] ?? "", colX, height - 54);
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image."))), "image/png"));
}

const fileSafe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "feature";

/** Draw the banner and add it to the Media Library. The caller attaches the returned asset as the featured image (which also makes it public). */
export async function createFeatureImage(input: FeatureImageInput): Promise<CmsMedia> {
  const blob = await renderFeatureImage(input);
  const file = new File([blob], `${fileSafe(input.title)}-feature.png`, { type: "image/png" });
  return mediaApi.uploadFile(file, { mimeType: "image/png", displayName: `${input.title} - feature image`.slice(0, 200), altText: input.title.slice(0, 200) });
}
