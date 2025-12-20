import { describe, it, expect } from "vitest";
import {
  normalizeModel,
  impliedEffortForModel,
  joinMessages,
  stripAnsi,
  estTokens,
  estTokensForMessages,
  parseTime,
  aggregateUsage,
  isModelText,
  applyCors,
} from "../../src/utils.js";

describe("model utils", () => {
  it("normalizes codex-5 to effective default", () => {
    const r = normalizeModel("codex-5", "gpt-5");
    expect(r).toEqual({ requested: "codex-5", effective: "gpt-5" });
  });
  it("implies effort from codex-5-high", () => {
    expect(impliedEffortForModel("codex-5-high")).toBe("high");
    expect(impliedEffortForModel("codex-5-minimal")).toBe("minimal");
    expect(impliedEffortForModel("gpt-5")).toBe("");
  });
  it("normalizes codev-5.1-L to gpt-5.1 with low effort", () => {
    const r = normalizeModel("codev-5.1-L", "gpt-5");
    expect(r).toEqual({ requested: "codev-5.1-l", effective: "gpt-5.1" });
    expect(impliedEffortForModel("codev-5.1-L")).toBe("low");
  });
  it("normalizes codev-5.2-L to gpt-5.2 with low effort", () => {
    const r = normalizeModel("codev-5.2-L", "gpt-5");
    expect(r).toEqual({ requested: "codev-5.2-l", effective: "gpt-5.2" });
    expect(impliedEffortForModel("codev-5.2-L")).toBe("low");
  });
  it("normalizes codev-5.2-XH to gpt-5.2 with xhigh effort", () => {
    const r = normalizeModel("codev-5.2-XH", "gpt-5");
    expect(r).toEqual({ requested: "codev-5.2-xh", effective: "gpt-5.2" });
    expect(impliedEffortForModel("codev-5.2-XH")).toBe("xhigh");
  });
  it("normalizes gpt-5.2-codev-L to gpt-5.2 with low effort", () => {
    const r = normalizeModel("gpt-5.2-codev-L", "gpt-5");
    expect(r).toEqual({ requested: "gpt-5.2-codev-l", effective: "gpt-5.2" });
    expect(impliedEffortForModel("gpt-5.2-codev-L")).toBe("low");
  });
  it("normalizes gpt-5.2-codex-L to gpt-5.2 with low effort", () => {
    const r = normalizeModel("gpt-5.2-codex-L", "gpt-5");
    expect(r).toEqual({ requested: "gpt-5.2-codex-l", effective: "gpt-5.2" });
    expect(impliedEffortForModel("gpt-5.2-codex-L")).toBe("low");
  });
  it("normalizes other gpt-5.2-codev aliases to gpt-5.2 with implied effort", () => {
    const cases = [
      { id: "gpt-5.2-codev-M", effort: "medium" },
      { id: "gpt-5.2-codev-H", effort: "high" },
      { id: "gpt-5.2-codev-XH", effort: "xhigh" },
    ];
    for (const { id, effort } of cases) {
      const r = normalizeModel(id, "gpt-5");
      expect(r).toEqual({ requested: id.toLowerCase(), effective: "gpt-5.2" });
      expect(impliedEffortForModel(id)).toBe(effort);
    }
  });
  it("normalizes other gpt-5.2-codex aliases to gpt-5.2 with implied effort", () => {
    const cases = [
      { id: "gpt-5.2-codex-M", effort: "medium" },
      { id: "gpt-5.2-codex-H", effort: "high" },
      { id: "gpt-5.2-codex-XH", effort: "xhigh" },
    ];
    for (const { id, effort } of cases) {
      const r = normalizeModel(id, "gpt-5");
      expect(r).toEqual({ requested: id.toLowerCase(), effective: "gpt-5.2" });
      expect(impliedEffortForModel(id)).toBe(effort);
    }
  });
  it("normalizes gpt-5.2-* aliases to gpt-5.2 with implied effort", () => {
    const cases = [
      { id: "gpt-5.2-L", effort: "low" },
      { id: "gpt-5.2-M", effort: "medium" },
      { id: "gpt-5.2-H", effort: "high" },
      { id: "gpt-5.2-XH", effort: "xhigh" },
    ];
    for (const { id, effort } of cases) {
      const r = normalizeModel(id, "gpt-5");
      expect(r).toEqual({ requested: id.toLowerCase(), effective: "gpt-5.2" });
      expect(impliedEffortForModel(id)).toBe(effort);
    }
  });
  it("accepts uppercase ids inside the provided publicIds list", () => {
    const r = normalizeModel("codev-5.1-H", "gpt-5", ["codev-5.1-H"]);
    expect(r).toEqual({ requested: "codev-5.1-h", effective: "gpt-5.1" });
  });
  it("passes through custom model name", () => {
    const r = normalizeModel("my-model", "gpt-5");
    expect(r).toEqual({ requested: "my-model", effective: "my-model" });
  });
});

describe("prompt and tokens", () => {
  it("joins messages with role prefixes", () => {
    const s = joinMessages([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
    expect(s).toContain("[user] Hi");
    expect(s).toContain("[assistant] Hello");
  });
  it("strips ansi/control sequences", () => {
    const out = stripAnsi("\u001b[31mRed\u001b[0m\rText\u0008");
    expect(out).toBe("RedText");
  });
  it("estimates tokens for strings and messages", () => {
    expect(estTokens("abcd")).toBe(1);
    expect(estTokens("abcdabcd")).toBe(2);
    const msgs = [{ content: "hello" }, { content: ["a", "b"] }];
    expect(estTokensForMessages(msgs)).toBeGreaterThan(0);
  });
});

describe("time and usage", () => {
  it("parses epoch and ISO, invalid to 0", () => {
    expect(parseTime("0")).toBe(0);
    expect(parseTime("1690000000000")).toBe(1690000000000);
    const iso = "2025-01-01T00:00:00Z";
    expect(parseTime(iso)).toBe(Date.parse(iso));
    expect(parseTime("not-a-date")).toBe(0);
  });
  it("aggregates totals and buckets by hour", () => {
    const t0 = Date.parse("2025-01-01T01:00:00Z");
    const t1 = Date.parse("2025-01-01T01:15:00Z");
    const t2 = Date.parse("2025-01-01T02:05:00Z");
    const events = [
      { ts: t0, prompt_tokens_est: 10, completion_tokens_est: 5, total_tokens_est: 15 },
      { ts: t1, prompt_tokens_est: 2, completion_tokens_est: 3, total_tokens_est: 5 },
      { ts: t2, prompt_tokens_est: 1, completion_tokens_est: 1, total_tokens_est: 2 },
    ];
    const agg = aggregateUsage(events, t0, t2 + 1, "hour");
    expect(agg.total_requests).toBe(3);
    expect(agg.buckets.length).toBe(2);
    const sum = agg.prompt_tokens_est + agg.completion_tokens_est;
    expect(sum).toBe(10 + 5 + 2 + 3 + 1 + 1);
  });
});

describe("text filtering", () => {
  it("filters out patch/log lines but keeps normal text", () => {
    expect(isModelText("*** Begin Patch")).toBe(false);
    expect(isModelText("diff --git a b")).toBe(false);
    expect(isModelText("running: foo")).toBe(false);
    expect(isModelText("Hello model")).toBe(true);
  });
});

describe("CORS utility", () => {
  it("reflects origin and sets vary/creds when enabled and origin present", () => {
    const headers = {};
    const res = {
      setHeader: (k, v) => {
        // test helper: dynamic header assignment
        // eslint-disable-next-line security/detect-object-injection
        headers[k] = v;
      },
    };
    applyCors({ headers: { origin: "http://x" } }, res, true);
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://x");
    expect(headers["Vary"]).toBe(
      "Origin, Access-Control-Request-Headers, Access-Control-Request-Method"
    );
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
  });
  it("sets wildcard origin when enabled and no origin present", () => {
    const headers = {};
    const res = {
      setHeader: (k, v) => {
        // test helper: dynamic header assignment
        // eslint-disable-next-line security/detect-object-injection
        headers[k] = v;
      },
    };
    applyCors({ headers: {} }, res, true);
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
  });
  it("only reflects whitelisted origins when provided", () => {
    const headers = {};
    const res = {
      setHeader: (k, v) => {
        // test helper: dynamic header assignment
        // eslint-disable-next-line security/detect-object-injection
        headers[k] = v;
      },
    };
    applyCors({ headers: { origin: "https://ok" } }, res, true, ["https://ok", "https://nope"]);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://ok");

    const denied = {};
    const deniedRes = {
      setHeader: (k, v) => {
        // eslint-disable-next-line security/detect-object-injection
        denied[k] = v;
      },
    };
    applyCors({ headers: { origin: "https://evil" } }, deniedRes, true, ["https://ok"]);
    expect(denied).not.toHaveProperty("Access-Control-Allow-Origin");
  });

  it("normalizes capacitor, Obsidian, and localhost origins", () => {
    const allowlist = [
      "capacitor://localhost",
      "app://obsidian.md",
      "http://localhost",
      "https://localhost",
    ];

    const variants = [
      "Capacitor://LOCALHOST",
      "capacitor://localhost/",
      "capacitor://localhost:8080",
      "app://obsidian.md/",
      "http://localhost:5173",
      "HTTP://LOCALHOST",
      "https://localhost/",
      "https://localhost:443",
    ];

    for (const origin of variants) {
      const headers = {};
      const res = {
        setHeader: (k, v) => {
          // eslint-disable-next-line security/detect-object-injection
          headers[k] = v;
        },
      };
      applyCors({ headers: { origin } }, res, true, allowlist);
      expect(headers["Access-Control-Allow-Origin"]).toBe(origin);
    }

    const deniedOrigins = [
      "capacitor://example.com",
      "capacitor://localhost.attacker",
      "app://obsidian.md.fake",
    ];

    for (const deniedOrigin of deniedOrigins) {
      let allowOriginSet = false;
      applyCors(
        { headers: { origin: deniedOrigin } },
        {
          setHeader: (k) => {
            if (k === "Access-Control-Allow-Origin") {
              allowOriginSet = true;
            }
          },
        },
        true,
        allowlist
      );
      expect(allowOriginSet).toBe(false);
    }
  });
});
