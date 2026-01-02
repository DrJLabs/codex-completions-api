#!/usr/bin/env node
/* eslint-disable security/detect-object-injection */
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fetch from "node-fetch";
import { startServer, stopServer } from "../../tests/integration/helpers.js";

const execFileAsync = promisify(execFile);

const ITERATIONS = Number(process.env.BENCH_ITERATIONS || 30);
const CHOICE_COUNTS = (process.env.BENCH_COUNTS || "1,2,5")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const CODEX_BIN = process.env.BENCH_CODEX_BIN || "scripts/fake-codex-jsonrpc.js";

function computeStats(samples) {
  if (!samples.length) {
    return { avg: 0, min: 0, max: 0, p95: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const idx95 = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95 = sorted[idx95];
  return { avg, min, max, p95 };
}

async function captureProcessSnapshot(pid) {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "rss=,%cpu="]);
    const [rssStr = "", cpuStr = ""] = stdout.trim().split(/\s+/);
    const rssKb = Number.parseFloat(rssStr);
    const cpuPercent = Number.parseFloat(cpuStr);
    return {
      rss_mb: Number.isFinite(rssKb) ? rssKb / 1024 : null,
      cpu_percent: Number.isFinite(cpuPercent) ? cpuPercent : null,
    };
  } catch {
    return {
      rss_mb: null,
      cpu_percent: null,
    };
  }
}

async function runStreamingRequest(port, n) {
  const payload = {
    model: "codex-5",
    stream: true,
    stream_options: { include_usage: true },
    n,
    messages: [{ role: "user", content: `Benchmark request n=${n}` }],
  };

  const start = performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions?stream=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-sk-ci",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  const durationMs = performance.now() - start;

  if (!res.ok) {
    throw new Error(`Stream request failed: ${res.status} ${text}`);
  }

  return durationMs;
}

async function benchmarkScenario(port, pid, n) {
  const durations = [];

  // Warmup
  await runStreamingRequest(port, n);

  for (let i = 0; i < ITERATIONS; i += 1) {
    durations.push(await runStreamingRequest(port, n));
  }

  const stats = computeStats(durations);
  const totalDurationMs = durations.reduce((sum, value) => sum + value, 0);
  const throughputRps = durations.length / (totalDurationMs / 1000 || 1);
  const snapshot = await captureProcessSnapshot(pid);

  return {
    n,
    iterations: durations.length,
    duration_ms: stats,
    throughput_rps: throughputRps,
    process: snapshot,
  };
}

function formatScenario(result) {
  const rss = result.process.rss_mb === null ? "n/a" : `${result.process.rss_mb.toFixed(2)} MB`;
  const cpu =
    result.process.cpu_percent === null ? "n/a" : `${result.process.cpu_percent.toFixed(1)}%`;
  return [
    result.n,
    result.iterations,
    `${result.duration_ms.avg.toFixed(1)} ms`,
    `${result.duration_ms.p95.toFixed(1)} ms`,
    `${result.duration_ms.max.toFixed(1)} ms`,
    result.throughput_rps.toFixed(2),
    rss,
    cpu,
  ];
}

function safeCell(row, index) {
  if (!Array.isArray(row)) return "";
  if (index < 0 || index >= row.length) return "";
  const value = row[index];
  return value === undefined || value === null ? "" : value;
}

function printTable(results) {
  const header = [
    "n",
    "iterations",
    "avg latency",
    "p95 latency",
    "max latency",
    "throughput",
    "rss",
    "cpu",
  ];
  const rows = results.map(formatScenario);
  const table = [header, ...rows];
  const widths = header.map((_, idx) =>
    Math.max(...table.map((row) => String(safeCell(row, idx)).length))
  );
  const formatRow = (row) =>
    header
      .map((_, idx) => {
        const str = String(safeCell(row, idx));
        return str.padEnd(widths[idx], " ");
      })
      .join("  ");
  console.log(formatRow(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

async function main() {
  if (!CHOICE_COUNTS.length) {
    console.error("No choice counts specified. Set BENCH_COUNTS or use default 1,2,5.");
    process.exit(1);
  }

  const serverCtx = await startServer({ CODEX_BIN });
  const results = [];

  try {
    for (const n of CHOICE_COUNTS) {
      console.log(`\nRunning streaming benchmark for n=${n} (iterations=${ITERATIONS})...`);
      const scenario = await benchmarkScenario(serverCtx.PORT, serverCtx.child.pid, n);
      results.push(scenario);
    }
  } finally {
    await stopServer(serverCtx.child);
  }

  console.log("\nMulti-choice streaming benchmark summary");
  printTable(results);

  const maxRss = Math.max(
    ...results.map((result) => (result.process.rss_mb === null ? 0 : result.process.rss_mb))
  );
  console.log(`\nPeak RSS observed: ${maxRss.toFixed(2)} MB`);

  const report = {
    captured_at: new Date().toISOString(),
    iterations: ITERATIONS,
    counts: CHOICE_COUNTS,
    results,
  };
  console.log("\nJSON summary:\n" + JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
