/**
 * Builders for `/llms.txt` and `/llms-full.txt` (https://llmstxt.org): the
 * plain-markdown documents AI crawlers and assistants read to understand the
 * site without executing JavaScript.
 *
 * Generated — not static files — so the origin always matches `SITE_URL`
 * (previews included), the contract addresses always match the deployment,
 * and `/llms-full.txt` always contains the entire FAQ verbatim. If the FAQ
 * changes, these documents change with it; nothing to keep in sync by hand.
 */

import { appConfig, COSMIC_CST_ADDRESS, COSMIC_GAME_ADDRESS } from "@/lib/config";
import { COSMIC_SIGNATURE_URL, SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";
import { FAQ_CATEGORIES } from "@/components/faq/faq-data";

const SUMMARY =
  `${SITE_NAME} is a fully collateralized YES/NO prediction market on the Cosmic Signature game. ` +
  "Every game round asks the same question: will this round end with more gestures (bids) than the previous round? " +
  "Bets are placed in CST (Cosmic Signature Token) on Arbitrum One, and every winning token pays out exactly 1 CST. " +
  "The whole series runs on one immutable smart contract — zero oracles, zero admin keys, zero custody.";

const NAME_STORY =
  'The name: "Chaos" is the thing being bet on — a live gesture count driven by many independent players that nobody controls; ' +
  '"Zero" is the trust required — zero oracles, zero admin keys, zero custody.';

/** The deployment facts, reflecting the actual configured chain and contracts. */
function keyFacts(): string {
  const chainFacts = [
    `Chain: ${appConfig.chain.name} (chain id ${appConfig.chain.id}).`,
    appConfig.marketAddress && `Market contract: ${appConfig.marketAddress}.`,
    `Cosmic Signature game proxy: ${COSMIC_GAME_ADDRESS}.`,
    COSMIC_CST_ADDRESS && `CST token: ${COSMIC_CST_ADDRESS}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "Key facts:",
    "",
    "- One market per Cosmic Signature round, launched automatically, forever. Future rounds are tradable before they start.",
    "- YES wins if the round's final gesture count is STRICTLY greater than the previous round's final count (the \"threshold\"); a tie means NO wins.",
    "- Gestures are bids in the Cosmic Signature game. The count is public on-chain while a round runs and only ever goes up, so the moment it crosses the threshold, YES is certain: betting halts atomically and the round can be resolved early.",
    "- Prices come from a constant-product AMM pool (one per round). The implied YES probability is reserveNo / (reserveYes + reserveNo). Liquidity providers vote the trading fee (share-weighted average, capped at 10%).",
    "- Fully collateralized by construction: 1 CST always mints 1 YES + 1 NO, and a pair always redeems for 1 CST. Resolution is permissionless and read directly from the game contract.",
    `- ${chainFacts}`,
    "- To bet you need: a wallet on Arbitrum One, CST, and a little ETH for gas.",
  ].join("\n");
}

const NOTES = [
  "## Notes",
  "",
  "- Prediction markets involve risk; bet only what you can afford to lose.",
  "- The market contract is immutable and permissionless: anyone can bet, provide liquidity, resolve, or claim. There is no deadline on claiming winnings.",
].join("\n");

/** The `/llms.txt` index: summary, facts, and links to everything else. */
export function llmsTxt(): string {
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SUMMARY}`,
    "",
    NAME_STORY,
    "",
    keyFacts(),
    "",
    "## Pages",
    "",
    `- [Market](${absoluteUrl("/")}): the live market — current YES probability, gesture count vs threshold race, place YES/NO bets, provide liquidity, resolve rounds, and claim winnings. \`?round=N\` shows any past or future round.`,
    `- [FAQ](${absoluteUrl("/faq")}): every question answered — the basics, betting mechanics, pricing and fees, liquidity provision and fee voting, resolution and claiming, and the safety model.`,
    `- [Full knowledge base](${absoluteUrl("/llms-full.txt")}): this site's complete FAQ — every question and answer — in one plain-text document.`,
    "",
    "## About Cosmic Signature",
    "",
    `- [Cosmic Signature](${COSMIC_SIGNATURE_URL}): the on-chain NFT game this market is built on. Players bid ("gesture") each round to win prizes; each round ends with a final gesture count — the number this market bets on. Playing the game earns CST, the market's currency.`,
    "",
    NOTES,
    "",
  ].join("\n");
}

/** The `/llms-full.txt` companion: the whole FAQ, verbatim, in one document. */
export function llmsFullTxt(): string {
  const faqSections = FAQ_CATEGORIES.map((category) =>
    [
      `## ${category.title}`,
      "",
      category.description,
      "",
      ...category.items.map((item) =>
        [`### ${item.question}`, "", item.answer.join("\n\n"), ""].join("\n"),
      ),
    ].join("\n"),
  );

  return [
    `# ${SITE_NAME} — full knowledge base`,
    "",
    `> ${SUMMARY}`,
    "",
    NAME_STORY,
    "",
    `This is the complete FAQ of ${SITE_URL} in one document. A shorter index lives at ${absoluteUrl("/llms.txt")}.`,
    "",
    keyFacts(),
    "",
    ...faqSections,
    NOTES,
    "",
  ].join("\n");
}
