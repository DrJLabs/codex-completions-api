const clampNonNegative = (value) => (value > 0 ? value : 0);

class ConcurrencySemaphore {
  constructor() {
    this._count = 0;
  }

  tryAcquire(limit) {
    const limitNum = Number.isFinite(limit) ? Number(limit) : Number(limit || 0);
    const safeLimit = Number.isNaN(limitNum) ? 0 : limitNum;
    const before = this._count;
    if (safeLimit <= 0) {
      return {
        acquired: true,
        before,
        after: before,
        limit: safeLimit,
        release: () => {},
        released: true,
      };
    }
    if (before >= safeLimit) {
      return {
        acquired: false,
        before,
        after: before,
        limit: safeLimit,
        release: () => {},
        released: true,
      };
    }
    this._count += 1;
    const token = {
      acquired: true,
      before,
      after: this._count,
      limit: safeLimit,
      released: false,
      release: () => {
        if (token.released) return;
        token.released = true;
        this._count = clampNonNegative(this._count - 1);
      },
    };
    return token;
  }

  releaseAll() {
    this._count = 0;
  }

  snapshot() {
    return clampNonNegative(this._count);
  }
}

export const sseConcurrencyGuard =
  globalThis.__sseConcurrencyGuardInstance ||
  (globalThis.__sseConcurrencyGuardInstance = new ConcurrencySemaphore());

export const logGuardEvent = (event) => {
  try {
    const payload = {
      scope: "sse_guard",
      ...event,
    };
    console.log(`[proxy] ${JSON.stringify(payload)}`);
  } catch (error) {
    console.error("[proxy][sse_guard] failed to log guard event", error);
  }
};

export const guardSnapshot = () => sseConcurrencyGuard.snapshot();

export const applyGuardHeaders = (res, token, testEndpointsEnabled) => {
  if (!testEndpointsEnabled || !token) return;
  res.set("X-Conc-Before", String(token.before));
  res.set("X-Conc-After", String(token.after));
  res.set("X-Conc-Limit", String(token.limit));
};

export function setupStreamGuard({ res, reqId, route, maxConc, testEndpointsEnabled, send429 }) {
  if (!Number.isFinite(maxConc) || maxConc <= 0) {
    return {
      acquired: true,
      release: () => {},
      token: null,
    };
  }

  const attempt = sseConcurrencyGuard.tryAcquire(maxConc);
  if (!attempt.acquired) {
    if (testEndpointsEnabled) applyGuardHeaders(res, attempt, true);
    logGuardEvent({
      req_id: reqId,
      route,
      outcome: "rejected",
      before: attempt.before,
      after: attempt.after,
      limit: maxConc,
    });
    send429();
    return {
      acquired: false,
      release: () => {},
      token: attempt,
    };
  }

  logGuardEvent({
    req_id: reqId,
    route,
    outcome: "acquired",
    before: attempt.before,
    after: attempt.after,
    limit: maxConc,
  });

  let released = false;
  const release = (outcome = "released") => {
    if (released) return;
    released = true;
    attempt.release();
    logGuardEvent({
      req_id: reqId,
      route,
      outcome,
      before: attempt.after,
      after: guardSnapshot(),
      limit: maxConc,
    });
  };

  return {
    acquired: true,
    release,
    token: attempt,
  };
}

export default sseConcurrencyGuard;
