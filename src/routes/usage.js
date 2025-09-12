import { Router } from "express";
import fs from "node:fs";
import { TOKEN_LOG_PATH } from "../dev-logging.js";
import { aggregateUsage, parseTime } from "../utils.js";

function loadUsageEvents() {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal path
    if (!fs.existsSync(TOKEN_LOG_PATH)) return [];
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal path
    const lines = fs.readFileSync(TOKEN_LOG_PATH, "utf8").split(/\n+/).filter(Boolean);
    return lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export default function usageRouter() {
  const r = Router();

  r.get("/v1/usage", (req, res) => {
    const start = parseTime(req.query.start) || 0;
    const end = parseTime(req.query.end) || Date.now() + 1;
    const group = (req.query.group || "").toString();
    const events = loadUsageEvents();
    const agg = aggregateUsage(events, start, end, group);
    res.json(agg);
  });

  r.get("/v1/usage/raw", (req, res) => {
    const limit = Math.max(1, Math.min(10000, Number(req.query.limit || 200)));
    const events = loadUsageEvents();
    res.json({ count: Math.min(limit, events.length), events: events.slice(-limit) });
  });

  return r;
}
