"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import {
  ArrowUpRight,
  Radio,
  RefreshCw,
  Activity,
  Timer,
  Flame,
  Repeat2,
  Zap,
  Waves,
  Coins,
} from "lucide-react";
import { cosmicGameV3Abi } from "./abi";
import { appConfig } from "@/lib/config";
import { COSMIC_GAME_ADDRESS } from "@/lib/contracts";
import { QUESTIONS } from "@/shared/questions";

const categories = [
  "ACTIVITY",
  "ENDURANCE",
  "CHRONO",
  "ETH FLOW",
  "CST BURN",
  "PARITY",
  "CHAMPIONS",
  "CST PEAK",
];
const icons = [Activity, Timer, Timer, Waves, Flame, Repeat2, Zap, Coins];

export function PrelaunchMarkets() {
  const client = usePublicClient();
  const query = useQuery({
    queryKey: ["production-game-summary", appConfig.chain.id],
    enabled: !!client && appConfig.chain.id === 42161,
    refetchInterval: 15_000,
    retry: 1,
    queryFn: async () => {
      if (!client || (await client.getChainId()) !== 42161)
        throw new Error("Arbitrum connection unavailable");
      const block = await client.getBlock();
      const round = await client.readContract({
        address: COSMIC_GAME_ADDRESS,
        abi: cosmicGameV3Abi,
        functionName: "roundNum",
        blockNumber: block.number,
      });
      const stats = await client.readContract({
        address: COSMIC_GAME_ADDRESS,
        abi: cosmicGameV3Abi,
        functionName: "roundStats",
        args: [round],
        blockNumber: block.number,
      });
      return { round, count: stats.numBids, block: block.number };
    },
  });
  const current = query.error ? undefined : query.data;
  return (
    <div>
      <div className="observatory-telemetry" aria-label="Network and market status">
        <div>
          <span className="telemetry-label">
            <Radio size={12} aria-hidden /> GAME CYCLE
          </span>
          <strong>
            {current ? `#${current.round}` : query.error ? "Unavailable" : "Connecting…"}
          </strong>
          <span>
            {current
              ? `${current.count.toLocaleString()} gestures recorded`
              : "Reading Arbitrum One"}
          </span>
        </div>
        <div>
          <span className="telemetry-label">INDEPENDENT MARKETS</span>
          <strong>
            08<span className="telemetry-unit"> / cycle</span>
          </strong>
          <span>One pool for every question</span>
        </div>
        <div>
          <span className="telemetry-label">OPENING ODDS</span>
          <strong>
            50<span className="telemetry-divider"> / </span>50
          </strong>
          <span>Reset at the start of every cycle</span>
        </div>
        <div>
          <span className="telemetry-label">MARKET STATUS</span>
          <strong className="text-acid">Prelaunch</strong>
          <span>Trading opens after deployment</span>
        </div>
      </div>
      <div className="market-section-heading">
        <div>
          <p className="observatory-kicker">THE QUESTION BOARD</p>
          <h2>
            Choose your conviction<span className="text-acid">.</span>
          </h2>
        </div>
        <button
          className="observatory-refresh"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          aria-label="Refresh live game data"
        >
          <RefreshCw size={14} aria-hidden />
          {query.isFetching ? "Updating" : "Refresh game"}
        </button>
      </div>
      <p className="board-intro">
        Eight binary questions. Eight separate pools. Each begins at 50% YES / 50% NO. The opening
        prices below are the initial rule, not live quotes.
      </p>
      <div className="prelaunch-grid">
        {QUESTIONS.map((item, index) => {
          const Icon = icons[index];
          return (
            <article
              className="observatory-question"
              key={item.metric}
              data-testid={`preview-question-${index}`}
            >
              <div className="question-top">
                <span className="question-number">{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <Icon size={12} aria-hidden />
                  {categories[index]}
                </span>
              </div>
              <h3>{item.title}</h3>
              <p className="question-description">{item.question}</p>
              <div className="opening-probability">
                <span>OPENING YES</span>
                <strong>
                  50<span>%</span>
                </strong>
                <div className="opening-track">
                  <i />
                </div>
              </div>
              <div className="preview-outcomes">
                <span>
                  YES <b>50%</b>
                </span>
                <span>
                  NO <b>50%</b>
                </span>
              </div>
              <details className="question-rule">
                <summary>
                  Explore question <ArrowUpRight size={14} aria-hidden />
                </summary>
                <p>
                  {item.detail} Markets remain open until the game cycle ends. Trading is not
                  available before deployment.
                </p>
              </details>
            </article>
          );
        })}
      </div>
      <div className="prelaunch-note">
        <span className="status-dot" />
        <p>
          <strong>The game is live. These markets are preparing to open.</strong> No market contract
          is configured and no funds can be deposited here. The historical comparison baseline has
          been reconstructed and cross-checked.{" "}
          <Link href="/baseline" className="baseline-inline-link">
            Inspect the baseline evidence <ArrowUpRight size={12} aria-hidden />
          </Link>
        </p>
        {current && (
          <a href={`https://arbiscan.io/block/${current.block}`} target="_blank" rel="noreferrer">
            Read block {current.block.toLocaleString()} <ArrowUpRight size={14} aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}
