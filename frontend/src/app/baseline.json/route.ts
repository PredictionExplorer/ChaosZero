import { BASELINE_JSON, BASELINE_EVIDENCE_HASH } from "@/lib/baseline";

export const dynamic = "force-static";

/** Exact public deployment input, including its review provenance. */
export function GET(): Response {
  return new Response(BASELINE_JSON, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-evidence-keccak256": BASELINE_EVIDENCE_HASH,
    },
  });
}
