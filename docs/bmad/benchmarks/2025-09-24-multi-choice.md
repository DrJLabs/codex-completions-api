---
title: Benchmark — Multi-Choice Streaming (Story 4.3)
date: 2025-09-24
story: docs/bmad/stories/4.3.multi-choice-and-error-lexicon.md
labels: [benchmark, streaming, multi_choice]
---

## Context

- Goal: quantify CPU and RSS impact of enabling `n>1` chat completions streaming per Story 4.3.
- Harness: `node scripts/benchmarks/stream-multi-choice.mjs` (30 iterations per scenario, `scripts/fake-codex-proto.js` backend).
- Environment: local dev machine, single proxy process, `stream_options.include_usage:true`.

## Results

| n   | Iterations | Avg Latency (ms) | P95 Latency (ms) | Max Latency (ms) | Throughput (req/s) | RSS (MB) | CPU (%) |
| --- | ---------- | ---------------- | ---------------- | ---------------- | ------------------ | -------- | ------- |
| 1   | 30         | 75.8             | 78.5             | 88.7             | 13.20              | 67.68    | 11.8    |
| 2   | 30         | 75.9             | 81.7             | 84.0             | 13.18              | 68.64    | 9.8     |
| 5   | 30         | 75.6             | 80.5             | 83.0             | 13.23              | 69.77    | 9.0     |

- Peak RSS remains < 70 MB across scenarios (Δ ≈ +2 MB from single-choice baseline).
- Latency/throughput variations are within ±1 ms and ±0.05 req/s, indicating negligible overhead for broadcasting deltas per choice.
- Observed CPU percentages stay below 12%, so no changes to `PROXY_MAX_CONCURRENT_STREAMS` are required for parity workloads.

## Notes

- Metrics capture steady-state streaming using the deterministic fake Codex proto shim; production runs should be re-validated with real upstream latency once available.
- Benchmark artifacts printed JSON summary to stdout for reproducibility (see command log in Story 4.3 Dev Notes).
