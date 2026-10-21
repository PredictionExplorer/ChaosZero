import type { LucideIcon } from "lucide-react";
import { Droplets, ShieldCheck, Sparkles, Target, Timer } from "lucide-react";

export interface FaqItem {
  /** Stable slug: used for anchors, React keys, and ARIA ids. */
  readonly id: string;
  readonly question: string;
  /** One entry per paragraph. */
  readonly answer: readonly string[];
  readonly reference?: { readonly href: string; readonly label: string };
}

export interface FaqCategory {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly items: readonly FaqItem[];
}

/** Shared human and machine-readable explanation of the eight-question market. */
export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  {
    id: "basics",
    title: "The basics",
    description: "Eight questions. One on-chain game.",
    icon: Sparkles,
    items: [
      {
        id: "what-is-chaos-zero",
        question: "What is Chaos Zero?",
        answer: [
          "Chaos Zero is a set of eight recurring YES/NO prediction markets about Cosmic Signature. Each question has its own automated market maker and CST collateral. One winning position pays exactly 1 CST after final settlement.",
          "The market reads results through an immutable adapter connected to the Cosmic Signature V3 game on Arbitrum One.",
        ],
      },
      {
        id: "why-chaos-zero",
        question: "Why is it called Chaos Zero?",
        answer: [
          "Chaos is the unfolding game: every gesture changes what might happen next. Zero marks a fresh start for the markets: each question opens at 50% YES and 50% NO in every cycle. Prices then move with trades.",
        ],
      },
      {
        id: "what-are-gestures",
        question: "What are gestures?",
        answer: [
          "Gestures are bids placed in Cosmic Signature using ETH or CST. The eight markets track their count, payments, timing records and final outcomes. Buying a prediction-market position does not place a gesture in the game.",
        ],
      },
      {
        id: "what-is-cst",
        question: "What is CST?",
        answer: [
          "Cosmic Signature Token (CST) is the ERC-20 token used for positions, AMM funding and payouts. ETH on Arbitrum pays network fees. A losing position can expire without a payout.",
        ],
      },
      {
        id: "what-do-i-need",
        question: "What do I need to participate?",
        answer: [
          "Connect a wallet on Arbitrum One, hold CST for positions and a little ETH for network fees. Approve the displayed CST amount when requested, then review and confirm the transaction in your wallet.",
        ],
      },
      {
        id: "eight-markets",
        question: "Do all eight questions share one pool?",
        answer: [
          "Each question keeps separate collateral and YES/NO liabilities inside one market contract. Trades are priced against that question’s own pool. Contributions enter all eight pools in equal amounts, with any indivisible remainder assigned to the lowest question IDs.",
        ],
      },
    ],
  },
  {
    id: "betting",
    title: "Trading",
    description: "Understand prices, positions and exact quotes.",
    icon: Target,
    items: [
      {
        id: "how-to-bet",
        question: "How do I buy a position?",
        answer: [
          "Select a question and YES or NO, then enter the CST amount. Review the exact position amount and confirm approval if needed. The position belongs to the wallet that holds its ERC-1155 tokens.",
        ],
      },
      {
        id: "how-are-odds-set",
        question: "How are the odds set?",
        answer: [
          "Every new question pool opens at 50% YES and 50% NO. A constant-product curve updates the price as people trade. Previous-cycle prices do not determine the next cycle’s opening odds. Displayed percentages are market prices, not guaranteed probabilities.",
        ],
      },
      {
        id: "fees",
        question: "What fees do I pay?",
        answer: [
          "The market charges no trading fee. Arbitrum network fees still apply to transactions, including transactions that revert. Opening a new cycle or distributing held funding can use more gas than an ordinary trade.",
        ],
      },
      {
        id: "slippage",
        question: "How does slippage protection work?",
        answer: [
          "A trade submits exact input and output amounts and an expiry. If intervening activity makes those amounts invalid, the contract reverts instead of executing a worse quote. Refresh the quote and review it again. A reverted transaction can still cost network gas.",
        ],
      },
      {
        id: "exit-early",
        question: "Can I sell a position before closure?",
        answer: [
          "Yes, while the cycle remains open and the pool can quote your amount. Select the position in your portfolio to sell it for CST. You can also merge matching YES and NO positions for exactly 1 CST per pair.",
        ],
      },
      {
        id: "min-max",
        question: "Are there limits on trade amounts?",
        answer: [
          "Available amounts depend on collateral, outstanding positions and integer pricing bounds. Very small amounts can be unquotable. Large trades move prices more, and every pool has a contract-enforced collateral ceiling.",
        ],
      },
    ],
  },
  {
    id: "rounds",
    title: "Cycles and results",
    description: "Know what closes a market and what pays out.",
    icon: Timer,
    items: [
      {
        id: "historical-baseline",
        question: "How can I check the historical launch baseline?",
        answer: [
          "The first market cycle uses a fixed historical baseline reconstructed from game logs, independently retrieved headers and successful receipts, and permanent wallet records. The public evidence page publishes the exact values, transaction links and reproducible hashes.",
          "This is a one-time off-chain bootstrap frozen in the adapter constructor, not an on-chain receipt-proof verifier. Later cycle comparisons use native V3 records. Run pnpm verify:baseline from the repository to reproduce the reviewed values and evidence commitments using public RPC endpoints; no wallet key or API credential is required.",
        ],
        reference: { href: "/baseline", label: "Inspect the baseline evidence" },
      },
      {
        id: "who-resolves",
        question: "Who can resolve the markets?",
        answer: [
          "Anyone can submit settlement after the game’s round-ending transaction. The result adapter reads the V3 game’s stored statistics. No market administrator chooses the answers. The game remains an upstream dependency.",
        ],
      },
      {
        id: "betting-halt",
        question: "When does trading stop?",
        answer: [
          "Trading continues until the game actually closes the cycle and advances its round counter, even if a question’s answer is already certain. A countdown reaching zero does not itself close the markets or release payouts.",
        ],
      },
      {
        id: "tie",
        question: "What happens on an exact tie?",
        answer: [
          "For questions asking whether a metric exceeds its comparison value, an equal value resolves NO. The odd-count question resolves YES only for an odd final total. The dual-title question requires the same individual gesture, not merely the same wallet.",
        ],
      },
      {
        id: "claim",
        question: "How do I claim winnings?",
        answer: [
          "After settlement, retrieve positions that match the final answers. Each winning unit pays 1 CST, and the tokens are burned when paid. Claims do not expire. Their CST is reserved separately from the funding carried to later cycles.",
        ],
      },
      {
        id: "future-rounds-bet",
        question: "Can I trade future cycles?",
        answer: [
          "Only the current eligible game cycle can be opened and traded. The first funding or trading transaction can start its eight pools from available contributions and carry after settling the previously funded cycle.",
        ],
      },
      {
        id: "round-over-unresolved",
        question: "What happens if settlement is unavailable?",
        answer: [
          "Matching YES/NO pairs can still be merged without reading the result adapter. Unmatched winning positions need settlement first. Once the answers have been cached by settlement, claims no longer need a fresh adapter response.",
        ],
      },
    ],
  },
  {
    id: "liquidity",
    title: "Funding the markets",
    description: "One contribution deepens eight independent pools.",
    icon: Droplets,
    items: [
      {
        id: "what-is-funding",
        question: "What does funding AMM liquidity do?",
        answer: [
          "Funding adds CST collateral that traders can use through the eight AMMs. Every contribution is divided equally among all eight questions. One pool cannot spend the collateral backing another question.",
        ],
      },
      {
        id: "funding-withdraw",
        question: "Can I withdraw a funding contribution?",
        answer: [
          "No. Funding is an irreversible contribution. It creates no LP shares, withdrawal rights or fee income. Review the amount carefully before confirming; CST sent directly to the market is also a contribution.",
        ],
      },
      {
        id: "direct-funding",
        question: "Can I send CST directly to the market?",
        answer: [
          "Yes. A plain transfer cannot execute market code, so the next eligible buy, sell or funding call distributes it before pricing. Held amounts below 1 CST wait for more, an explicit contribution, or the next cycle’s opening.",
        ],
      },
      {
        id: "carry",
        question: "What happens to unused funding?",
        answer: [
          "At settlement, the contract first reserves all outstanding winning claims. Remaining collateral rolls forward and is divided equally among the next funded cycle’s eight pools. Unclaimed winnings are never reused as new liquidity.",
        ],
      },
      {
        id: "funding-prices",
        question: "Can additional funding move prices?",
        answer: [
          "Yes. New collateral deepens each pool and moves its price toward the fixed 50/50 opening balance. The next trade accounts for funding absorption before its exact amounts are checked. A changed quote can revert.",
        ],
      },
    ],
  },
  {
    id: "safety",
    title: "Positions and risks",
    description: "Understand ownership and the limits of the system.",
    icon: ShieldCheck,
    items: [
      {
        id: "safe",
        question: "Is participating safe?",
        answer: [
          "Positions can lose their full purchase cost. Smart-contract defects, game upgrades, token behavior and unavailable result data are risks. The market has no administrator who can change its adapter or undo a transaction. Testing cannot guarantee that no bugs exist.",
        ],
      },
      {
        id: "influence",
        question: "Can game players influence the answers?",
        answer: [
          "Yes. Players can add gestures, affect payments and influence when a cycle closes. Another gesture flips odd/even parity. Known-answer markets keep trading until closure, so informed traders can consume that question’s funding.",
        ],
      },
      {
        id: "complete-sets",
        question: "What are complete YES/NO sets?",
        answer: [
          "One CST splits into one YES and one NO position for the same question and cycle. A matching pair merges back into one CST. Positions from different questions or cycles cannot be paired. Splitting alone does not create AMM trading liquidity.",
        ],
      },
      {
        id: "transfer",
        question: "Can I transfer my positions?",
        answer: [
          "Positions are ERC-1155 tokens and can be transferred to another wallet. The current holder receives sale, merge or claim proceeds. Transfers do not change a question’s total liabilities or price.",
        ],
      },
      {
        id: "approvals",
        question: "What does an operator approval allow?",
        answer: [
          "An ERC-1155 operator approval permits that operator to transfer all your position types, including positions acquired later, until revoked. The interface’s direct transfers do not need an operator approval. Only approve operators you intend to trust.",
        ],
      },
      {
        id: "beta",
        question: "What does the beta label mean?",
        answer: [
          "The interface and market integration are new. Review the displayed contract addresses, question rules and quote before using funds. A successful local test suite is not an independent security audit or a guarantee of economic outcomes.",
        ],
      },
    ],
  },
];
