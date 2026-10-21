import { appConfig, COSMIC_GAME_ADDRESS } from "@/lib/config";
import { AddressLink } from "@/components/ui/address-link";

interface FooterProps {
  marketAddress: string | null;
  cstAddress: string | null;
}

export function Footer({ marketAddress, cstAddress }: FooterProps) {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-8 text-center sm:px-6">
        <p className="max-w-xl text-xs leading-relaxed text-ink-faint">
          Chaos Zero brings eight independent YES/NO markets to Cosmic Signature on{" "}
          {appConfig.chain.name}. Each question has a separate CST pool. Winning shares pay 1 CST
          after the cycle closes.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-faint">
          {marketAddress && (
            <span>
              Market <AddressLink address={marketAddress} />
            </span>
          )}
          {cstAddress && (
            <span>
              CST <AddressLink address={cstAddress} />
            </span>
          )}
          <span>
            Game <AddressLink address={COSMIC_GAME_ADDRESS} />
          </span>
        </div>
        <p className="text-[11px] text-ink-faint/70">
          Prediction markets involve risk. Bet only what you can afford to lose.
        </p>
      </div>
    </footer>
  );
}
