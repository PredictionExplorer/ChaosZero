import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * A query client for tests: no retries unless a hook asks for them, and no
 * retry backoff when it does, so failures surface immediately.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** A render wrapper providing `queryClient` (for hooks built on react-query). */
export function withQueryClient(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}
