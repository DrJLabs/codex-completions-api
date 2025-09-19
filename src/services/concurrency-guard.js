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
  } catch {}
};

export const guardSnapshot = () => sseConcurrencyGuard.snapshot();

export default sseConcurrencyGuard;
