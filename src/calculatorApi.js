export async function readJson(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  return { ok: response.ok, data: await response.json() };
}

// Revision checks are needed even when a mock/proxy ignores AbortSignal.
export function createLatestRequest(timeoutMs = 15000) {
  let revision = 0;
  let controller;
  let timer;
  function invalidate() {
    revision += 1;
    clearTimeout(timer);
    controller?.abort();
  }
  return {
    invalidate,
    async run(operation, success, failure) {
      invalidate();
      const current = revision;
      controller = new AbortController();
      const signal = controller.signal;
      timer = setTimeout(() => {
        if (revision === current) { invalidate(); failure(new Error('timeout')); }
      }, timeoutMs);
      try {
        const result = await operation(signal);
        if (revision === current) success(result);
      } catch (error) {
        if (revision === current) failure(error);
      } finally {
        if (revision === current) clearTimeout(timer);
      }
    },
  };
}
