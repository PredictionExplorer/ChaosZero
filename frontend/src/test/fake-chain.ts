import type { Abi, Address, Chain, Hex } from "viem";
import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  isAddressEqual,
  multicall3Abi,
  numberToHex,
} from "viem";

/**
 * Answers `eth_call` for one fake contract: receives the decoded function
 * name and arguments, returns the decoded result (a tuple for multi-output
 * functions). Throwing makes the call revert.
 */
export type ReadHandler = (functionName: string, args: readonly unknown[]) => unknown;

/** One decoded read the app made, in the order the node received it. */
export interface RecordedRead {
  readonly address: Address;
  readonly functionName: string;
  readonly args: readonly unknown[];
}

interface FakeContract {
  readonly abi: Abi;
  readonly read: ReadHandler;
}

/** Thrown for any JSON-RPC method the fake node does not implement. */
class UnsupportedMethodError extends Error {}

/**
 * An in-memory JSON-RPC node for hook tests: the network boundary, not the
 * wagmi hooks, is what gets faked. Real wagmi + viem + react-query run on
 * top of it, so every read is ABI-encoded, batched through Multicall3,
 * decoded, cached and polled exactly as in production — the tests only
 * describe what the chain holds and assert what the app makes of it.
 */
export function createFakeChain(chain: Chain) {
  const contracts = new Map<string, FakeContract>();
  const reads: RecordedRead[] = [];
  const multicall3 = chain.contracts?.multicall3?.address;

  function execute(to: Address, data: Hex): Hex {
    const contract = contracts.get(getAddress(to));
    if (!contract) throw new Error(`execution reverted: no contract at ${to}`);
    const { functionName, args = [] } = decodeFunctionData({ abi: contract.abi, data });
    reads.push({ address: getAddress(to), functionName, args });
    const result = contract.read(functionName, args);
    return encodeFunctionResult({ abi: contract.abi, functionName, result } as Parameters<
      typeof encodeFunctionResult
    >[0]);
  }

  function aggregate3(data: Hex): Hex {
    const { args } = decodeFunctionData({ abi: multicall3Abi, data });
    const calls = args[0] as readonly { target: Address; allowFailure: boolean; callData: Hex }[];
    const results = calls.map(({ target, allowFailure, callData }) => {
      try {
        return { success: true, returnData: execute(target, callData) };
      } catch (error) {
        if (!allowFailure) throw error;
        return { success: false, returnData: "0x" as Hex };
      }
    });
    return encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: results,
    });
  }

  const request = async ({
    method,
    params,
  }: {
    method: string;
    params?: unknown;
  }): Promise<unknown> => {
    switch (method) {
      case "eth_chainId":
        return numberToHex(chain.id);
      case "eth_blockNumber":
        return numberToHex(1_000n);
      case "eth_call": {
        const [{ to, data }] = params as [{ to: Address; data: Hex }];
        if (multicall3 && isAddressEqual(to, multicall3)) return aggregate3(data);
        return execute(to, data);
      }
      default:
        throw new UnsupportedMethodError(`fake chain: unsupported JSON-RPC method ${method}`);
    }
  };

  return {
    /** A viem transport backed by this fake node. */
    transport: custom({ request }),
    /** Registers a contract whose reads `read` answers. */
    deploy(address: Address, abi: Abi, read: ReadHandler) {
      contracts.set(getAddress(address), { abi, read });
    },
    /** Every decoded read so far (Multicall3 batches are unpacked). */
    reads,
    /** How many times `functionName` was read (optionally on one contract). */
    readCount(functionName: string, address?: Address): number {
      return reads.filter(
        (read) =>
          read.functionName === functionName && (!address || isAddressEqual(read.address, address)),
      ).length;
    },
  };
}

export type FakeChain = ReturnType<typeof createFakeChain>;
