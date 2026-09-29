import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_URL } from "@/lib/site";

/**
 * The social share card (Open Graph + Twitter), generated once at build time.
 * Shared by `app/opengraph-image.tsx` and `app/twitter-image.tsx` so both
 * networks get the identical, brand-correct image.
 */

export const OG_SIZE = { width: 1200, height: 630 };

export const OG_ALT =
  "Chaos Zero — bet YES or NO on whether each Cosmic Signature round ends with more gestures than the last, in CST on Arbitrum One.";

// Palette from globals.css (Satori cannot resolve CSS variables).
const VOID = "#060a10";
const INK = "#ecf5f9";
const INK_DIM = "#99b3c1";
const SIGNAL = "#22d3ee";
const SIGNAL_BRIGHT = "#67e8f9";
const HIGHER = "#34e3a5";
const LOWER = "#ff6584";

// The slashed-zero brand mark, mirroring `layout/brand-mark.tsx`.
function BrandGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx={12} cy={12} r={8} stroke={SIGNAL_BRIGHT} strokeWidth={2.5} />
      <path d="M14.8 8.5 9.2 15.5" stroke={SIGNAL_BRIGHT} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={18.9} cy={3.4} r={2.2} fill={HIGHER} />
      <circle cx={5.1} cy={20.6} r={2.2} fill={LOWER} />
    </svg>
  );
}

function Pill({ color, children }: { color: string; children: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        borderRadius: 18,
        border: `2px solid ${color}55`,
        backgroundColor: `${color}1f`,
        color,
        fontSize: 28,
        padding: "12px 28px",
      }}
    >
      {children}
    </div>
  );
}

export async function ogCardResponse(): Promise<ImageResponse> {
  // Vendored (SIL OFL 1.1) so the build never fetches fonts from the network.
  const spaceGrotesk = await readFile(
    join(process.cwd(), "src/assets/fonts/SpaceGrotesk-Bold.ttf"),
  );

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 64,
        backgroundColor: VOID,
        backgroundImage:
          `radial-gradient(720px 420px at 8% -12%, ${SIGNAL}33, transparent 60%), ` +
          `radial-gradient(560px 360px at 96% 6%, ${HIGHER}1f, transparent 60%), ` +
          `radial-gradient(640px 440px at 55% 118%, ${LOWER}1c, transparent 62%)`,
        fontFamily: "Space Grotesk",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 84,
            height: 84,
            borderRadius: 24,
            backgroundColor: `${SIGNAL}26`,
          }}
        >
          <BrandGlyph size={52} />
        </div>
        <div style={{ display: "flex", fontSize: 44, color: INK }}>
          <span>Chaos</span>
          <span style={{ color: SIGNAL_BRIGHT }}>Zero</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{ display: "flex", fontSize: 84, lineHeight: 1.04, color: INK, maxWidth: 1020 }}
        >
          Bet YES or NO on every Cosmic Signature round
        </div>
        <div
          style={{ display: "flex", fontSize: 32, lineHeight: 1.3, color: INK_DIM, maxWidth: 980 }}
        >
          Will this round end with more gestures than the last? Zero oracles, zero admin keys, zero
          custody — settled in CST.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 18 }}>
          <Pill color={HIGHER}>YES pays 1 CST</Pill>
          <Pill color={LOWER}>NO pays 1 CST</Pill>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: INK_DIM }}>
          {new URL(SITE_URL).host}
        </div>
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [{ name: "Space Grotesk", data: spaceGrotesk, weight: 700, style: "normal" }],
    },
  );
}
