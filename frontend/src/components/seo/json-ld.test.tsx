import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonLd } from "./json-ld";

describe("JsonLd", () => {
  it("renders an application/ld+json script whose payload parses back to the input", () => {
    const data = { "@context": "https://schema.org", "@type": "WebSite", name: "Chaos Zero" };
    const { container } = render(<JsonLd data={data} />);

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.innerHTML)).toEqual(data);
  });

  it("never embeds a raw < that could break out of the script tag", () => {
    const { container } = render(
      <JsonLd data={{ name: "</script><img src=x onerror=alert(1)>" }} />,
    );
    const script = container.querySelector("script")!;
    expect(script.innerHTML).not.toContain("<");
    expect(script.innerHTML).toContain("\\u003c");
  });
});
