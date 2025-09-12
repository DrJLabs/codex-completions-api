import { Router } from "express";
import fsp from "node:fs/promises";
import { TOKEN_LOG_PATH } from "../dev-logging.js";
import { aggregateUsage, parseTime } from "../utils.js";

async function loadUsageEvents() {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal log path constant
    const fileContent = await fsp.readFile(TOKEN_LOG_PATH, "utf8");
    const lines = fileContent.split(/\n+/).filter(Boolean);
    return lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err && err.code === "ENOENT") return [];

    console.error("[usage] failed to read TOKEN_LOG_PATH:", err);
    return [];
  }
}

export default function usageRouter() {
  const r = Router();

  r.get("/v1/usage", async (req, res) => {
    const start = parseTime(req.query.start) || 0;
    const end = parseTime(req.query.end) || Date.now() + 1;
    const group = (req.query.group || "").toString();
    const events = await loadUsageEvents();
    const agg = aggregateUsage(events, start, end, group);
    res.json(agg);
  });

  r.get("/v1/usage/raw", async (req, res) => {
    const parsed = Number(req.query.limit);
    const base = Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
    const limit = Math.max(1, Math.min(10000, base));
    const events = await loadUsageEvents();
    const count = Math.min(limit, events.length);
    res.json({ count, events: events.slice(-limit) });
  });

  return r;
}
