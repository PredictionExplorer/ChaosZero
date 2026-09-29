"use client";

import { useCallback, useMemo, useState } from "react";
import { useChainId, useConnection } from "wagmi";
import { useMarket } from "@/hooks/use-market";
import { useMarketActions } from "@/hooks/use-market-actions";
import { totalVolume, useMarketEvents } from "@/hooks/use-market-events";
import { appConfig } from "@/lib/config";
import { replayRound } from "@/lib/history";
import { canAddLiquidity, hasLpPosition, isResolvable, roundPhase } from "@/lib/market";
import type { Address } from "viem";
import { LazyWalletModal } from "@/components/wallet/lazy-wallet-modal";
import { ActivityFeed } from "./activity-feed";
import { BetPanel } from "./bet-panel";
import { BetClosed, MarketError, MarketSkeleton } from "./empty-states";
import { LiquidityPanel } from "./liquidity-panel";
import { MarketHero } from "./market-hero";
import { PositionPanel } from "./position-panel";
import { ResolveBanner } from "./resolve-banner";
import { RoundNav } from "./round-nav";
import { SidePanelTabs } from "./side-panel-tabs";
import { StatsGrid } from "./stats-grid";

interface MarketAppProps {
  seriesAddress: Address;
  roundOverride: bigint | null;
}

/** Wires all hooks together and lays out the trading screen for one round. */
export function MarketApp({ seriesAddress, roundOverride }: MarketAppProps) {
  const { snapshot, user, currentRound, roundId, isLoading, error, refetchAll } = useMarket(
    seriesAddress,
    roundOverride,
  );
  const events = useMarketEvents(seriesAddress, roundId);
  const actions = useMarketActions(seriesAddress, roundId);
  const connection = useConnection();
  const chainId = useChainId();
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  // The modal's chunk stays unloaded until the user first asks to connect;
  // after that it stays mounted so open/close animations work.
  const [walletModalRequested, setWalletModalRequested] = useState(false);
  const openWalletModal = useCallback(() => {
    setWalletModalRequested(true);
    setWalletModalOpen(true);
  }, []);

  // The chart and cross-checkable pool history, rebuilt purely from events.
  const history = useMemo(() => replayRound(events.poolEvents).points, [events.poolEvents]);

  if (error && !snapshot) {
    return <MarketError message={error.message} onRetry={refetchAll} />;
  }
  if (isLoading || !snapshot) {
    return <MarketSkeleton />;
  }

  const phase = roundPhase(snapshot);
  const wrongChain = connection.status === "connected" && chainId !== appConfig.chain.id;
  const connected = connection.status === "connected" && !wrongChain;

  return (
    <div className="space-y-6">
      <RoundNav roundId={snapshot.roundId} currentRound={currentRound} />

      {isResolvable(snapshot) && (
        <ResolveBanner
          snapshot={snapshot}
          pending={actions.pending === "resolve"}
          connected={connected}
          onResolve={actions.resolve}
          onConnect={openWalletModal}
        />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <MarketHero snapshot={snapshot} history={history} />
          <StatsGrid snapshot={snapshot} volume={totalVolume(events.poolEvents)} />
        </div>

        <div className="space-y-6">
          <SidePanelTabs
            // Remount on round navigation so each round opens back on the bet
            // tab, with no input state leaking between rounds.
            key={snapshot.roundId.toString()}
            lpIndicator={user !== null && hasLpPosition(user)}
            bet={
              phase === "live" || phase === "future" ? (
                <BetPanel
                  pool={snapshot.pool}
                  balance={connected && user ? user.cstBalance : null}
                  allowance={connected && user ? user.cstAllowance : null}
                  pendingAction={
                    actions.pending === "approve" || actions.pending === "bet"
                      ? actions.pending
                      : null
                  }
                  onConnect={openWalletModal}
                  onApprove={(amount) => actions.approve(snapshot.cstAddress, amount)}
                  onBet={actions.bet}
                />
              ) : (
                <BetClosed phase={phase} />
              )
            }
            liquidity={
              <LiquidityPanel
                pool={snapshot.pool}
                lpShares={user?.lpShares ?? 0n}
                lpPendingFees={user?.lpPendingFees ?? 0n}
                lpDeclaredFeeBps={user?.lpDeclaredFeeBps ?? 0}
                canAdd={canAddLiquidity(snapshot)}
                balance={connected && user ? user.cstBalance : null}
                allowance={connected && user ? user.cstAllowance : null}
                pendingAction={
                  actions.pending === "approve" ||
                  actions.pending === "addLiquidity" ||
                  actions.pending === "removeLiquidity" ||
                  actions.pending === "updateFee" ||
                  actions.pending === "claimFees"
                    ? actions.pending
                    : null
                }
                onConnect={openWalletModal}
                onApprove={(amount) => actions.approve(snapshot.cstAddress, amount)}
                onAdd={actions.addLiquidity}
                onRemove={actions.removeLiquidity}
                onUpdateFee={actions.updateFeeDeclaration}
                onClaimFees={actions.claimFees}
              />
            }
          />
          {user && connected && (
            <PositionPanel
              snapshot={snapshot}
              user={user}
              pendingAction={
                actions.pending === "redeem" || actions.pending === "claim" ? actions.pending : null
              }
              onRedeemSets={actions.redeemSets}
              onClaim={actions.claim}
            />
          )}
          <ActivityFeed events={events.activity} isLoading={events.isLoading} />
        </div>
      </div>

      {walletModalRequested && (
        <LazyWalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
      )}
    </div>
  );
}
