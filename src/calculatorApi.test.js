import { describe, expect, it, vi } from 'vitest';
import { createLatestRequest } from './calculatorApi';

describe('latest calculator request', () => {
  it('ignores a late response even when abort is ignored', async () => {
    const request = createLatestRequest();
    let first;
    const success = vi.fn();
    const failure = vi.fn();
    const pending = request.run(() => new Promise((resolve) => { first = resolve; }), success, failure);
    await request.run(() => Promise.resolve('new'), success, failure);
    first('old'); await pending;
    expect(success.mock.calls).toEqual([['new']]);
    expect(failure).not.toHaveBeenCalled();
  });
  it('invalidates pending prices immediately when inputs change', async () => {
    const request = createLatestRequest();
    let resolve;
    const success = vi.fn();
    const pending = request.run(() => new Promise((r) => { resolve = r; }), success, vi.fn());
    request.invalidate(); resolve('old'); await pending;
    expect(success).not.toHaveBeenCalled();
  });
  it('reports timeout once and ignores eventual completion', async () => {
    vi.useFakeTimers();
    const request = createLatestRequest(100);
    let resolve;
    const success = vi.fn(); const failure = vi.fn();
    const pending = request.run(() => new Promise((r) => { resolve = r; }), success, failure);
    await vi.advanceTimersByTimeAsync(101);
    resolve('late'); await pending;
    expect(failure).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
