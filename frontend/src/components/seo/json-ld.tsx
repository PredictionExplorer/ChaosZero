import type { JsonLd as JsonLdData } from "@/lib/structured-data";
import { serializeJsonLd } from "@/lib/structured-data";

/**
 * Embeds schema.org structured data. A plain <script> (not next/script) is
 * correct here: JSON-LD is data, not executable code, and it must be present
 * in the server-rendered HTML for crawlers that don't run JavaScript.
 */
export function JsonLd({ data }: { data: JsonLdData }) {
  // dangerouslySetInnerHTML is safe here: serializeJsonLd escapes every "<".
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
