/**
 * Generates the app icon set from a single source of truth (the slashed-zero
 * mark rendered by `components/layout/brand-mark.tsx`) in the Chaos Zero
 * palette:
 *
 *   src/app/icon.svg              transparent SVG favicon, dark/light aware
 *   src/app/favicon.ico           legacy fallback, 16/32/48 RGBA PNG entries
 *   src/app/apple-icon.png        180x180 opaque touch icon
 *   public/icon-192.png           PWA/manifest tile
 *   public/icon-512.png           PWA/manifest tile
 *   public/icon-maskable-512.png  maskable tile (glyph inside the safe zone)
 *
 * Regenerate with: pnpm icons
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

// Geometry of the slashed zero (24x24 grid), as rendered by the header logo:
// a ring (the zero), a short internal slash, and the market's two sides as
// satellites — YES green top-right, NO rose bottom-left, on the slash axis.
const SLASH = "M14.8 8.5 9.2 15.5";

// Palette from globals.css.
const DARK = { arc: "#67e8f9", higher: "#34e3a5", lower: "#ff6584" };
const LIGHT = { arc: "#0891b2", higher: "#0ea975", lower: "#e14b6d" };
// Baked into the ICO fallback, which cannot adapt: mid tones that stay
// legible on both light and dark tab bars.
const UNIVERSAL = { arc: "#22d3ee", higher: "#29cf93", lower: "#f75c7e" };

/** Slashed-zero glyph on the 24x24 grid with explicit colors (for rasterization). */
function glyph(colors, { stroke = 2.5, ringR = 8, satR = 2.2 } = {}) {
  return `
    <g fill="none" stroke="${colors.arc}" stroke-width="${stroke}" stroke-linecap="round">
      <circle cx="12" cy="12" r="${ringR}"/>
      <path d="${SLASH}"/>
    </g>
    <circle cx="18.9" cy="3.4" r="${satR}" fill="${colors.higher}"/>
    <circle cx="5.1" cy="20.6" r="${satR}" fill="${colors.lower}"/>`;
}

// --- icon.svg: transparent, adapts to the browser's color scheme ----------

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <style>
    .a { stroke: ${DARK.arc}; }
    .h { fill: ${DARK.higher}; }
    .l { fill: ${DARK.lower}; }
    @media (prefers-color-scheme: light) {
      .a { stroke: ${LIGHT.arc}; }
      .h { fill: ${LIGHT.higher}; }
      .l { fill: ${LIGHT.lower}; }
    }
  </style>
  <g fill="none" stroke-width="2.5" stroke-linecap="round">
    <circle class="a" cx="12" cy="12" r="8"/>
    <path class="a" d="${SLASH}"/>
  </g>
  <circle class="h" cx="18.9" cy="3.4" r="2.2"/>
  <circle class="l" cx="5.1" cy="20.6" r="2.2"/>
</svg>
`;

// --- favicon.ico: 16/32/48 transparent PNGs in an ICO container ------------

async function renderPng(size, colors, tuning) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${glyph(colors, tuning)}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Minimal ICO container: ICONDIR + ICONDIRENTRYs + PNG payloads. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + 16 * entries.length;
  const dirs = entries.map(({ size, png }) => {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0); // width
    dir.writeUInt8(size >= 256 ? 0 : size, 1); // height
    dir.writeUInt8(0, 2); // no palette
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += png.length;
    return dir;
  });

  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.png)]);
}

// --- apple-icon.png: opaque void tile (iOS composites black behind
// transparency, so an explicit background is the safe choice) ---------------

const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <defs>
    <radialGradient id="glow" cx="30%" cy="16%" r="90%">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.28"/>
      <stop offset="55%" stop-color="#22d3ee" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="180" height="180" fill="#0a1118"/>
  <rect width="180" height="180" fill="url(#glow)"/>
  <g transform="translate(90 90) scale(4.6) translate(-12 -12)">${glyph(DARK)}</g>
</svg>`;

// --- manifest icons: opaque void tiles for PWA launchers ------------------
// glyphScale is the fraction of the tile the 24px glyph grid spans; maskable
// icons keep the glyph inside the central safe zone (~80% circle).

function tileSvg(size, glyphScale) {
  const scale = (size * glyphScale) / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="glow" cx="30%" cy="16%" r="90%">
      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.28"/>
      <stop offset="55%" stop-color="#22d3ee" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="#0a1118"/>
  <rect width="${size}" height="${size}" fill="url(#glow)"/>
  <g transform="translate(${size / 2} ${size / 2}) scale(${scale}) translate(-12 -12)">${glyph(DARK)}</g>
</svg>`;
}

async function main() {
  await mkdir(appDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  await writeFile(path.join(appDir, "icon.svg"), iconSvg);

  const icoEntries = await Promise.all(
    [
      // Slightly heavier strokes and larger dots at 16px for legibility.
      { size: 16, tuning: { stroke: 3, ringR: 7.6, satR: 2.6 } },
      { size: 32, tuning: {} },
      { size: 48, tuning: {} },
    ].map(async ({ size, tuning }) => ({
      size,
      png: await renderPng(size, UNIVERSAL, tuning),
    })),
  );
  await writeFile(path.join(appDir, "favicon.ico"), buildIco(icoEntries));

  const applePng = await sharp(Buffer.from(appleSvg)).png().toBuffer();
  await writeFile(path.join(appDir, "apple-icon.png"), applePng);

  const manifestIcons = [
    { file: "icon-192.png", size: 192, glyphScale: 0.62 },
    { file: "icon-512.png", size: 512, glyphScale: 0.62 },
    { file: "icon-maskable-512.png", size: 512, glyphScale: 0.44 },
  ];
  for (const { file, size, glyphScale } of manifestIcons) {
    const png = await sharp(Buffer.from(tileSvg(size, glyphScale)))
      .png()
      .toBuffer();
    await writeFile(path.join(publicDir, file), png);
  }

  console.log(
    "Wrote icon.svg, favicon.ico (16/32/48), apple-icon.png, icon-192/512.png, icon-maskable-512.png",
  );
}

await main();
