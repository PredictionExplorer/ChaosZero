import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";
import { independentMarketAbi } from "./abi";
import { describeIndependentError } from "./errors";
describe("independent contract errors", () => {
  it.each([
    "RoundNotOpen",
    "NotFinalized",
    "OutOfOrderRound",
    "FundingCapacity",
    "NotInitialized",
    "NotFunded",
    "InvalidTimestamp",
    "NonPositiveReserve",
    "InvalidCollateral",
    "InvalidProbability",
  ] as const)("decodes %s without leaking implementation jargon", (name) => {
    const error = new ContractFunctionRevertedError({
      abi: independentMarketAbi,
      functionName: "fundRound",
      data: encodeErrorResult({ abi: independentMarketAbi, errorName: name }),
    });
    const description = describeIndependentError(new BaseError("revert", { cause: error }));
    expect(description).not.toContain(name);
    expect(description.length).toBeGreaterThan(20);
  });
  it("keeps legacy wallet/error fallbacks and explains textual reverts", () => {
    expect(describeIndependentError(new Error("FundingCapacity"))).toMatch(/carried funds/);
    expect(describeIndependentError(new Error("User rejected the request"))).toMatch(/cancelled/);
    expect(describeIndependentError(undefined)).toMatch(/Something went wrong/);
  });
});
