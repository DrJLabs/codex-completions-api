import { EventEmitter, once } from "node:events";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { spawnCodex } from "../codex-runner.js";
import { config as CFG } from "../../config/index.js";

const LOG_PREFIX = "[proxy][worker-supervisor]";
const READY_EVENT_KEYS = new Set(["ready", "listening", "healthy"]);

const quote = (value) => `"${String(value).replaceAll('"', '\\"')}"`;

function buildSupervisorArgs() {
  const args = ["app-server"];
  const model = (CFG.CODEX_MODEL || "gpt-5").trim();
  args.push("--model", model);

  const pushConfig = (key, value) => {
    args.push("--config", `${key}=${value}`);
  };

  pushConfig("preferred_auth_method", '"chatgpt"');
  const sandboxMode = (CFG.PROXY_SANDBOX_MODE || "danger-full-access").trim();
  pushConfig("sandbox_mode", quote(sandboxMode));

  const provider = (CFG.CODEX_FORCE_PROVIDER || "").trim();
  if (provider) pushConfig("model_provider", quote(provider));

  if (CFG.PROXY_ENABLE_PARALLEL_TOOL_CALLS) {
    pushConfig("parallel_tool_calls", quote("true"));
  }

  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function parseMaybeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function createInitialHealthState(reason = "worker_not_started") {
  const ts = nowIso();
  return {
    readiness: {
      ready: false,
      reason,
      since: ts,
      last_change_at: ts,
      handshake: null,
      details: {},
    },
    liveness: {
      live: false,
      reason,
      since: ts,
      last_change_at: ts,
      details: {},
    },
  };
}

class CodexWorkerSupervisor extends EventEmitter {
  constructor(config) {
    super();
    this.cfg = config;
    this.state = {
      running: false,
      ready: false,
      shutdownInFlight: false,
      child: null,
      startAttempts: 0,
      restarts: 0,
      consecutiveFailures: 0,
      lastExit: null,
      lastReadyAt: null,
      startupLatencyMs: null,
      launchStartedAt: null,
      nextBackoffMs: this.cfg.WORKER_BACKOFF_INITIAL_MS,
      restartTimer: null,
      lastLogSample: null,
      health: createInitialHealthState(),
    };
  }

  #updateReadiness({ ready, reason, handshake, details }) {
    const prev = this.state.health.readiness;
    const changed = prev.ready !== ready || prev.reason !== reason;
    const ts = nowIso();
    const nextHandshake = handshake === undefined ? prev.handshake : handshake;
    const nextDetails =
      details === undefined ? prev.details : { ...(prev.details ?? {}), ...details };
    this.state.health.readiness = {
      ready,
      reason,
      since: changed ? ts : prev.since,
      last_change_at: ts,
      handshake: nextHandshake,
      details: nextDetails,
    };
  }

  #updateLiveness({ live, reason, details }) {
    const prev = this.state.health.liveness;
    const changed = prev.live !== live || prev.reason !== reason;
    const ts = nowIso();
    const nextDetails =
      details === undefined ? prev.details : { ...(prev.details ?? {}), ...details };
    this.state.health.liveness = {
      live,
      reason,
      since: changed ? ts : prev.since,
      last_change_at: ts,
      details: nextDetails,
    };
  }

  #extractHandshakeDetails(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const models = Array.isArray(payload.models)
      ? payload.models
      : Array.isArray(payload.advertised_models)
        ? payload.advertised_models
        : Array.isArray(payload.available_models)
          ? payload.available_models
          : undefined;
    const handshake = {
      event: payload.event ?? payload.status ?? payload.type ?? null,
      received_at: nowIso(),
    };
    if (Array.isArray(models)) {
      handshake.models = models;
    }
    if (typeof payload.model === "string") {
      handshake.model = payload.model;
    }
    if (typeof payload.version === "string") {
      handshake.version = payload.version;
    }
    return handshake;
  }

  start() {
    if (this.state.running && !this.state.shutdownInFlight) {
      return;
    }
    if (this.state.shutdownInFlight) {
      // Cancel any pending shutdown before re-starting
      this.state.shutdownInFlight = false;
    }
    this.state.running = true;
    const nextAttempt = this.state.startAttempts + 1;
    this.#updateLiveness({
      live: true,
      reason: "worker_starting",
      details: { attempt: nextAttempt },
    });
    this.#launch();
  }

  isRunning() {
    return this.state.running && !this.state.shutdownInFlight;
  }

  isReady() {
    return this.state.ready;
  }

  status() {
    const metrics = {
      codex_worker_restarts_total: this.state.restarts,
      codex_worker_latency_ms: this.state.startupLatencyMs,
    };
    const readiness = this.state.health.readiness;
    const liveness = this.state.health.liveness;
    return {
      enabled: true,
      running: this.state.running,
      ready: this.state.ready,
      shutdown_in_flight: this.state.shutdownInFlight,
      pid: this.state.child?.pid ?? null,
      restarts_total: this.state.restarts,
      consecutive_failures: this.state.consecutiveFailures,
      last_exit: this.state.lastExit,
      last_ready_at: this.state.lastReadyAt,
      startup_latency_ms: this.state.startupLatencyMs,
      next_restart_delay_ms: this.state.restartTimer ? this.state.nextBackoffMs : 0,
      last_log_sample: this.state.lastLogSample,
      metrics,
      readiness: readiness ? { ...readiness } : undefined,
      liveness: liveness ? { ...liveness } : undefined,
      health: {
        readiness: readiness ? { ...readiness } : undefined,
        liveness: liveness ? { ...liveness } : undefined,
      },
    };
  }

  async waitForReady(timeoutMs = this.cfg.WORKER_STARTUP_TIMEOUT_MS) {
    if (this.state.ready) return;
    const start = performance.now();
    while (!this.state.ready) {
      const elapsed = performance.now() - start;
      if (elapsed >= timeoutMs) {
        throw new Error(`worker readiness timeout after ${timeoutMs}ms`);
      }

      await delay(50);
    }
  }

  async shutdown({ signal = "SIGTERM", reason = "shutdown" } = {}) {
    if (!this.state.running) return;
    if (this.state.shutdownInFlight) return;
    this.state.shutdownInFlight = true;
    this.state.ready = false;
    this.state.launchStartedAt = null;
    const shutdownReason = reason;
    this.#updateReadiness({
      ready: false,
      reason: "shutdown_initiated",
      details: { signal, reason: shutdownReason },
    });
    this.#updateLiveness({
      live: false,
      reason: "shutdown_in_progress",
      details: { signal, reason: shutdownReason },
    });
    const child = this.state.child;
    this.#clearRestartTimer();
    if (!child) {
      this.state.running = false;
      this.#updateLiveness({
        live: false,
        reason: "shutdown_complete",
        details: { signal, reason: shutdownReason },
      });
      return;
    }
    console.log(
      `${LOG_PREFIX} draining worker pid=${child.pid} signal=${signal} reason=${reason} grace_ms=${this.cfg.WORKER_SHUTDOWN_GRACE_MS}`
    );
    try {
      child.kill(signal);
    } catch (err) {
      console.error(`${LOG_PREFIX} failed to forward ${signal}:`, err);
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      this.state.running = false;
      this.#updateLiveness({
        live: false,
        reason: "shutdown_complete",
        details: { exit: { code: child.exitCode, signal: child.signalCode } },
      });
      return;
    }

    const grace = this.cfg.WORKER_SHUTDOWN_GRACE_MS;
    try {
      await Promise.race([
        once(child, "exit"),
        delay(grace).then(() => {
          throw new Error("shutdown_grace_exceeded");
        }),
      ]);
    } catch (err) {
      console.warn(`${LOG_PREFIX} shutdown grace exceeded, sending SIGKILL`, err);
      try {
        child.kill("SIGKILL");
      } catch (killErr) {
        console.error(`${LOG_PREFIX} failed to SIGKILL worker:`, killErr);
      }
      try {
        await once(child, "exit");
      } catch {}
    } finally {
      this.state.running = false;
      this.state.child = null;
      this.#updateLiveness({
        live: false,
        reason: "shutdown_complete",
        details: { signal, reason: shutdownReason },
      });
    }
  }

  #launch() {
    this.state.startAttempts += 1;
    this.state.ready = false;
    this.state.startupLatencyMs = null;
    this.state.launchStartedAt = performance.now();
    this.#updateReadiness({
      ready: false,
      reason: "worker_launching",
      details: { attempt: this.state.startAttempts },
    });
    const startedAt = this.state.launchStartedAt;
    const launchArgs = buildSupervisorArgs();
    console.log(
      `${LOG_PREFIX} launching app-server attempt=${this.state.startAttempts} args=${launchArgs
        .slice(1)
        .join(" ")}`
    );
    const child = spawnCodex(launchArgs, {
      env: {
        ...process.env,
        CODEX_WORKER_SUPERVISED: "true",
      },
    });
    this.state.child = child;
    this.emit("spawn", child);

    try {
      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
    } catch {}

    const attach = (streamName, stream) => {
      if (!stream) return;
      const rl = createInterface({ input: stream });
      rl.on("line", (line) => this.#handleStreamLine(streamName, line));
    };
    attach("stdout", child.stdout);
    attach("stderr", child.stderr);

    child.on("spawn", () => {
      console.log(`${LOG_PREFIX} spawned pid=${child.pid}`);
      this.#updateLiveness({
        live: true,
        reason: "worker_running",
        details: { pid: child.pid, restarts_total: this.state.restarts },
      });
    });

    child.on("error", (err) => {
      console.error(`${LOG_PREFIX} spawn error:`, err);
      this.#handleExit({ code: null, signal: null, error: err });
    });

    child.on("exit", (code, signal) => {
      this.#handleExit({ code, signal, error: null });
    });

    const readyWatcher = async () => {
      try {
        await this.waitForReady(this.cfg.WORKER_STARTUP_TIMEOUT_MS);
        // Reset backoff after successful ready signal
        this.state.nextBackoffMs = this.cfg.WORKER_BACKOFF_INITIAL_MS;
        this.state.consecutiveFailures = 0;
        const now = performance.now();
        this.state.startupLatencyMs = Math.round(now - startedAt);
        this.state.lastReadyAt = nowIso();
        console.log(
          `${LOG_PREFIX} worker ready pid=${child.pid} latency_ms=${this.state.startupLatencyMs}`
        );
        this.#updateReadiness({
          ready: true,
          reason: "handshake_complete",
          details: {
            startup_latency_ms: this.state.startupLatencyMs,
            restarts_total: this.state.restarts,
          },
        });
      } catch (err) {
        console.warn(`${LOG_PREFIX} readiness wait timed out: ${err.message}`);
      }
    };
    readyWatcher();
  }

  getChildProcess() {
    return this.state.child;
  }

  #handleStreamLine(streamName, rawLine) {
    const line = rawLine?.toString?.() ?? "";
    const trimmed = line.trim();
    if (!trimmed) return;
    this.state.lastLogSample = { stream: streamName, line: trimmed, ts: nowIso() };
    let parsed = null;
    if (trimmed.startsWith("{")) parsed = parseMaybeJson(trimmed);
    const payload = parsed || { message: trimmed };
    try {
      console.log(`${LOG_PREFIX} ${streamName} ${JSON.stringify(payload)}`);
    } catch {
      console.log(`${LOG_PREFIX} ${streamName} ${trimmed}`);
    }
    if (parsed) {
      const ready =
        parsed.ready === true ||
        READY_EVENT_KEYS.has(String(parsed.event || parsed.status || "").toLowerCase());
      if (ready) {
        this.state.ready = true;
        this.state.consecutiveFailures = 0;
        this.#updateReadiness({
          ready: true,
          reason: "handshake_complete",
          handshake: this.#extractHandshakeDetails(parsed),
          details: {
            event: parsed.event ?? parsed.status ?? parsed.type ?? "ready",
          },
        });
        if (this.state.startupLatencyMs == null && this.state.launchStartedAt != null) {
          const now = performance.now();
          this.state.startupLatencyMs = Math.round(now - this.state.launchStartedAt);
          this.state.lastReadyAt = nowIso();
        }
        this.emit("ready", {
          child: this.state.child,
          payload: parsed,
        });
      }
    }
  }

  #handleExit({ code, signal, error }) {
    if (this.state.restartTimer) {
      clearTimeout(this.state.restartTimer);
      this.state.restartTimer = null;
    }
    const exitInfo = {
      at: nowIso(),
      code,
      signal,
      error: error ? error.message || String(error) : null,
    };
    this.state.lastExit = exitInfo;
    this.emit("exit", exitInfo);
    this.state.launchStartedAt = null;
    if (this.state.shutdownInFlight) {
      this.state.child = null;
      this.state.running = false;
      this.#updateReadiness({
        ready: false,
        reason: "shutdown_in_progress",
        details: { exit: exitInfo },
      });
      this.#updateLiveness({
        live: false,
        reason: "shutdown_in_progress",
        details: { exit: exitInfo },
      });
      console.log(`${LOG_PREFIX} worker exited during shutdown code=${code} signal=${signal}`);
      return;
    }
    this.state.ready = false;
    this.state.child = null;
    this.state.restarts += 1;
    this.state.consecutiveFailures += 1;
    this.#updateReadiness({
      ready: false,
      reason: "worker_exit",
      details: {
        exit: exitInfo,
        restarts_total: this.state.restarts,
      },
    });
    console.warn(
      `${LOG_PREFIX} worker exited code=${code} signal=${signal} restarts_total=${this.state.restarts}`
    );
    if (this.state.restarts > this.cfg.WORKER_RESTART_MAX) {
      console.error(
        `${LOG_PREFIX} reached WORKER_RESTART_MAX=${this.cfg.WORKER_RESTART_MAX}; supervisor halted`
      );
      this.state.running = false;
      this.#updateLiveness({
        live: false,
        reason: "restart_limit_exceeded",
        details: {
          exit: exitInfo,
          restarts_total: this.state.restarts,
        },
      });
      return;
    }
    const delayMs = Math.min(this.state.nextBackoffMs, this.cfg.WORKER_BACKOFF_MAX_MS);
    console.warn(`${LOG_PREFIX} scheduling restart in ${delayMs}ms`);
    this.state.nextBackoffMs = Math.min(delayMs * 2, this.cfg.WORKER_BACKOFF_MAX_MS);
    this.#updateLiveness({
      live: true,
      reason: "worker_restarting",
      details: {
        exit: exitInfo,
        restarts_total: this.state.restarts,
        next_restart_delay_ms: delayMs,
      },
    });
    this.state.restartTimer = setTimeout(() => {
      this.state.restartTimer = null;
      if (this.state.shutdownInFlight) return;
      this.#launch();
    }, delayMs);
  }

  #clearRestartTimer() {
    if (this.state.restartTimer) {
      clearTimeout(this.state.restartTimer);
      this.state.restartTimer = null;
    }
  }
}

let supervisor;

export function getWorkerSupervisor() {
  if (!supervisor) {
    supervisor = new CodexWorkerSupervisor(CFG);
  }
  return supervisor;
}

export function ensureWorkerSupervisor() {
  const instance = getWorkerSupervisor();
  instance.start();
  return instance;
}

export function getWorkerChildProcess() {
  const instance = getWorkerSupervisor();
  return instance.getChildProcess();
}

export function onWorkerSupervisorEvent(event, listener) {
  const instance = getWorkerSupervisor();
  instance.on(event, listener);
  return () => {
    try {
      instance.off(event, listener);
    } catch {}
  };
}

export function isWorkerSupervisorReady() {
  if (!supervisor) return false;
  return supervisor.isReady();
}

export function isWorkerSupervisorRunning() {
  if (!supervisor) return false;
  return supervisor.isRunning();
}

export function getWorkerStatus() {
  if (!supervisor) {
    const health = createInitialHealthState("supervisor_not_initialized");
    return {
      enabled: false,
      running: false,
      ready: false,
      shutdown_in_flight: false,
      pid: null,
      restarts_total: 0,
      consecutive_failures: 0,
      last_exit: null,
      last_ready_at: null,
      startup_latency_ms: null,
      next_restart_delay_ms: 0,
      last_log_sample: null,
      metrics: {
        codex_worker_restarts_total: 0,
        codex_worker_latency_ms: null,
      },
      readiness: { ...health.readiness },
      liveness: { ...health.liveness },
      health,
    };
  }
  return supervisor.status();
}
