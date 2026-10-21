import {
  encodeAbiParameters,
  formatUnits,
  getAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
} from "viem";
import document from "../../../deployment/arbitrum-round-2-baseline.json";

/** The reviewed deployment input is also the public document: never maintain a copy. */
export const BASELINE = document;
export const BASELINE_JSON = `${JSON.stringify(BASELINE, null, 2)}\n`;
export const BASELINE_EVIDENCE_HASH = keccak256(stringToHex(BASELINE_JSON));

export function constructorBaselineHash() {
  const value = BASELINE.values;
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address,uint256,(uint256,uint256,uint256,uint256,uint256,uint256,bool)"),
      [
        getAddress(BASELINE.game),
        BigInt(BASELINE.baselineRound),
        [
          BigInt(value.gestureCount),
          BigInt(value.ethSpent),
          BigInt(value.cstBurned),
          BigInt(value.highestCstPaid),
          BigInt(value.enduranceDuration),
          BigInt(value.chronoDuration),
          value.sameGesture,
        ],
      ],
    ),
  );
}

// A mismatched reviewed constructor commitment must fail the build, not become
// an authoritative-looking evidence page with inconsistent numbers.
if (constructorBaselineHash() !== BASELINE.constructorBaselineHash) {
  throw new Error("The historical baseline does not match its constructor commitment.");
}

export const BASELINE_ROWS = [
  {
    label: "Total gestures",
    value: BigInt(BASELINE.values.gestureCount).toLocaleString("en-US"),
    exact: BASELINE.values.gestureCount,
    unit: "gestures",
  },
  {
    label: "ETH spent on gestures",
    value: formatUnits(BigInt(BASELINE.values.ethSpent), 18),
    exact: BASELINE.values.ethSpent,
    unit: "ETH",
    baseUnit: "wei",
  },
  {
    label: "CST burned through gestures",
    value: formatUnits(BigInt(BASELINE.values.cstBurned), 18),
    exact: BASELINE.values.cstBurned,
    unit: "CST",
    baseUnit: "base units",
  },
  {
    label: "Highest CST payment",
    value: formatUnits(BigInt(BASELINE.values.highestCstPaid), 18),
    exact: BASELINE.values.highestCstPaid,
    unit: "CST",
    baseUnit: "base units",
  },
  {
    label: "Endurance Champion duration",
    value: BASELINE.values.enduranceDuration,
    exact: BASELINE.values.enduranceDuration,
    unit: "seconds",
  },
  {
    label: "Chrono Warrior duration",
    value: BASELINE.values.chronoDuration,
    exact: BASELINE.values.chronoDuration,
    unit: "seconds",
  },
  {
    label: "Same gesture earned both titles",
    value: BASELINE.values.sameGesture ? "YES" : "NO",
    exact: String(BASELINE.values.sameGesture),
    unit: "",
  },
];
