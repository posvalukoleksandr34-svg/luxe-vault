import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarChart } from "../components/BarChart";
import { Markdown } from "../components/Markdown";
import { usd } from "../lib/format";
import { coreStateFrom } from "../lib/realtime";
import { encodeWav } from "../voice/client";

describe("Markdown", () => {
  it("renders lists, bold and links but never raw HTML", () => {
    const { container } = render(<Markdown text={"**Итог**\n- один\n- два\n<img src=x onerror=alert(1)> [док](https://example.org)"} />);
    expect(container.querySelector("strong")?.textContent).toBe("Итог");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("img")).toBeNull();
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.org");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("does not linkify javascript: urls", () => {
    const { container } = render(<Markdown text={"[x](javascript:alert(1))"} />);
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("BarChart", () => {
  it("renders one hit target per bar with an accessible label", () => {
    render(<BarChart data={[{ key: "a", label: "1 сент", value: 1.5 }, { key: "b", label: "2 сент", value: 0.25 }]} format={(v) => usd(v)} label="Расходы" />);
    expect(screen.getByLabelText("1 сент: $1.50")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Расходы" })).toBeInTheDocument();
  });
});

describe("voice", () => {
  it("encodes 16 kHz mono PCM16 WAV", () => {
    const buf = encodeWav(new Float32Array([0, 1, -1]));
    const v = new DataView(buf);
    expect(String.fromCharCode(...new Uint8Array(buf.slice(0, 4)))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
  });
});

describe("core state", () => {
  it("prioritises approvals, then tools, then thinking", () => {
    const now = Date.now();
    expect(coreStateFrom({}, false, null)).toBe("offline");
    expect(coreStateFrom({ a: { state: "thinking", label: "", at: now }, b: { state: "waiting_approval", label: "", at: now } }, true, null)).toBe("waiting");
    expect(coreStateFrom({ a: { state: "tool", label: "", at: now } }, true, null)).toBe("tool");
    expect(coreStateFrom({}, true, "speaking")).toBe("speaking");
  });
});
