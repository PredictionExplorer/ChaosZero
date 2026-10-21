import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import manifest from "../../../../deployment/arbitrum-round-2-baseline.json";
import BaselinePage, { dynamic as pageDynamic, metadata } from "./page";
import { GET, dynamic as jsonDynamic } from "../baseline.json/route";
import {
  BASELINE,
  BASELINE_JSON,
  BASELINE_EVIDENCE_HASH,
  BASELINE_ROWS,
  constructorBaselineHash,
} from "@/lib/baseline";
import { FAQ_CATEGORIES } from "@/components/faq/faq-data";

describe("published historical evidence", () => {
  it("serves the exact reviewed file bytes and hash without a separate data copy", async () => {
    const raw = readFileSync(
      resolve(process.cwd(), "../deployment/arbitrum-round-2-baseline.json"),
      "utf8",
    );
    expect(BASELINE).toEqual(manifest);
    expect(BASELINE_JSON).toBe(raw);
    const response = GET();
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toBe(raw);
    expect(response.headers.get("x-evidence-keccak256")).toBe(keccak256(stringToHex(raw)));
    expect(BASELINE_EVIDENCE_HASH).toBe(
      "0x55447a205cd7c242667d30dcaad22f23bb1fd06e4364362dc779e3044c3c02a9",
    );
    expect(constructorBaselineHash()).toBe(manifest.constructorBaselineHash);
    expect(BASELINE_EVIDENCE_HASH).not.toBe(constructorBaselineHash());
  });
  it("renders precise inputs, public chain references and the limited trust claim on the server", () => {
    render(<BaselinePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "A starting point.Open to inspection.",
    );
    const table = screen.getByRole("table");
    for (const row of BASELINE_ROWS) {
      const heading = within(table).getByRole("rowheader", { name: row.label });
      const rendered = heading.closest("tr")!;
      expect(rendered).toHaveTextContent(row.value);
      if (row.baseUnit) expect(rendered).toHaveTextContent(row.exact);
    }
    expect(screen.getByText(manifest.constructorBaselineHash)).toBeInTheDocument();
    expect(screen.getByText(BASELINE_EVIDENCE_HASH)).toBeInTheDocument();
    expect(screen.getByText(/This is not an on-chain receipt-proof verifier/)).toBeInTheDocument();
    expect(screen.getByText(/Later cycle comparisons use native V3 records/)).toBeInTheDocument();
    expect(screen.getByText("pnpm verify:baseline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wallet|connect/i })).not.toBeInTheDocument();
    const links = screen.getAllByRole("link");
    for (const hash of [
      manifest.provenance.firstTransactionHash,
      manifest.provenance.closeTransactionHash,
    ]) {
      expect(
        links.some((link) => link.getAttribute("href") === `https://arbiscan.io/tx/${hash}`),
      ).toBe(true);
    }
    for (const count of [
      manifest.provenance.headerCount,
      manifest.provenance.receiptCount,
      manifest.provenance.uniqueWalletCount,
    ]) {
      expect(screen.getByText(count.toLocaleString("en-US"))).toBeInTheDocument();
    }
    expect(screen.getByText(/0 game upgrade events/)).toBeInTheDocument();
  });
  it("keeps the evidence routes static, canonical and discoverable from the FAQ", () => {
    expect(pageDynamic).toBe("force-static");
    expect(jsonDynamic).toBe("force-static");
    expect(metadata.alternates?.canonical).toBe("/baseline");
    const item = FAQ_CATEGORIES.flatMap((category) => category.items).find(
      (entry) => entry.id === "historical-baseline",
    );
    expect(item?.reference?.href).toBe("/baseline");
    expect(item?.answer.join(" ")).toContain("not an on-chain receipt-proof verifier");
  });
});
