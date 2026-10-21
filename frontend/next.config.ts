import type { NextConfig } from "next";
import path from "node:path";

type RedirectRule = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>[number];

const CANONICAL_ORIGIN = "https://chaoszero.com";

/**
 * Hosts that must permanently redirect to the canonical origin, path intact:
 * the pre-rebrand domain (so every old backlink, bookmark, and search result
 * transfers its equity to chaoszero.com) and the www variants (so search
 * engines see exactly one canonical host). 308s are cached by clients and
 * treated by search engines as a permanent move.
 *
 * The old-domain rules only serve while cosmicsignature.bet stays attached to
 * the deployment — keep it attached (and registered) for the migration.
 *
 * Exported for `src/next-config.test.ts`.
 */
export const DOMAIN_REDIRECTS: RedirectRule[] = [
  "cosmicsignature.bet",
  "www.cosmicsignature.bet",
  "www.chaoszero.com",
].map((host) => ({
  source: "/:path*",
  has: [{ type: "host", value: host }],
  destination: `${CANONICAL_ORIGIN}/:path*`,
  permanent: true,
}));

const nextConfig: NextConfig = {
  // Auto-memoizes components/hooks, cutting re-renders during the app's
  // frequent live-data refreshes without hand-written useMemo/useCallback.
  reactCompiler: true,
  poweredByHeader: false,
  // The public baseline imports the exact reviewed deployment input outside frontend/.
  turbopack: { root: path.join(__dirname, "..") },
  outputFileTracingRoot: path.join(__dirname, ".."),
  redirects: async () => DOMAIN_REDIRECTS,
};

export default nextConfig;
