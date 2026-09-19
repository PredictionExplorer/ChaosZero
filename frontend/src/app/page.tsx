import { Suspense } from "react";
import { appConfig, COSMIC_CST_ADDRESS } from "@/lib/config";
import { organizationJsonLd, webApplicationJsonLd, webSiteJsonLd } from "@/lib/structured-data";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { IntroHero } from "@/components/layout/intro-hero";
import { MarketSkeleton } from "@/components/market/empty-states";
import { HowItWorks } from "@/components/market/how-it-works";
import { MarketGate } from "@/components/market/market-gate";
import { JsonLd } from "@/components/seo/json-ld";
import { ConnectButton } from "@/components/wallet/connect-button";
import { Providers } from "./providers";
import { sharedMarketAddress } from "@/shared/config";
import { SharedPage } from "@/shared/shared-page";
import { independentMarketAddress } from "@/independent/config";
import { IndependentPage } from "@/independent/page";

/**
 * The market page. Everything explanatory (hero, how-it-works, footer) is
 * server-rendered static HTML so crawlers, AI agents, and first paint never
 * wait for the wallet/market JavaScript; only the live market inside
 * MarketGate is a client island.
 */
export default function Home() {
  if (independentMarketAddress !== null) return <IndependentPage />;
  if (sharedMarketAddress !== null) return <SharedPage />;
  return (
    <Providers>
      <Header active="market" actions={<ConnectButton />} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <IntroHero />
        <Suspense fallback={<MarketSkeleton />}>
          <MarketGate />
        </Suspense>
        <div className="mt-12">
          <HowItWorks />
        </div>
      </main>
      <Footer marketAddress={appConfig.marketAddress} cstAddress={COSMIC_CST_ADDRESS} />
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={webSiteJsonLd()} />
      <JsonLd data={webApplicationJsonLd()} />
    </Providers>
  );
}
