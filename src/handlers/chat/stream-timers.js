export const createStreamTimers = ({ idleMs, onIdle }) => {
  let idleTimer = null;

  return {
    startIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => onIdle(), idleMs);
    },
    stopIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    },
  };
};
