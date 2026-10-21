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
import { independentMarketAddress } from "@/independent/config";

const SUMMARY =
  `${SITE_NAME} offers eight YES/NO prediction markets about the Cosmic Signature V3 game. ` +
  "Questions cover gestures (bids), Endurance and Chrono durations, ETH and CST payments, odd gesture counts, shared titles and maximum CST payments. " +
  "Each question has its own CST-backed AMM on Arbitrum One and opens at 50% YES and 50% NO. " +
  "Every winning position pays 1 CST after final settlement.";

const NAME_STORY =
  'The name: "Chaos" is the unfolding game; "Zero" marks the fresh 50/50 opening of each question in every cycle.';

/** The deployment facts, reflecting the actual configured chain and contracts. */
function keyFacts(): string {
  const chainFacts = [
    `Chain: ${appConfig.chain.name} (chain id ${appConfig.chain.id}).`,
    independentMarketAddress
      ? `Eight-question market contract: ${independentMarketAddress}.`
      : "Eight-question market is not configured for trading on this frontend.",
    `Cosmic Signature game proxy: ${COSMIC_GAME_ADDRESS}.`,
    COSMIC_CST_ADDRESS && `CST token: ${COSMIC_CST_ADDRESS}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "Key facts:",
    "",
    "- Eight independent pools per eligible game cycle, inside one market contract. Only the current cycle can be opened and traded.",
    "- Every fresh pool starts at 50/50; previous prices and historical timestamps do not set opening odds. Strict-comparison ties resolve NO.",
    "- Trading remains open until the game actually ends the cycle, even when an answer is known. The countdown reaching zero does not finalize results.",
    "- Each question uses its own constant-product AMM. There are no trading fees; Arbitrum network fees still apply.",
    "- Funding is divided equally across all eight pools. Contributions are irreversible and create no LP shares or withdrawal rights. Unused funding carries forward only after winning claims are reserved.",
    "- 1 CST splits into 1 YES + 1 NO for one question and cycle; a matching pair merges into 1 CST. An immutable adapter reads game outcomes; anyone can settle a finalized cycle.",
    `- ${chainFacts}`,
    `- The historical launch baseline and its provenance are published at ${absoluteUrl("/baseline")} (machine-readable: ${absoluteUrl("/baseline.json")}). Later comparisons use native V3 records.`,
    "- To bet you need: a wallet on Arbitrum One, CST, and a little ETH for gas.",
  ].join("\n");
}

const NOTES = [
  "## Notes",
  "",
  "- Prediction markets involve risk; bet only what you can afford to lose.",
  "- The market contract is immutable and permissionless. The game, result adapter and CST remain dependencies. Claims do not expire, but unresolved positions require valid result data before payout.",
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
    `- [Market](${absoluteUrl("/")}): eight question cards, exact trade quotes, positions, equal pool funding, settlement and claims. Trading requires a configured deployment. \`?round=N\` selects a cycle.`,
    `- [FAQ](${absoluteUrl("/faq")}): questions, pricing, funding contributions, positions, resolution and risks.`,
    `- [Historical baseline evidence](${absoluteUrl("/baseline")}): exact launch comparison values, replay checks, transaction references and commitments. This fixed off-chain bootstrap is not an on-chain receipt-proof verifier.`,
    `- [Baseline JSON](${absoluteUrl("/baseline.json")}): the exact reviewed deployment input and provenance.`,
    `- [Full knowledge base](${absoluteUrl("/llms-full.txt")}): this site's complete FAQ — every question and answer — in one plain-text document.`,
    "",
    "## About Cosmic Signature",
    "",
    `- [Cosmic Signature](${COSMIC_SIGNATURE_URL}): the on-chain game whose V3 statistics determine the market outcomes. Game gestures and prediction-market trades are separate transactions.`,
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
        [
          `### ${item.question}`,
          "",
          item.answer.join("\n\n"),
          ...(item.reference
            ? [`[${item.reference.label}](${absoluteUrl(item.reference.href)})`]
            : []),
          "",
        ].join("\n"),
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
