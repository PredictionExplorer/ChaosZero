import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  UserRejectedRequestError,
} from "viem";
import { describe, expect, it } from "vitest";
import { localGameAbi } from "@/shared/abi";
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
    "NonPositiveReserve",
    "InvalidCollateral",
    "InvalidProbability",
    "InvalidParameters",
    "InvalidSourceState",
    "TransferFailed",
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
  it("explains errors a trade can now surface when it opens a new cycle", () => {
    const describe_ = (name: "NotFunded" | "OutOfOrderRound" | "NotFinalized" | "TransferFailed") =>
      describeIndependentError(
        new BaseError("revert", {
          cause: new ContractFunctionRevertedError({
            abi: independentMarketAbi,
            functionName: "buy",
            data: encodeErrorResult({ abi: independentMarketAbi, errorName: name }),
          }),
        }),
      );
    expect(describe_("NotFunded")).toMatch(/Add CST/);
    expect(describe_("OutOfOrderRound")).toMatch(/later cycle/);
    expect(describe_("NotFinalized")).toMatch(/preceding cycle/);
    expect(describe_("TransferFailed")).toMatch(/settles the preceding one/);
  });
  it("keeps legacy wallet/error fallbacks and explains textual reverts", () => {
    expect(describeIndependentError(new Error("FundingCapacity"))).toMatch(/carried funds/);
    expect(describeIndependentError(new Error("User rejected the request"))).toMatch(/cancelled/);
    expect(describeIndependentError(undefined)).toMatch(/Something went wrong/);
  });
  it.each([
    ["ProductWouldDecrease", /Refresh.*new quote/],
    ["DeadlineExpired", /quote expired/],
    ["InsufficientPosition", /not enough units/],
    ["InsufficientAllowance", /Approve enough CST/],
    ["ReentrantCall", /nested transaction/],
  ] as const)("explains decoded shared error %s", (errorName, expected) => {
    const cause = new ContractFunctionRevertedError({
      abi: independentMarketAbi,
      functionName: "buy",
      data: encodeErrorResult({ abi: independentMarketAbi, errorName }),
    });
    expect(describeIndependentError(new BaseError("execution reverted", { cause }))).toMatch(
      expected,
    );
  });
  it("explains ERC-1155 receiver and position-balance rejections", () => {
    const receiver = "0x1111111111111111111111111111111111111111";
    const invalid = new ContractFunctionRevertedError({
      abi: independentMarketAbi,
      functionName: "safeTransferFrom",
      data: encodeErrorResult({
        abi: independentMarketAbi,
        errorName: "ERC1155InvalidReceiver",
        args: [receiver],
      }),
    });
    expect(describeIndependentError(invalid)).toMatch(/recipient cannot accept/);
    const balance = new ContractFunctionRevertedError({
      abi: independentMarketAbi,
      functionName: "mergePosition",
      data: encodeErrorResult({
        abi: independentMarketAbi,
        errorName: "ERC1155InsufficientBalance",
        args: [receiver, 1n, 2n, 33n],
      }),
    });
    expect(describeIndependentError(balance)).toMatch(/not enough position units/);
  });
  it("explains the local game's closure guard", () => {
    const cause = new ContractFunctionRevertedError({
      abi: localGameAbi,
      functionName: "closeCycle",
      data: encodeErrorResult({ abi: localGameAbi, errorName: "NotReady" }),
    });
    expect(describeIndependentError(cause)).toMatch(/only the last participant/);
  });
  it("recognizes textual shared reverts without showing ABI jargon", () => {
    expect(describeIndependentError(new Error("execution reverted: ProductWouldDecrease"))).toMatch(
      /pricing check/,
    );
    expect(
      describeIndependentError(new Error("execution reverted: FirstGestureMustBeEth")),
    ).toMatch(/Start this local cycle with an ETH/);
  });
  it("preserves wallet rejection and transport messages", () => {
    expect(
      describeIndependentError(
        new BaseError("denied", { cause: new UserRejectedRequestError(new Error("denied")) }),
      ),
    ).toBe("Transaction cancelled in your wallet.");
    expect(describeIndependentError(new Error("Network unavailable"))).toBe("Network unavailable");
  });
  it("never tells a trader that a known answer stopped trading", () => {
    // Markets never end early: no contract error exists for a known answer.
    expect(describeIndependentError(new Error("AnswerKnown"))).not.toMatch(/already known/);
  });
});
