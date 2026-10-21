import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * Public pages, with absolute URLs. The homepage changes every block (live
 * odds); the FAQ only changes with deploys. `?round=` views
 * canonicalize to `/`, so they are deliberately absent.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: absoluteUrl("/"),
      lastModified,
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: absoluteUrl("/baseline"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.6,
    },
    {
      url: absoluteUrl("/faq"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ];
}
