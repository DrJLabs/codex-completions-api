export const createStreamTimers = ({ idleMs, onIdle }) => {
  let idleTimer = null;

  return {
    startIdleTimer() {
      idleTimer = setTimeout(() => onIdle(), idleMs);
    },
    stopIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    },
  };
};
