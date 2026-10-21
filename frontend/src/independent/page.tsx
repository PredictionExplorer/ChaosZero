import { Suspense } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ArrowRight, MoveUpRight } from "lucide-react";
import { Providers } from "@/app/providers";
import { ConnectButton } from "@/components/wallet/connect-button";
import { BrandMark } from "@/components/layout/brand-mark";
import { JsonLd } from "@/components/seo/json-ld";
import { organizationJsonLd, webApplicationJsonLd, webSiteJsonLd } from "@/lib/structured-data";
import { IndependentGate } from "./app";
import { independentMarketAddress } from "./config";
import { appConfig } from "@/lib/config";

function OrbitalMark() {
  return (
    <div className="orbital-art" aria-hidden="true">
      <div className="orbital-grid" />
      <div className="orbital-coordinate coordinate-top">CØ / PROBABILITY ENGINE</div>
      <svg viewBox="0 0 560 500" fill="none" className="orbital-diagram">
        <circle
          cx="280"
          cy="248"
          r="187"
          stroke="currentColor"
          strokeOpacity=".12"
          strokeDasharray="2 7"
        />
        <circle cx="280" cy="248" r="145" stroke="currentColor" strokeOpacity=".13" />
        <path d="M50 248H510M280 25V470" stroke="currentColor" strokeOpacity=".09" />
        <g className="orbital-rings">
          <ellipse
            cx="280"
            cy="248"
            rx="232"
            ry="85"
            transform="rotate(-36 280 248)"
            stroke="#a7f652"
            strokeWidth="1.4"
          />
          <ellipse
            cx="280"
            cy="248"
            rx="232"
            ry="85"
            transform="rotate(36 280 248)"
            stroke="#54d9e8"
            strokeWidth="1.2"
          />
          <ellipse
            cx="280"
            cy="248"
            rx="232"
            ry="85"
            transform="rotate(90 280 248)"
            stroke="#54d9e8"
            strokeOpacity=".35"
          />
        </g>
        <circle cx="280" cy="248" r="75" fill="#080d10" stroke="#a7f652" strokeOpacity=".22" />
        <text
          x="280"
          y="277"
          textAnchor="middle"
          fill="#eff3e9"
          fontSize="92"
          fontFamily="var(--font-space-grotesk), sans-serif"
          fontWeight="500"
        >
          8
        </text>
        {[
          [93, 132],
          [467, 364],
          [93, 364],
          [467, 132],
          [280, 19],
          [280, 477],
          [144, 248],
          [416, 248],
        ].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="9" fill="#080d10" stroke={i % 2 ? "#54d9e8" : "#a7f652"} />
            <circle cx={x} cy={y} r="3" fill={i % 2 ? "#54d9e8" : "#a7f652"} />
          </g>
        ))}
      </svg>
      <span className="orbital-label orbital-label-one">
        YES <b>↗</b>
      </span>
      <span className="orbital-label orbital-label-two">
        NO <b>↘</b>
      </span>
      <div className="orbital-coordinate coordinate-bottom">
        <span>08 QUESTIONS</span>
        <span>∞ POSSIBILITIES</span>
      </div>
    </div>
  );
}

export function IndependentPage() {
  const local = appConfig.chain.id === 31337;
  return (
    <Providers>
      <div className="observatory-shell">
        <header className="observatory-header">
          <Link href="/" className="observatory-logo" aria-label="Chaos Zero home">
            <BrandMark className="size-8" />
            <span>
              CHAOS<span className="logo-zero">ZERO</span>
            </span>
          </Link>
          <nav aria-label="Main navigation">
            <a href="#markets">
              Markets <span>08</span>
            </a>
            <a href="#how-it-works">How it works</a>
            <Link href="/faq">
              FAQ <ArrowUpRight size={12} aria-hidden />
            </Link>
          </nav>
          <ConnectButton />
        </header>
        <main>
          <section className="observatory-hero" aria-labelledby="main-title">
            <div className="hero-copy">
              <p className="observatory-kicker">
                <span className="status-dot" />
                {local ? "LOCAL TEST NETWORK" : "PREDICTION MARKETS ON ARBITRUM"}
              </p>
              <h1 id="main-title">
                Eight ways
                <br />
                to read the
                <br />
                <span>chaos.</span>
                <span className="hero-period">↗</span>
              </h1>
              <p className="hero-description">
                The game creates the unknown.
                <br />
                You take a position. Eight independent markets on every Cosmic Signature cycle.
              </p>
              <div className="hero-actions">
                <a href="#markets" className="observatory-primary">
                  Explore the markets <ArrowDownRight size={20} aria-hidden />
                </a>
                <a href="#how-it-works" className="hero-secondary">
                  Understand the odds <ArrowRight size={15} aria-hidden />
                </a>
              </div>
              <div className="hero-footnote">
                <span>YES / NO</span>
                <i />
                <span>CST DENOMINATED</span>
                <i />
                <span>
                  {independentMarketAddress
                    ? local
                      ? "TEST FUNDS ONLY"
                      : "ON-CHAIN POOLS"
                    : "PRELAUNCH"}
                </span>
              </div>
            </div>
            <OrbitalMark />
          </section>
          <section
            id="markets"
            className="observatory-markets"
            aria-label="Eight prediction markets"
          >
            <Suspense
              fallback={
                <div className="market-loading" role="status">
                  Connecting to the market…
                </div>
              }
            >
              <IndependentGate />
            </Suspense>
          </section>
          <section id="how-it-works" className="observatory-explainer">
            <div className="explainer-intro">
              <p className="observatory-kicker">FROM A HUNCH TO A POSITION</p>
              <h2>
                A little conviction.
                <br />
                <span>A clear outcome.</span>
              </h2>
              <p>
                Cosmic Signature is a game played on Arbitrum. Every gesture changes its story.
                Chaos Zero turns eight parts of that story into questions you can trade.
              </p>
              <a href="https://cosmicsignature.com" target="_blank" rel="noreferrer">
                Explore Cosmic Signature <ArrowUpRight size={15} aria-hidden />
              </a>
            </div>
            <div className="explainer-steps">
              <article>
                <span>01</span>
                <div>
                  <h3>Find your question.</h3>
                  <p>
                    More gestures? A longer record? An odd final count? Choose a question and take
                    the YES or NO side with CST.
                  </p>
                </div>
                <MoveUpRight size={21} aria-hidden />
              </article>
              <article>
                <span>02</span>
                <div>
                  <h3>Let the market move.</h3>
                  <p>
                    Each question has its own pool. Prices respond to trades. Buy or sell while the
                    cycle is open; every new cycle starts at 50 / 50.
                  </p>
                </div>
                <MoveUpRight size={21} aria-hidden />
              </article>
              <article>
                <span>03</span>
                <div>
                  <h3>The game has the final word.</h3>
                  <p>
                    All eight settle after the game cycle ends. Each winning share pays 1 CST.
                    Reserved claims stay separate as unused funding rolls forward.
                  </p>
                </div>
                <MoveUpRight size={21} aria-hidden />
              </article>
            </div>
          </section>
          <section className="observatory-funding">
            <div>
              <p className="observatory-kicker">FUEL THE POSSIBILITIES</p>
              <h2>
                One contribution.
                <br />
                <span>Eight deeper markets.</span>
              </h2>
            </div>
            <div>
              <p>
                Contributions are divided equally across the eight pools. There are no trading fees
                and no redeemable LP shares. Funding is an irreversible gift; unused pool funds
                carry into future cycles.
              </p>
              <Link href="/faq">
                Read the mechanics <ArrowUpRight size={16} aria-hidden />
              </Link>
            </div>
          </section>
        </main>
        <footer className="observatory-footer">
          <div>
            <BrandMark className="size-6" />
            <span>CHAOS ZERO</span>
            <small>Make sense of the unpredictable.</small>
          </div>
          <nav aria-label="Footer navigation">
            <Link href="/faq">FAQ</Link>
            <Link href="/baseline">Baseline evidence</Link>
            <a
              href="https://arbiscan.io/address/0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2"
              target="_blank"
              rel="noreferrer"
            >
              Game contract <ArrowUpRight size={12} aria-hidden />
            </a>
          </nav>
          <p>
            Positions can lose value. Game participants can influence outcomes.{" "}
            {local
              ? "This local environment uses test tokens."
              : independentMarketAddress
                ? "Review the deployed contracts before trading."
                : "Eight-market deployment pending. Trading is not open."}
          </p>
        </footer>
      </div>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={webSiteJsonLd()} />
      <JsonLd data={webApplicationJsonLd()} />
    </Providers>
  );
}
