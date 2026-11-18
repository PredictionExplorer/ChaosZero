// @vitest-environment node
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

// Follow the production connector graph. A root-level copy would allow a stale
// transitive validator to pass unnoticed under pnpm's isolated installations.
const rootRequire = createRequire(import.meta.url);
function consumer(name: string, parent = rootRequire) {
  return createRequire(parent.resolve(name));
}
const fromAppKit = consumer("@reown/appkit", consumer("@walletconnect/ethereum-provider"));
const fromBase = consumer("@base-org/account", consumer("@reown/appkit-utils", fromAppKit));
const frameEntry = fromAppKit.resolve("@reown/appkit-wallet");
const cdpEntry = fromBase.resolve("@coinbase/cdp-sdk");
const cdpRoot = resolve(dirname(cdpEntry), "..");
type CoinbasePolicies = {
  CreatePolicyBodySchema: z.ZodType;
  UpdatePolicyBodySchema: z.ZodType;
};

const { W3mFrameSchema: frame } = (await import(
  /* @vite-ignore */ pathToFileURL(frameEntry).href
)) as { W3mFrameSchema: { appEvent: z.ZodType; frameEvent: z.ZodType } };
const esmPolicies = (await import(
  /* @vite-ignore */ pathToFileURL(resolve(cdpRoot, "_esm/index.js")).href
)) as CoinbasePolicies;
const commonJsPolicies = fromBase("@coinbase/cdp-sdk") as CoinbasePolicies;

describe("native Zod wallet schemas", () => {
  it("supports wallet frame messages with optional RPC parameters and a void result", () => {
    expect(frame.appEvent).toBeInstanceOf(z.ZodType);
    expect(frame.frameEvent).toBeInstanceOf(z.ZodType);
    for (const method of ["wallet_getAssets", "wallet_revokePermissions"]) {
      const event = { type: "@w3m-app/RPC_REQUEST", payload: { method } };
      expect(frame.appEvent.parse(event)).toEqual(event);
    }
    const result = { type: "@w3m-frame/RPC_REQUEST_SUCCESS", id: "request-1" };
    expect(frame.frameEvent.parse(result)).toEqual(result);
  });

  it("validates theme records and keeps structured errors for malformed frame messages", () => {
    const event = {
      type: "@w3m-app/SYNC_THEME",
      payload: {
        themeMode: "dark",
        themeVariables: { "--color": "#ed9c52", "--spacing": 4 },
        w3mThemeVariables: { "--font": "sans-serif" },
      },
    };
    expect(frame.appEvent.parse(event)).toEqual(event);
    const invalid = frame.appEvent.safeParse({
      ...event,
      payload: { ...event.payload, w3mThemeVariables: { "--font": false } },
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(invalid.error.issues.length).toBeGreaterThan(0);
  });

  describe.each([
    ["ESM", esmPolicies],
    ["CommonJS", commonJsPolicies],
  ] as const)("Coinbase %s entry point", (_format, policies) => {
    it("uses native validators for typed-data policies with named EIP-712 fields", () => {
      expect(policies.CreatePolicyBodySchema).toBeInstanceOf(z.ZodType);
      expect(policies.UpdatePolicyBodySchema).toBeInstanceOf(z.ZodType);
      const typedRule = (fields: unknown) => ({
        operation: "signEvmTypedData",
        action: "accept",
        criteria: [
          {
            type: "evmTypedDataField",
            types: { types: { Order: fields }, primaryType: "Order" },
            conditions: [{ path: "asset", match: "ETH" }],
          },
        ],
      });
      const rules = [typedRule([{ name: "asset", type: "bytes32" }])];
      const policy = { scope: "account", rules };
      expect(policies.CreatePolicyBodySchema.parse(policy)).toEqual(policy);
      expect(policies.UpdatePolicyBodySchema.parse({ rules })).toEqual({
        rules,
      });
      expect(
        policies.CreatePolicyBodySchema.safeParse({
          scope: "account",
          rules: [typedRule([{ name: "asset" }])],
        }).success,
      ).toBe(false);
    });

    it("validates custom ABI entries for EVM transaction policies", () => {
      const policyWithInput = (inputType: string) => ({
        scope: "project",
        rules: [
          {
            operation: "sendEvmTransaction",
            action: "accept",
            criteria: [
              {
                type: "evmData",
                abi: [
                  {
                    type: "function",
                    name: "bid",
                    inputs: [{ name: "tokenId", type: inputType }],
                    outputs: [],
                    stateMutability: "payable",
                  },
                ],
                conditions: [{ function: "bid" }],
              },
            ],
          },
        ],
      });
      expect(policies.CreatePolicyBodySchema.safeParse(policyWithInput("uint256")).success).toBe(
        true,
      );
      expect(
        policies.CreatePolicyBodySchema.safeParse(policyWithInput("not-an-abi-type")).success,
      ).toBe(false);
    });
  });

  it("keeps literal frame and policy types and exposes v4 validator methods to TypeScript consumers", async () => {
    const ts = (await import("typescript")).default;
    const filename = fileURLToPath(new URL("./wallet-schema-consumer.ts", import.meta.url));
    const options = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
      paths: {
        "@coinbase/cdp-sdk": [resolve(cdpRoot, "_types/index.d.ts")],
        "@reown/appkit-wallet": [resolve(dirname(frameEntry), "../../types/exports/index.d.ts")],
      },
    };
    const source = `
      import { z } from "zod/v4";
      import { W3mFrameSchema, type W3mFrameTypes } from "@reown/appkit-wallet";
      import { CreatePolicyBodySchema, type CreatePolicyBody } from "@coinbase/cdp-sdk";
      const event: W3mFrameTypes.FrameEvent = W3mFrameSchema.frameEvent.parse({});
      event.type satisfies string;
      W3mFrameSchema.appEvent satisfies z.ZodType;
      CreatePolicyBodySchema satisfies z.ZodType;
      const policy: CreatePolicyBody = CreatePolicyBodySchema.parse({});
      policy.scope satisfies "project" | "account";
      // @ts-expect-error frame events are a discriminated set of protocol messages
      const invalid: W3mFrameTypes.FrameEvent = {type: "@invalid-frame"};
      // @ts-expect-error policy scopes are constrained even for external type consumers
      const invalidScope: CreatePolicyBody["scope"] = "other";
      type TxRule = Extract<CreatePolicyBody["rules"][number], { operation: "sendEvmTransaction" }>;
      type Data = Extract<NonNullable<TxRule["criteria"]>[number], { type: "evmData" }>;
      const abi: Data["abi"] = [{ type: "function", name: "bid", inputs: [], outputs: [], stateMutability: "payable" }];
      // @ts-expect-error custom ABI entries retain their typed Solidity discriminant
      const invalidAbi: Data["abi"] = [{ type: "unsupported" }];
      type Address = Extract<NonNullable<TxRule["criteria"]>[number], { type: "evmAddress" }>;
      // @ts-expect-error validated address fields have a hex prefix
      const invalidAddress: Address["addresses"] = ["not-an-address"];
    `;
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (path, ...args) =>
      path === filename
        ? ts.createSourceFile(path, source, ts.ScriptTarget.ES2022)
        : getSourceFile(path, ...args);
    const program = ts.createProgram([filename], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual(
      [],
    );
  }, 20_000);
});
