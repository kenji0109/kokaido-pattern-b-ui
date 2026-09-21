// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Calculator from './Calculator';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const catalog = { csrf_token: 'test', rooms: [{ id: '大会議室', label: '大会議室' }], slots: [
  { id: '午後', start: '13:00', end: '17:00', before_allowed: true, after_allowed: true, after_reason: '' },
  { id: '夜間', start: '18:00', end: '21:30', before_allowed: true, after_allowed: false, after_reason: '21:30終了のため後延長はできません' },
  { id: '午後夜間', start: '13:00', end: '21:30', before_allowed: true, after_allowed: false, after_reason: '21:30終了のため後延長はできません' },
  { id: '全日', start: '9:30', end: '21:30', before_allowed: true, after_allowed: false, after_reason: '21:30終了のため後延長はできません' },
] };
const estimate = { is_complete_for_scope: true, scope: 'room_only', included_subtotal: 18450, pricing_version: 'test', warnings: [],
  rows: [{ room_id: '大会議室', date: '2026-09-18', slot: '午後', room_fee: 16350, extension_unit_price: 2100,
    before_30min: 0, after_30min: 1, extension_fee: 2100, day_type: '平日', day_of_week: '金曜日', surcharge: true }] };
const response = (data, ok = true) => Promise.resolve({ ok, json: async () => data });
const change = async (selector, value) => act(async () => {
  const input = host.querySelector(selector);
  // Native setter bypasses React's tracker, like a real browser edit.
  Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});
async function fill() {
  await change('input', '2026-09-18');
  await change('select:nth-of-type(1)', '大会議室');
  const selects = host.querySelectorAll('select');
  await act(async () => { for (const [index, value] of [[1, '午後'], [2, '割増'], [3, 'after']]) {
    selects[index].value = value; selects[index].dispatchEvent(new Event('change', { bubbles: true }));
  } });
}
async function selectSlot(slot) {
  await act(async () => { const input = host.querySelectorAll('select')[1]; input.value = slot; input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
beforeEach(async () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('fetch', vi.fn((url) => response(url.endsWith('catalog') ? catalog : estimate)));
  await act(async () => root.render(<Calculator />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('has no implicit room selection; sends one row and displays server amounts', async () => {
  expect(host.querySelector('select').value).toBe('');
  await fill(); await submit();
  expect(host.textContent).toContain('18,450円');
  expect(host.textContent).toContain('2,100円');
  const body = JSON.parse(fetch.mock.calls.find(([url]) => url.endsWith('estimate'))[1].body);
  expect(body.rows).toEqual([{ date: '2026-09-18', room_id: '大会議室', slot: '午後', surcharge: true, before_30min: 0, after_30min: 1 }]);
  expect(fetch.mock.calls.every(([url]) => url.startsWith('/api/calculator/'))).toBe(true);
});
it.each(['夜間', '午後夜間', '全日'])('preserves but invalidates after extension on switching to %s', async (slot) => {
  await fill(); await submit(); await selectSlot(slot);
  const input = host.querySelectorAll('select')[3];
  expect(input.value).toBe('after');
  expect(input.querySelector('[value="after"]').disabled).toBe(true);
  expect(input.querySelector('[value="both"]').disabled).toBe(true);
  expect(input.querySelector('[value="before"]').disabled).toBe(false);
  expect(host.textContent).toContain('21:30終了のため後延長はできません');
  expect(host.textContent).not.toContain('18,450円');
  expect(host.querySelector('[type="submit"]').disabled).toBe(true);
});
it('keeps inputs and removes old result on failure, then permits retry', async () => {
  await fill(); await submit();
  fetch.mockImplementation((url) => url.endsWith('catalog') ? response(catalog) : Promise.reject(new Error('offline')));
  await submit();
  expect(host.textContent).not.toContain('18,450円');
  expect(host.textContent).toContain('再試行');
  expect(host.querySelector('input').value).toBe('2026-09-18');
  fetch.mockImplementation((url) => response(url.endsWith('catalog') ? catalog : estimate));
  await submit(); expect(host.textContent).toContain('18,450円');
});
it('does not render a late price after an input change', async () => {
  await fill(); let finish;
  fetch.mockImplementation((url) => url.endsWith('catalog') ? response(catalog) : new Promise((r) => { finish = r; }));
  await submit(); await selectSlot('全日');
  await act(async () => finish(await response(estimate)));
  expect(host.textContent).not.toContain('18,450円');
  expect(host.querySelectorAll('select')[1].value).toBe('全日');
});
it('shows a server closure error without a zero total', async () => {
  await fill(); fetch.mockImplementation((url) => response(url.endsWith('catalog') ? catalog : { errors: [{ message: 'この日は休館日です。' }] }, url.endsWith('catalog')));
  await submit(); expect(host.textContent).toContain('休館日'); expect(host.textContent).not.toContain('0円');
});
