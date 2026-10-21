import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Download, FileCheck2, Fingerprint } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd } from "@/lib/structured-data";
import { BASELINE, BASELINE_EVIDENCE_HASH, BASELINE_ROWS } from "@/lib/baseline";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Historical baseline evidence",
  description:
    "Inspect the exact round-two values and public evidence used to bootstrap Chaos Zero’s eight independent markets, including receipts, replay checks and reproducible commitments.",
  alternates: { canonical: "/baseline" },
  openGraph: { title: "Chaos Zero — Historical baseline evidence", url: "/baseline" },
};

function ExplorerLink({
  hash,
  label,
  type = "tx",
}: {
  hash: string;
  label: string;
  type?: "tx" | "block" | "address";
}) {
  return (
    <a href={`https://arbiscan.io/${type}/${hash}`} target="_blank" rel="noreferrer">
      {label}
      <ArrowUpRight size={14} aria-hidden />
    </a>
  );
}

export default function BaselinePage() {
  const evidence = BASELINE.provenance;
  return (
    <div className="observatory-shell baseline-shell">
      <header className="observatory-header">
        <Link href="/" className="observatory-logo" aria-label="Chaos Zero home">
          <BrandMark className="size-8" />
          <span>
            CHAOS<span className="logo-zero">ZERO</span>
          </span>
        </Link>
        <nav aria-label="Evidence navigation">
          <Link href="/">Markets</Link>
          <Link href="/faq">FAQ</Link>
        </nav>
        <a
          href="/baseline.json"
          className="baseline-download"
          download="arbitrum-round-2-baseline.json"
        >
          <Download size={14} aria-hidden />
          Evidence JSON
        </a>
      </header>
      <main>
        <section className="baseline-hero">
          <div>
            <Link href="/" className="baseline-back">
              <ArrowLeft size={13} aria-hidden />
              Back to the markets
            </Link>
            <p className="observatory-kicker">
              <FileCheck2 size={13} aria-hidden />
              THE HISTORICAL RECORD
            </p>
            <h1>
              A starting point.
              <br />
              <span>Open to inspection.</span>
            </h1>
            <p className="baseline-lede">
              The first eight-market cycle compares with game cycle {BASELINE.baselineRound}. Here
              are the exact historical values, the evidence behind them, and the steps to reproduce
              the calculation.
            </p>
          </div>
          <div
            className="baseline-cycle-mark"
            aria-label={`Cycle ${BASELINE.baselineRound} is the baseline for cycle ${BASELINE.firstMarketRound}`}
          >
            <span>BASELINE</span>
            <strong>
              {BASELINE.baselineRound.padStart(2, "0")}
              <i>↗</i>
            </strong>
            <p>
              First market cycle <b>{BASELINE.firstMarketRound.padStart(2, "0")}</b>
            </p>
          </div>
        </section>
        <div className="baseline-scope">
          <Fingerprint size={20} aria-hidden />
          <div>
            <h2>A fixed, one-time bootstrap.</h2>
            <p>
              The V2 game retained the gesture count, but not all the comparative statistics now
              available in V3. The missing values were reconstructed off chain and cross-checked
              against public chain records. The adapter freezes these values at deployment.{" "}
              <strong>This is not an on-chain receipt-proof verifier.</strong> Later cycle
              comparisons use native V3 records.
            </p>
          </div>
        </div>
        <section className="baseline-section" aria-labelledby="values-title">
          <div className="baseline-section-title">
            <p className="observatory-kicker">01 / EXACT INPUTS</p>
            <h2 id="values-title">Cycle {BASELINE.baselineRound}, in full precision.</h2>
          </div>
          <div className="baseline-table-wrap">
            <table className="baseline-table">
              <thead>
                <tr>
                  <th scope="col">Historical statistic</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {BASELINE_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>
                      <span>
                        {row.value}
                        {row.unit && <small> {row.unit}</small>}
                      </span>
                      {row.baseUnit && (
                        <code>
                          {row.exact} {row.baseUnit}
                        </code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="baseline-caption">
            The Endurance record came from gesture #{evidence.enduranceGesture}; the Chrono record
            came from #{evidence.chronoGesture}. Both belonged to the same wallet, but they were
            different gestures. The same-gesture result is therefore{" "}
            {BASELINE.values.sameGesture ? "YES" : "NO"}.
          </p>
        </section>
        <section className="baseline-section" aria-labelledby="checks-title">
          <div className="baseline-section-title">
            <p className="observatory-kicker">02 / THE EVIDENCE TRAIL</p>
            <h2 id="checks-title">Replayed. Cross-checked. Recorded.</h2>
          </div>
          <div className="baseline-counts">
            {[
              { label: "gestures", count: evidence.gestureCount },
              { label: "block headers", count: evidence.headerCount },
              { label: "transaction receipts", count: evidence.receiptCount },
              { label: "wallet records", count: evidence.uniqueWalletCount },
            ].map(({ label, count }) => (
              <div key={label}>
                <strong>{count.toLocaleString("en-US")}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <ol className="baseline-checks">
            {evidence.checks.map((check, index) => (
              <li key={check}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{check}.</p>
              </li>
            ))}
          </ol>
          <p className="baseline-caption">
            The evidence includes {evidence.eventCount.toLocaleString("en-US")} relevant logs. The
            scan found {evidence.gameUpgradeEventCount} game upgrade events between the first and
            closing blocks. Logs, headers and receipts were retrieved from the separate public RPC
            sources recorded in the JSON.
          </p>
          <div className="baseline-transactions">
            <div>
              <span>FIRST GESTURE</span>
              <ExplorerLink
                hash={evidence.firstTransactionHash}
                label={`Block ${BigInt(evidence.firstBlock).toLocaleString("en-US")}`}
              />
              <code>{evidence.firstTransactionHash}</code>
            </div>
            <div>
              <span>CYCLE CLOSURE</span>
              <ExplorerLink
                hash={evidence.closeTransactionHash}
                label={`Block ${BigInt(evidence.finalBlock).toLocaleString("en-US")}`}
              />
              <code>{evidence.closeTransactionHash}</code>
            </div>
          </div>
        </section>
        <section className="baseline-section" aria-labelledby="commitments-title">
          <div className="baseline-section-title">
            <p className="observatory-kicker">03 / PUBLIC COMMITMENTS</p>
            <h2 id="commitments-title">Two hashes. Two precise meanings.</h2>
          </div>
          <div className="baseline-hashes">
            <article>
              <h3>Constructor baseline hash</h3>
              <p>
                Keccak-256 of the ABI-encoded game address, baseline cycle, and seven historical
                values. This is the adapter’s <code>baselineHash()</code> commitment.
              </p>
              <code className="baseline-hash">{BASELINE.constructorBaselineHash}</code>
            </article>
            <article>
              <h3>Evidence document hash</h3>
              <p>
                Keccak-256 of the exact UTF-8 bytes served at{" "}
                <Link href="/baseline.json">/baseline.json</Link>, including its final newline. This
                also commits to provenance and upgrade evidence.
              </p>
              <code className="baseline-hash">{BASELINE_EVIDENCE_HASH}</code>
            </article>
          </div>
          <dl className="baseline-context">
            <div>
              <dt>Game proxy</dt>
              <dd>
                <ExplorerLink hash={BASELINE.game} type="address" label={BASELINE.game} />
              </dd>
            </div>
            <div>
              <dt>V3 implementation at verification</dt>
              <dd>
                <ExplorerLink
                  hash={evidence.gameImplementation}
                  type="address"
                  label={evidence.gameImplementation}
                />
              </dd>
            </div>
            <div>
              <dt>Verification block</dt>
              <dd>
                <ExplorerLink
                  hash={evidence.verificationBlock}
                  type="block"
                  label={BigInt(evidence.verificationBlock).toLocaleString("en-US")}
                />
              </dd>
            </div>
            <div>
              <dt>Replayed source revision</dt>
              <dd>
                <code>{evidence.sourceCommit}</code>
              </dd>
            </div>
          </dl>
        </section>
        <section className="baseline-reproduce" aria-labelledby="reproduce-title">
          <div>
            <p className="observatory-kicker">04 / CHECK IT YOURSELF</p>
            <h2 id="reproduce-title">Reproduce the record.</h2>
            <p>
              From a checkout of the Chaos Zero source with its pinned Node and pnpm dependencies
              installed, run the command below. It uses public RPC endpoints and needs no wallet,
              signing key, or API credential.
            </p>
          </div>
          <div>
            <pre>
              <code>pnpm verify:baseline</code>
            </pre>
            <p>
              The verifier replays the game history, validates receipts and wallet records, and
              compares the values and evidence commitments with the reviewed file. It can cache
              public data locally; the default command does not overwrite the reviewed evidence.
            </p>
            <a
              href="/baseline.json"
              className="observatory-primary"
              download="arbitrum-round-2-baseline.json"
            >
              Download the evidence <Download size={16} aria-hidden />
            </a>
          </div>
        </section>
      </main>
      <footer className="observatory-footer">
        <div>
          <BrandMark className="size-6" />
          <span>CHAOS ZERO</span>
          <small>The numbers behind the beginning.</small>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/">Markets</Link>
          <Link href="/faq">FAQ</Link>
          <a href="/baseline.json">
            JSON <ArrowUpRight size={12} aria-hidden />
          </a>
        </nav>
        <p>
          This page publishes the reviewed historical input. It does not assert that the market has
          been deployed or that the game proxy cannot change.
        </p>
      </footer>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Markets", path: "/" },
          { name: "Historical baseline", path: "/baseline" },
        ])}
      />
    </div>
  );
}
