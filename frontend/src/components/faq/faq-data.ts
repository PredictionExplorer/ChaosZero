import type { LucideIcon } from "lucide-react";
import { Droplets, ShieldCheck, Sparkles, Target, Timer } from "lucide-react";

export interface FaqItem {
  /** Stable slug: used for anchors, React keys, and ARIA ids. */
  readonly id: string;
  readonly question: string;
  /** One entry per paragraph. */
  readonly answer: readonly string[];
}

export interface FaqCategory {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly items: readonly FaqItem[];
}

/**
 * The whole FAQ, grouped for the jump-nav. Content mirrors the contract and
 * README — if the mechanism changes, this is the page to keep honest.
 */
export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  {
    id: "basics",
    title: "The basics",
    description: "What this market is and what you need to join.",
    icon: Sparkles,
    items: [
      {
        id: "what-is-chaos-zero",
        question: "What is Chaos Zero?",
        answer: [
          "Chaos Zero is a prediction market on the Cosmic Signature game. Every game round asks the same simple question: will this round end with more gestures (bids) than the previous round? You bet YES or NO with CST tokens, and every winning token pays out exactly 1 CST when the round resolves.",
          "The whole series runs on one immutable smart contract on Arbitrum One — every round, forever, with no owner and no admin keys.",
        ],
      },
      {
        id: "why-chaos-zero",
        question: "Why is it called Chaos Zero?",
        answer: [
          "Chaos is the thing you bet on: a live gesture count driven by hundreds of independent players, publicly visible, impossible for anyone to script. Zero is what you have to trust to bet on it: zero oracles, zero admin keys, zero custody — resolution is just the contract comparing two public on-chain numbers.",
          "Every round also starts the same way: from zero, racing a threshold.",
        ],
      },
      {
        id: "what-are-gestures",
        question: "What are gestures?",
        answer: [
          "Gestures are bids placed in the Cosmic Signature game. Each round, players bid to win the round's prizes, and the market simply counts those bids. The count is public on-chain while the round runs, and it can only ever go up.",
          "The market compares this round's final count against the previous round's final count — that previous count is called the threshold.",
        ],
      },
      {
        id: "what-is-cst",
        question: "What is CST?",
        answer: [
          "Cosmic Signature Token (CST) is the ERC-20 token earned by playing Cosmic Signature. It is the market's only currency: bets, liquidity, fees, and payouts are all denominated in CST.",
        ],
      },
      {
        id: "yes-no-meaning",
        question: "What exactly do YES and NO mean?",
        answer: [
          "YES wins if the round's final gesture count is strictly greater than the threshold. NO wins otherwise — including an exact tie. Each winning token redeems for exactly 1 CST; losing tokens are worth nothing.",
        ],
      },
      {
        id: "what-do-i-need",
        question: "What do I need to start betting?",
        answer: [
          "A wallet on Arbitrum One, some CST to bet with, and a little ETH for gas. The app discovers every injected wallet in your browser (MetaMask, Rabby, Coinbase Wallet, and friends) and supports WalletConnect for mobile wallets.",
        ],
      },
      {
        id: "new-market-every-round",
        question: "Is there a new market for every round?",
        answer: [
          "Yes. Every Cosmic Signature round gets its own independent market with its own pool, threshold, and resolution. Markets launch themselves: the first liquidity deposit for a round initializes it, with no deployments and no configuration. You can also open and bet on any future round ahead of time.",
        ],
      },
    ],
  },
  {
    id: "betting",
    title: "Betting",
    description: "Placing, pricing, exiting, and claiming bets.",
    icon: Target,
    items: [
      {
        id: "how-to-bet",
        question: "How do I place a bet?",
        answer: [
          "Open the Place bet tab, pick YES or NO, and type how much CST to spend. The app shows the exact number of outcome tokens you will receive — computed client-side with the same math as the contract — plus the fee and your entry odds. The first bet also asks for a one-time CST approval.",
          "After the transaction confirms, your tokens appear in the position panel along with their live value.",
        ],
      },
      {
        id: "how-are-odds-set",
        question: "How are the odds set?",
        answer: [
          "Each round has a single automated pool holding YES and NO tokens (a constant-product market maker, like Uniswap). The implied probability of YES is the pool ratio: reserveNo / (reserveYes + reserveNo). Every bet moves the price — buying YES makes YES more expensive, exactly like any AMM.",
        ],
      },
      {
        id: "fees",
        question: "What fees do I pay?",
        answer: [
          "One trading fee per bet, paid to the liquidity providers — there is no protocol fee and nobody else takes a cut. The fee is set by an unusual mechanism: every LP declares the fee they want (0–10%), and the pool charges the share-weighted average of all declarations. The live fee is always shown in your quote before you confirm.",
        ],
      },
      {
        id: "slippage",
        question: "What is slippage protection and why do I need it?",
        answer: [
          "The pool can move between the moment you see a quote and the moment your transaction lands. Every bet is submitted with a minimum-tokens-out floor computed from your quote and your slippage tolerance (configurable in the bet panel). If execution would be even slightly worse than your floor, the transaction reverts instead of filling.",
          "This same floor is what makes front-running, sandwich attacks, liquidity pulls, and fee changes harmless: worse execution simply cannot happen to you.",
        ],
      },
      {
        id: "exit-early",
        question: "Can I exit a bet before the round resolves?",
        answer: [
          "Yes. Buy the opposite side, then redeem pairs: every 1 YES + 1 NO pair redeems for exactly 1 CST at any time before resolution, from the position panel. There is no order book to wait on.",
        ],
      },
      {
        id: "claim",
        question: "How do I claim winnings?",
        answer: [
          "Once the round is resolved, a claim button appears in your position panel and pays 1 CST per winning token. There is no deadline — winnings stay claimable forever.",
        ],
      },
      {
        id: "betting-halt",
        question: "Why did betting suddenly stop mid-round?",
        answer: [
          "The gesture count is public and can only increase. The instant it crosses the threshold, YES is already certain — so betting and liquidity-adding halt in that same block, and anyone can resolve the round early. This protects everyone from trading against a known outcome.",
          "The reverse never happens: NO cannot become certain before the round ends, because more gestures can always arrive.",
        ],
      },
      {
        id: "future-rounds-bet",
        question: "Can I bet on rounds that have not started yet?",
        answer: [
          "Yes — any future round can be funded and bet on early. Use the round navigation arrows to move ahead. One caveat: a future round's threshold (the previous round's final count) is still forming, in public, and locks the moment that previous round ends. Expect the market to reprice on that reveal.",
        ],
      },
      {
        id: "min-max",
        question: "Is there a minimum or maximum bet?",
        answer: [
          "The contract imposes none. In practice your size is limited by pool depth: bigger bets move the price more, and your own slippage floor will stop a fill that got too expensive.",
        ],
      },
    ],
  },
  {
    id: "rounds",
    title: "Rounds & resolution",
    description: "Thresholds, round endings, and who settles the market.",
    icon: Timer,
    items: [
      {
        id: "what-is-threshold",
        question: "What exactly is the threshold?",
        answer: [
          "The previous round's final gesture count — the number this round has to strictly beat for YES to win. It is displayed in the count-vs-threshold race on the market screen, and it locks automatically for each round the moment its previous round finishes.",
        ],
      },
      {
        id: "who-resolves",
        question: "Who resolves the market?",
        answer: [
          "Anyone — resolution is permissionless. When a round ends (or the count crosses the threshold early), a resolve banner appears and any wallet can trigger it. Resolution just compares two public on-chain numbers: there is no oracle, no multisig, and no human judgment involved.",
        ],
      },
      {
        id: "round-over-unresolved",
        question: "The round is over but not resolved — is my money stuck?",
        answer: [
          "No. Betting, set-minting, and liquidity-adds freeze when a round ends, but exits never do: removing liquidity, redeeming YES+NO pairs, and claiming fees keep working forever. Claiming winnings needs one resolve transaction first, which anyone can send.",
        ],
      },
      {
        id: "tie",
        question: "What happens on an exact tie?",
        answer: [
          "NO wins. YES pays out only when the count is strictly greater than the threshold.",
        ],
      },
      {
        id: "far-future",
        question: "What if I hold tokens for a round that is far in the future?",
        answer: [
          "Every round's market is fully collateralized and independent, so paired tokens (YES+NO) always redeem for CST and LPs can always withdraw — even if the round is a long way off. A one-sided position, though, can only be claimed after the round actually ends: that waiting time is a risk you choose to take.",
        ],
      },
    ],
  },
  {
    id: "liquidity",
    title: "Providing liquidity",
    description: "For the LP minority: funding pools and earning fees.",
    icon: Droplets,
    items: [
      {
        id: "what-is-lping",
        question: "What does providing liquidity actually do?",
        answer: [
          "Liquidity providers fund the pool that bettors trade against: a CST deposit becomes YES and NO tokens sitting in the pool at the current odds. In exchange, LPs earn the trading fee on every bet, split pro rata by shares.",
        ],
      },
      {
        id: "where-is-lp-ui",
        question: "Where is the liquidity interface?",
        answer: [
          "In the sidebar of the market screen, behind the Liquidity tab next to Place bet. Betting is the app's front door; liquidity provision is deliberately one click deeper. If you have an active LP position, the tab shows a glowing dot so your shares and fees are never hard to find.",
        ],
      },
      {
        id: "fee-vote",
        question: "How does the fee vote work?",
        answer: [
          "Every LP declares the fee they want bettors to pay (0–10%) when depositing, and can re-declare at any time without moving funds. The pool charges the share-weighted average of all declarations. Fee earnings are split by shares regardless of what you declared — the declaration is a vote on the pool's price, not a private fee tier.",
        ],
      },
      {
        id: "lp-risks",
        question: "What are the risks of providing liquidity?",
        answer: [
          "The big one is informed flow. The gesture count is public while the round runs, so late bettors know more than the pool does, and that certainty accumulates against LP inventory. The per-bet fee is your compensation — you vote on it yourself — and you can withdraw the moment a round stops being uncertain.",
          "Providing across a future round's threshold reveal adds a second, sharper repricing event. Size accordingly.",
        ],
      },
      {
        id: "lp-withdraw",
        question: "Can I withdraw my liquidity at any time?",
        answer: [
          "Yes, always — mid-round, after betting halts, after the round ends, even after resolution. You receive your pro-rata share of the pool as YES + NO tokens plus your accrued fees in CST. Paired tokens redeem 1:1 for CST; any unpaired remainder is market exposure.",
        ],
      },
      {
        id: "first-lp",
        question: "What is special about being the first LP?",
        answer: [
          "The first deposit opens the pool and picks the opening odds — later LPs join at the pool's current ratio. Misjudged opening odds are free money for arbitrageurs, so open near your honest estimate. The first deposit must be at least 0.001 CST, and the first LP's fee declaration becomes the opening fee.",
        ],
      },
    ],
  },
  {
    id: "safety",
    title: "Safety & trust",
    description: "Collateral, attack resistance, and what Beta means.",
    icon: ShieldCheck,
    items: [
      {
        id: "is-it-safe",
        question: "Is my money safe?",
        answer: [
          "The market is fully collateralized by construction: 1 CST mints exactly 1 YES + 1 NO, a pair always redeems for 1 CST, and every payout is backed to the wei. The contract has no owner, no admin keys, no pause switch, and no upgrade path — nobody can freeze or confiscate anything.",
          "It is hardened by an extensive suite of unit, fuzz, invariant, and scripted-attack tests, but it has not had a third-party audit and the site is in beta. Bet only what you can afford to lose.",
        ],
      },
      {
        id: "front-running",
        question: "Can I get front-run, sandwiched, or rugged?",
        answer: [
          "Every price-sensitive action carries a slippage floor and a deadline, so worse-than-quoted execution reverts — that neutralizes sandwiches, liquidity pulls, and fee jumps. A liquidity rug after your bet fills cannot touch your tokens either: they are backed by set collateral the pool cannot reach.",
          "The one thing a rug can cost you is liquidity depth for exiting early, so size positions to the pool.",
        ],
      },
      {
        id: "manipulation",
        question: "Can someone manipulate the outcome?",
        answer: [
          "Only by actually playing: pushing the count over the threshold means placing real gestures, each costing real money in the game. That cost scales with the distance to the threshold, so modest pool sizes keep manipulation unprofitable. It is a design trade-off worth knowing about.",
        ],
      },
      {
        id: "who-controls",
        question: "Who controls the contract?",
        answer: [
          "Nobody. The market is a single immutable contract with no owner or admin functions; resolution reads public state straight from the Cosmic Signature game contract. The one trust assumption: the game itself is an upgradeable proxy operated by the Cosmic Signature team, and the market trusts its round counter and gesture counts.",
        ],
      },
      {
        id: "what-does-beta-mean",
        question: "What does the Beta tag mean?",
        answer: [
          "The site just launched. The contract is immutable and thoroughly tested, but the app is young: expect rough edges, and expect the interface to improve quickly. Start small, and if something looks off, please flag it in the Cosmic Signature community channels before betting big.",
        ],
      },
    ],
  },
];
