// Extracted from B's day-card/form-grid/summary UI. App.jsx keeps the legacy
// equipment and multi-row screen for the next phase; it is not mounted.
import { useEffect, useRef, useState } from 'react';
import { createLatestRequest, readJson } from './calculatorApi';
import './Calculator.css';

const EXTENSIONS = [
  { id: 'none', label: 'なし', before: 0, after: 0 },
  { id: 'before', label: '前延長30分', before: 1, after: 0 },
  { id: 'after', label: '後延長30分', before: 0, after: 1 },
  { id: 'both', label: '前後延長30分', before: 1, after: 1 },
];
const yen = (value) => `${value.toLocaleString('ja-JP')}円`;

export default function Calculator() {
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [row, setRow] = useState({ date: '', room: '', slot: '', priceType: '通常', extension: 'none' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requests = useRef(null);
  if (!requests.current) requests.current = createLatestRequest();

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    readJson('/api/calculator/catalog', { signal: controller.signal })
      .then(({ data, ok }) => {
        if (!ok || !Array.isArray(data.rooms) || !Array.isArray(data.slots) || !data.csrf_token) throw new Error();
        if (active) { setCatalog(data); setCatalogError(''); }
      })
      .catch(() => { if (active) setCatalogError('計算サービスに接続できませんでした。再試行してください。'); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [catalogAttempt]);
  useEffect(() => () => requests.current.invalidate(), []);

  const extension = EXTENSIONS.find((item) => item.id === row.extension);
  const slot = catalog?.slots.find((item) => item.id === row.slot);
  const invalidExtension = slot && ((extension.after && !slot.after_allowed) ? slot.after_reason :
    (extension.before && !slot.before_allowed) ? slot.before_reason : '');

  function updateRow(field, value) {
    requests.current.invalidate();
    setBusy(false); setResult(null); setError('');
    setRow((current) => ({ ...current, [field]: value }));
  }

  async function calculate(event) {
    event.preventDefault();
    if (invalidExtension || !catalog) return;
    setResult(null); setError(''); setBusy(true);
    const payload = { schema_version: 1, scope: 'room_only', rows: [{
      date: row.date, room_id: row.room, slot: row.slot, surcharge: row.priceType === '割増',
      before_30min: extension.before, after_30min: extension.after,
    }] };
    await requests.current.run(async (signal) => {
      const fresh = await readJson('/api/calculator/catalog', { signal });
      if (!fresh.ok || !fresh.data.csrf_token) throw new Error();
      return readJson('/api/calculator/estimate', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': fresh.data.csrf_token },
        body: JSON.stringify(payload) });
    }, ({ data, ok }) => {
      setBusy(false);
      if (!ok || !data.is_complete_for_scope || data.scope !== 'room_only' ||
          !Number.isSafeInteger(data.included_subtotal) || !data.rows?.length) {
        setError(data.errors?.map((item) => item.message).join(' ') || '計算できませんでした。再試行してください。');
      } else { setResult(data); }
    }, () => { setBusy(false); setError('通信に失敗しました。入力を保持しています。「計算する」で再試行してください。'); });
  }

  const line = result?.rows[0];
  return <div className="calculator">
    <div className="panel-head"><h2>料金を計算</h2><p>1室・1日の部屋代と延長料金を試算できます。</p></div>
    <p className="scope-note">備品・技術者・ネットの料金は含みません。全館・フロア貸切・ギャラリー・控室は対象外です。</p>
    {!catalog && !catalogError && <p role="status">計算サービスを読み込んでいます…</p>}
    {catalogError && <div className="notice-box error-box" role="alert">{catalogError} <button type="button" onClick={() => { setCatalogError(''); setCatalogAttempt((n) => n + 1); }}>再試行</button></div>}
    {catalog && <>
      <form className="day-card" onSubmit={calculate}>
        <div className="form-grid">
          <label><span>利用日（必須）</span><input required type="date" value={row.date} onChange={(e) => updateRow('date', e.target.value)} /></label>
          <label><span>部屋（必須）</span><select required value={row.room} onChange={(e) => updateRow('room', e.target.value)}>
            <option value="">選択してください</option>{catalog.rooms.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}
          </select></label>
          <label><span>利用区分（必須）</span><select required value={row.slot} onChange={(e) => updateRow('slot', e.target.value)}>
            <option value="">選択してください</option>{catalog.slots.map((item) => <option key={item.id} value={item.id}>{item.id}（{item.start}〜{item.end}）</option>)}
          </select></label>
          <label><span>料金の種類</span><select value={row.priceType} onChange={(e) => updateRow('priceType', e.target.value)}>
            <option value="通常">通常</option><option value="割増">割増（室料・延長とも1.5倍）</option>
          </select></label>
          <label><span>延長</span><select aria-describedby="extension-note" aria-invalid={!!invalidExtension} value={row.extension} onChange={(e) => updateRow('extension', e.target.value)}>
            {EXTENSIONS.map((item) => <option key={item.id} value={item.id} disabled={!!slot && !!((item.after && !slot.after_allowed) || (item.before && !slot.before_allowed))}>{item.label}</option>)}
          </select></label>
        </div>
        <p id="extension-note" className={invalidExtension ? 'notice-box error-box' : 'mini-note'} role={invalidExtension ? 'alert' : undefined}>
          {invalidExtension ? `${invalidExtension} 延長の選択を修正してください。` : slot?.after_reason || '延長は前後それぞれ30分まで。曜日・祝日は利用日から自動判定します。'}
        </p>
        <p className="mini-note">割増の適用条件が不明な場合は公会堂へご確認ください。</p>
        <button className="calculate-button" type="submit" disabled={busy || !!invalidExtension}>{busy ? '計算中…' : '計算する'}</button>
      </form>
      <div aria-live="polite" aria-atomic="true" aria-busy={busy}>
        {error && <p className="notice-box error-box" role="alert">{error}</p>}
        {busy && <p role="status">最新の入力条件で計算しています…</p>}
        {line && <section className="panel summary-panel" aria-label="計算結果">
          <h3>試算の明細</h3><p>{line.date}（{line.day_of_week}） {line.holiday_name}・{line.day_type}・{line.surcharge ? '割増' : '通常'}</p>
          <p>{line.room_id} ／ {line.slot}</p>
          <dl className="total-box">
            <div className="total-line"><dt>部屋代</dt><dd>{yen(line.room_fee)}</dd></div>
            <div className="total-line"><dt>延長30分の単価</dt><dd>{yen(line.extension_unit_price)}</dd></div>
            <div className="total-line"><dt>延長回数</dt><dd>前 {line.before_30min}回・後 {line.after_30min}回</dd></div>
            <div className="total-line"><dt>延長料金</dt><dd>{yen(line.extension_fee)}</dd></div>
            <div className="total-line grand"><dt>室料・延長の小計</dt><dd>{yen(result.included_subtotal)}</dd></div>
          </dl>
          <p className="scope-note">{result.scope_note}</p>
          {result.warnings.map((message) => <p className="mini-note" key={message}>{message}</p>)}
          <p className="version-note">料金版 {result.pricing_version}</p>
        </section>}
      </div>
    </>}
  </div>;
}
