import { describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  UserRejectedRequestError,
} from "viem";
import { sharedMarketAbi, localGameAbi } from "./abi";
import { describeSharedError } from "./errors";

describe("shared error explanations", () => {
  it.each([
    ["AnswerKnown", /already known/],
    ["ProductWouldDecrease", /Refresh.*new quote/],
    ["InvalidSourceState", /Trading is unavailable/],
    ["Insolvent", /smaller amount/],
    ["RoundNotOpen", /closed for this cycle/],
    ["DeadlineExpired", /quote expired/],
    ["InsufficientPosition", /not enough units/],
    ["NotFunded", /first pool gift/],
    ["NotFinalized", /must close/],
  ] as const)("explains decoded %s", (errorName, expected) => {
    const cause = new ContractFunctionRevertedError({
      abi: sharedMarketAbi,
      functionName: "buy",
      data: encodeErrorResult({ abi: sharedMarketAbi, errorName }),
    });
    expect(describeSharedError(new BaseError("execution reverted", { cause }))).toMatch(expected);
  });
  it("explains the local game's closure guard", () => {
    const cause = new ContractFunctionRevertedError({
      abi: localGameAbi,
      functionName: "closeCycle",
      data: encodeErrorResult({ abi: localGameAbi, errorName: "NotReady" }),
    });
    expect(describeSharedError(cause)).toMatch(/only the last participant/);
  });
  it("recognizes textual reverts without showing ABI jargon", () => {
    expect(describeSharedError(new Error("execution reverted: ProductWouldDecrease"))).toMatch(
      /pricing check/,
    );
    expect(describeSharedError(new Error("execution reverted: FirstGestureMustBeEth"))).toMatch(
      /Start this local cycle with an ETH/,
    );
  });
  it("preserves wallet rejection and transport messages", () => {
    expect(
      describeSharedError(
        new BaseError("denied", { cause: new UserRejectedRequestError(new Error("denied")) }),
      ),
    ).toBe("Transaction cancelled in your wallet.");
    expect(describeSharedError(new Error("Network unavailable"))).toBe("Network unavailable");
  });
});
