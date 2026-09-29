/** Parses server-rendered HTML into a detached document fragment for querying. */
export function parseHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

/** Every JSON-LD block in `root`, parsed, in document order. */
export function readJsonLd(root: ParentNode): Record<string, unknown>[] {
  return [...root.querySelectorAll('script[type="application/ld+json"]')].map(
    (script) => JSON.parse(script.textContent ?? "") as Record<string, unknown>,
  );
}
