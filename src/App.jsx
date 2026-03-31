// src/App.jsx

import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { loadPricesCsv } from "./lib/csv";
import {
  createPricesIndex,
  calculateRoomEstimate,
  formatYen,
} from "./lib/roomPricing";
import {
  formatDateInput,
  formatDateWithWeekday,
} from "./lib/dateUtils";
import {
  loadEquipmentGroupsCsv,
  loadEquipmentMasterCsv,
  buildEquipmentGroupIndex,
  buildEquipmentMasterIndex,
  getAvailableEquipmentForRoom,
  calculateEquipmentEstimate,
  getMissingDependencies,
  getStageTechWarnings,
  getHallConsultationWarnings,
  getAvailableInternetPlans,
  calculateInternetEstimate,
} from "./lib/equipmentPricing";

function createRow(overrides = {}) {
  return {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    date: formatDateInput(new Date()),
    room: "",
    slot: "",
    priceType: "通常",
    extension: "なし",
    dayType: "",
    ...overrides,
  };
}

function displayRoomName(room) {
  return String(room ?? "")
    .replace(/制御室1/g, "控室1")
    .replace(/制御室2/g, "控室2")
    .replace(/制御室１/g, "控室１")
    .replace(/制御室２/g, "控室２");
}

const EXTENSION_OPTIONS = ["なし", "前延長30分", "後延長30分", "前後延長30分"];
const DAY_TYPE_OPTIONS = ["", "平日", "土日祝"];

// 備品の利用区分オプション
const EQUIPMENT_SLOT_OPTIONS = [
  "午前",
  "午後",
  "夜間",
  "午前-午後",
  "午後-夜間",
  "全日",
];

export default function App() {
  // ─── 既存 state ───
  const [priceRows, setPriceRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [step, setStep] = useState(1);
  const [selectedRooms, setSelectedRooms] = useState([]);
  const [selectionError, setSelectionError] = useState("");
  const [dayRows, setDayRows] = useState([]);

  // ─── 備品 state ───
  const [equipGroups, setEquipGroups] = useState([]);
  const [equipItems, setEquipItems] = useState([]);
  const [equipmentSelections, setEquipmentSelections] = useState({});
  // どの行の備品セクションが開いているか
  const [openEquipRows, setOpenEquipRows] = useState({});

  // ─── インターネット state ───
  const [internetSelections, setInternetSelections] = useState({});
  // どの行のインターネットセクションが開いているか
  const [openInternetRows, setOpenInternetRows] = useState({});

  // ─── CSV読み込み ───
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        setLoadError("");

        const base = import.meta.env.BASE_URL;
        const [prices, groups, items] = await Promise.all([
          loadPricesCsv(`${base}data/prices.csv`),
          loadEquipmentGroupsCsv(`${base}data/equipment_groups.csv`),
          loadEquipmentMasterCsv(`${base}data/equipment_master.csv`),
        ]);

        if (cancelled) return;
        setPriceRows(prices);
        setEquipGroups(groups);
        setEquipItems(items);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setLoadError(
          error instanceof Error
            ? error.message
            : "データの読み込みに失敗しました"
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  // ─── 既存 index ───
  const priceIndex = useMemo(() => createPricesIndex(priceRows), [priceRows]);

  const roomOptions = useMemo(() => {
    return [...new Set(priceRows.map((row) => row.room).filter(Boolean))];
  }, [priceRows]);

  const slotOptions = useMemo(() => {
    return [
      ...new Set(
        priceRows
          .map((row) => row.slot)
          .filter((slot) => slot && slot !== "延長30分")
      ),
    ];
  }, [priceRows]);

  const priceTypeOptions = useMemo(() => {
    const values = [...new Set(priceRows.map((row) => row.price_type).filter(Boolean))];
    return values.length > 0 ? values : ["通常", "割増"];
  }, [priceRows]);

  const availableRoomsForInput = useMemo(() => {
    return selectedRooms.length > 0 ? selectedRooms : roomOptions;
  }, [selectedRooms, roomOptions]);

  // ─── 備品 index ───
  const groupIndex = useMemo(
    () => buildEquipmentGroupIndex(equipGroups),
    [equipGroups]
  );
  const masterIndex = useMemo(
    () => buildEquipmentMasterIndex(equipItems),
    [equipItems]
  );

  // ─── 部屋料金の見積 ───
  const filledRows = useMemo(() => {
    return dayRows.filter((row) => {
      return String(row.room).trim() !== "" && String(row.slot).trim() !== "";
    });
  }, [dayRows]);

  const roomEstimate = useMemo(() => {
    return calculateRoomEstimate(priceIndex, filledRows);
  }, [priceIndex, filledRows]);

  // ─── 備品料金の見積 ───
  const equipEstimate = useMemo(() => {
    return calculateEquipmentEstimate({
      usageRows: filledRows,
      equipmentSelections,
      groupIndex,
      masterIndex,
    });
  }, [filledRows, equipmentSelections, groupIndex, masterIndex]);

  // ─── 全行の依存不足警告 ───
  const allDepWarnings = useMemo(() => {
    return filledRows.flatMap((row) => {
      const selections = equipmentSelections[row.id] ?? [];
      const warnings = getMissingDependencies(selections, masterIndex);
      return warnings.map((w) => ({ row, ...w }));
    });
  }, [filledRows, equipmentSelections, masterIndex]);

  // ─── 全行の舞台設備技術者警告 ───
  const allStageTechWarnings = useMemo(() => {
    return filledRows.flatMap((row) => {
      const selections = equipmentSelections[row.id] ?? [];
      const warnings = getStageTechWarnings(selections, masterIndex);
      return warnings.map((w) => ({ row, ...w }));
    });
  }, [filledRows, equipmentSelections, masterIndex]);

  // ─── 全行のホール打ち合わせ警告（1件でも該当すれば true） ───
  const hasHallConsultWarning = useMemo(() => {
    return filledRows.some((row) => {
      const selections = equipmentSelections[row.id] ?? [];
      return getHallConsultationWarnings(selections, masterIndex).length > 0;
    });
  }, [filledRows, equipmentSelections, masterIndex]);

  // ─── インターネット料金の見積 ───
  const internetEstimate = useMemo(() => {
    return calculateInternetEstimate({
      usageRows: filledRows,
      internetSelections,
    });
  }, [filledRows, internetSelections]);

  // ─── 合計 ───
  const grandTotal = useMemo(() => {
    return roomEstimate.grandTotal + equipEstimate.total + internetEstimate.total;
  }, [roomEstimate.grandTotal, equipEstimate.total, internetEstimate.total]);

  const incompleteCount = useMemo(() => {
    return dayRows.filter((row) => {
      const hasAnyInput =
        String(row.date).trim() !== "" ||
        String(row.room).trim() !== "" ||
        String(row.slot).trim() !== "" ||
        String(row.extension).trim() !== "" ||
        String(row.dayType).trim() !== "" ||
        String(row.priceType).trim() !== "";
      const isComplete =
        String(row.room).trim() !== "" && String(row.slot).trim() !== "";
      return hasAnyInput && !isComplete;
    }).length;
  }, [dayRows]);

  // ─── 部屋選択 ───
  function toggleRoom(room) {
    setSelectionError("");
    setSelectedRooms((prev) =>
      prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room]
    );
  }

  function goToStep2() {
    if (selectedRooms.length === 0) {
      setSelectionError("部屋を1つ以上選択してください。");
      return;
    }

    setDayRows((prev) => {
      const nextRows = selectedRooms.map((room) => {
        const existing = prev.find((row) => row.room === room);
        return existing
          ? { ...existing }
          : createRow({ room, priceType: "通常", extension: "なし" });
      });
      return nextRows;
    });

    setStep(2);
  }

  function backToStep1() {
    setStep(1);
  }

  function updateRow(id, key, value) {
    setDayRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [key]: value } : row))
    );
    // 部屋が変わったとき、利用不可になったインターネットプランをリセット
    if (key === "room") {
      setInternetSelections((prev) => {
        const current = prev[id];
        if (!current || current === "none") return prev;
        const available = getAvailableInternetPlans(value);
        const stillAvailable = available.some((p) => p.key === current);
        if (stillAvailable) return prev;
        return { ...prev, [id]: "none" };
      });
    }
  }

  function addRow() {
    setDayRows((prev) => [
      ...prev,
      createRow({
        room: availableRoomsForInput[0] ?? "",
        priceType: prev[prev.length - 1]?.priceType ?? "通常",
        extension: "なし",
      }),
    ]);
  }

  function removeRow(id) {
    setDayRows((prev) => {
      if (prev.length <= 1) {
        return [createRow({ room: availableRoomsForInput[0] ?? "" })];
      }
      return prev.filter((row) => row.id !== id);
    });
    // 備品選択もクリア
    setEquipmentSelections((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOpenEquipRows((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setInternetSelections((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOpenInternetRows((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function resetRows() {
    setDayRows(
      selectedRooms.map((room) =>
        createRow({ room, priceType: "通常", extension: "なし" })
      )
    );
    setEquipmentSelections({});
    setOpenEquipRows({});
    setInternetSelections({});
    setOpenInternetRows({});
  }

  // ─── インターネット操作 ───
  function toggleInternetSection(rowId) {
    setOpenInternetRows((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  }

  function updateInternetSelection(rowId, planKey) {
    setInternetSelections((prev) => ({ ...prev, [rowId]: planKey }));
  }

  // ─── 備品操作 ───
  function toggleEquipSection(rowId) {
    setOpenEquipRows((prev) => ({
      ...prev,
      [rowId]: !prev[rowId],
    }));
  }

  function addEquipmentItem(rowId, itemId, roomSlot) {
    setEquipmentSelections((prev) => {
      const current = prev[rowId] ?? [];
      // 既に追加済みならスキップ
      if (current.some((s) => s.itemId === itemId)) return prev;
      return {
        ...prev,
        [rowId]: [
          ...current,
          { itemId, qty: 1, slot: "" }, // slot空 = 部屋の区分を引き継ぐ
        ],
      };
    });
  }

  function updateEquipmentQty(rowId, itemId, qty) {
    setEquipmentSelections((prev) => {
      const current = prev[rowId] ?? [];
      return {
        ...prev,
        [rowId]: current.map((s) =>
          s.itemId === itemId ? { ...s, qty: Math.max(0, Number(qty) || 0) } : s
        ),
      };
    });
  }

  function updateEquipmentSlot(rowId, itemId, slot) {
    setEquipmentSelections((prev) => {
      const current = prev[rowId] ?? [];
      return {
        ...prev,
        [rowId]: current.map((s) =>
          s.itemId === itemId ? { ...s, slot } : s
        ),
      };
    });
  }

  function removeEquipmentItem(rowId, itemId) {
    setEquipmentSelections((prev) => {
      const current = prev[rowId] ?? [];
      const next = current.filter((s) => s.itemId !== itemId);
      if (next.length === 0) {
        const result = { ...prev };
        delete result[rowId];
        return result;
      }
      return { ...prev, [rowId]: next };
    });
  }

  // ─── 部屋ごとの利用可能な備品を取得 ───
  function getEquipmentForRow(row) {
    if (!row.room || !groupIndex.size || !masterIndex.size) return [];
    return getAvailableEquipmentForRoom(row.room, groupIndex, masterIndex);
  }

  // ─── 備品をグループ別にまとめる（UI表示用） ───
  function groupEquipmentItems(items) {
    const grouped = new Map();
    for (const item of items) {
      const gid = item.group_id;
      if (!grouped.has(gid)) {
        grouped.set(gid, {
          group_id: gid,
          group_name: item.group_name ?? gid,
          items: [],
        });
      }
      grouped.get(gid).items.push(item);
    }
    return [...grouped.values()];
  }

  // =========================================
  // スタイル定義
  // =========================================
  const stepBadgeStyle = (active) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    borderRadius: "999px",
    border: active ? "1px solid #c59c84" : "1px solid #e6ddd5",
    background: active ? "rgba(159, 107, 79, 0.10)" : "#fff",
    color: active ? "#7f523a" : "#7b6f68",
    fontWeight: 700,
    fontSize: "14px",
  });

  const roomCardStyle = (selected) => ({
    width: "100%",
    textAlign: "left",
    borderRadius: "18px",
    border: selected ? "2px solid #c59c84" : "1px solid #e6ddd5",
    background: selected ? "rgba(159, 107, 79, 0.10)" : "#fff",
    padding: "18px 16px",
    cursor: "pointer",
    transition: "0.18s ease",
    boxShadow: selected ? "0 8px 20px rgba(159, 107, 79, 0.10)" : "none",
  });

  const chipStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: "999px",
    border: "1px solid #e6ddd5",
    background: "#fff",
    fontSize: "14px",
    fontWeight: 700,
    color: "#7f523a",
  };

  const primaryNextButtonStyle = {
    appearance: "none",
    border: "none",
    background: "linear-gradient(135deg, #a97152 0%, #8a5a40 100%)",
    color: "#fff",
    borderRadius: "999px",
    padding: "16px 26px",
    fontWeight: 800,
    fontSize: "18px",
    lineHeight: 1.2,
    boxShadow: "0 12px 24px rgba(127, 82, 58, 0.22)",
    cursor: "pointer",
    minWidth: "240px",
  };

  const primaryNextButtonDisabledStyle = {
    ...primaryNextButtonStyle,
    background: "#d9cec6",
    boxShadow: "none",
    cursor: "not-allowed",
  };

  const equipToggleStyle = {
    appearance: "none",
    border: "1px solid #d5c8be",
    background: "#faf7f5",
    color: "#7f523a",
    borderRadius: "12px",
    padding: "10px 16px",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
    marginTop: "12px",
  };

  const internetToggleStyle = {
    appearance: "none",
    border: "1px solid #d5c8be",
    background: "#faf7f5",
    color: "#7f523a",
    borderRadius: "12px",
    padding: "10px 16px",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
    marginTop: "12px",
  };

  const equipAddBtnStyle = {
    appearance: "none",
    border: "1px solid #d5c8be",
    background: "#fff",
    color: "#7f523a",
    borderRadius: "8px",
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const equipRemoveBtnStyle = {
    appearance: "none",
    border: "none",
    background: "transparent",
    color: "#c0392b",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    padding: "4px 8px",
  };

  // =========================================
  // レンダリング
  // =========================================
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-eyebrow">大阪市中央公会堂</p>
          <h1 className="app-title">大阪市中央公会堂 料金シミュレーション</h1>
          <p className="app-subtitle">
            ご利用予定の部屋料金・延長料金・備品料金・インターネット料金を、かんたんに試算できます。
          </p>
        </div>
      </header>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
        <div style={stepBadgeStyle(step === 1)}>STEP 1　部屋を選ぶ</div>
        <div style={stepBadgeStyle(step === 2)}>STEP 2　利用内容を入力</div>
      </div>

      <main className="app-main two-column">
        <section className="panel panel-main">
          {/* ========== STEP 1 ========== */}
          {step === 1 && (
            <>
              <div className="panel-head">
                <div>
                  <h2>部屋を選択</h2>
                  <p>利用したい部屋を選んで、次へ進んでください。複数選択できます。</p>
                </div>
              </div>

              {loading && (
                <div className="notice-box">
                  <p>データを読み込み中です...</p>
                </div>
              )}

              {loadError && (
                <div className="notice-box error-box">
                  <p>読み込みエラー: {loadError}</p>
                  <p>public/data/ にCSVデータが入っているか確認してください。</p>
                </div>
              )}

              {!loading && !loadError && roomOptions.length === 0 && (
                <div className="notice-box error-box">
                  <p>prices.csv は読み込めましたが、利用可能な部屋データが見つかりませんでした。</p>
                </div>
              )}

              {selectionError && (
                <div className="notice-box error-box">
                  <p>{selectionError}</p>
                </div>
              )}

              {!loading && !loadError && roomOptions.length > 0 && (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "14px",
                    }}
                  >
                    {roomOptions.map((room) => {
                      const selected = selectedRooms.includes(room);
                      return (
                        <button
                          key={room}
                          type="button"
                          style={roomCardStyle(selected)}
                          onClick={() => toggleRoom(room)}
                        >
                          <div
                            style={{
                              fontSize: "18px",
                              fontWeight: 800,
                              marginBottom: "8px",
                              color: "#2f2723",
                            }}
                          >
                            {displayRoomName(room)}
                          </div>
                          <div
                            style={{
                              fontSize: "13px",
                              color: selected ? "#7f523a" : "#7b6f68",
                              fontWeight: 700,
                            }}
                          >
                            {selected ? "選択中" : "クリックして選択"}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      marginTop: "20px",
                      display: "flex",
                      gap: "16px",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div className="mini-note" style={{ marginTop: 0, flex: "1 1 320px" }}>
                      <span>
                        選択中の部屋：
                        {selectedRooms.length > 0
                          ? ` ${selectedRooms.map(displayRoomName).join(" / ")}`
                          : " なし"}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={goToStep2}
                      disabled={loading || !!loadError || roomOptions.length === 0 || selectedRooms.length === 0}
                      style={
                        loading || !!loadError || roomOptions.length === 0 || selectedRooms.length === 0
                          ? primaryNextButtonDisabledStyle
                          : primaryNextButtonStyle
                      }
                    >
                      {selectedRooms.length > 0
                        ? `選択した ${selectedRooms.length} 室で次へ進む →`
                        : "部屋を選んで次へ進む →"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ========== STEP 2 ========== */}
          {step === 2 && (
            <>
              <div className="panel-head">
                <div>
                  <h2>利用日ごとの入力</h2>
                  <p>選択した部屋について、利用日・区分・延長・備品を入力してください。</p>
                </div>
                <div className="panel-actions">
                  <button type="button" onClick={backToStep1}>
                    部屋選択に戻る
                  </button>
                  <button type="button" className="btn-add-row" onClick={addRow}>
                    ＋ 日程を追加
                  </button>
                  <button type="button" onClick={resetRows}>
                    リセット
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  marginBottom: "18px",
                }}
              >
                {selectedRooms.map((room) => (
                  <span key={room} style={chipStyle}>
                    {displayRoomName(room)}
                  </span>
                ))}
              </div>

              <div className="day-list">
                {dayRows.map((row, index) => {
                  const rowEquip = equipmentSelections[row.id] ?? [];
                  const isEquipOpen = !!openEquipRows[row.id];
                  const availableEquip = getEquipmentForRow(row);
                  const groupedEquip = groupEquipmentItems(availableEquip);
                  const selectedIds = new Set(rowEquip.map((s) => s.itemId));
                  const depWarnings = getMissingDependencies(rowEquip, masterIndex);
                  const stageTechWarnings = getStageTechWarnings(rowEquip, masterIndex);
                  const hallConsultWarnings = getHallConsultationWarnings(rowEquip, masterIndex);

                  return (
                    <div className="day-card" key={row.id}>
                      <div className="day-card-head">
                        <h3>{index + 1}件目</h3>
                        <button type="button" onClick={() => removeRow(row.id)}>
                          削除
                        </button>
                      </div>

                      <div className="form-grid">
                        <label>
                          <span>利用日</span>
                          <input
                            type="date"
                            value={row.date}
                            onChange={(e) => updateRow(row.id, "date", e.target.value)}
                          />
                        </label>

                        <label>
                          <span>部屋</span>
                          <select
                            value={row.room}
                            onChange={(e) => updateRow(row.id, "room", e.target.value)}
                          >
                            <option value="">選択してください</option>
                            {availableRoomsForInput.map((room) => (
                              <option key={room} value={room}>
                                {displayRoomName(room)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>利用区分</span>
                          <select
                            value={row.slot}
                            onChange={(e) => updateRow(row.id, "slot", e.target.value)}
                          >
                            <option value="">選択してください</option>
                            {slotOptions.map((slot) => (
                              <option key={slot} value={slot}>
                                {slot}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>料金の種類</span>
                          <select
                            value={row.priceType}
                            onChange={(e) => updateRow(row.id, "priceType", e.target.value)}
                          >
                            {priceTypeOptions.map((priceType) => (
                              <option key={priceType} value={priceType}>
                                {priceType}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>延長</span>
                          <select
                            value={row.extension}
                            onChange={(e) => updateRow(row.id, "extension", e.target.value)}
                          >
                            {EXTENSION_OPTIONS.map((extension) => (
                              <option key={extension} value={extension}>
                                {extension}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>曜日区分</span>
                          <select
                            value={row.dayType}
                            onChange={(e) => updateRow(row.id, "dayType", e.target.value)}
                          >
                            <option value="">自動判定</option>
                            {DAY_TYPE_OPTIONS.filter(Boolean).map((dayType) => (
                              <option key={dayType} value={dayType}>
                                {dayType}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="mini-note">
                        <span>表示日: {formatDateWithWeekday(row.date) || "未入力"}</span>
                      </div>

                      {/* ===== 備品セクション ===== */}
                      <button
                        type="button"
                        style={equipToggleStyle}
                        onClick={() => toggleEquipSection(row.id)}
                      >
                        {isEquipOpen ? "▼" : "▶"} 備品を選択
                        {rowEquip.length > 0 && (
                          <span
                            style={{
                              marginLeft: "10px",
                              background: "#a97152",
                              color: "#fff",
                              borderRadius: "999px",
                              padding: "2px 10px",
                              fontSize: "12px",
                            }}
                          >
                            {rowEquip.length}件選択中
                          </span>
                        )}
                        {depWarnings.length > 0 && (
                          <span
                            style={{
                              marginLeft: "8px",
                              background: "#fff3cd",
                              color: "#7a5800",
                              border: "1px solid #f0c93a",
                              borderRadius: "999px",
                              padding: "2px 10px",
                              fontSize: "12px",
                            }}
                          >
                            ⚠ 依存備品が未選択
                          </span>
                        )}
                      </button>

                      {isEquipOpen && row.room && (
                        <div
                          style={{
                            marginTop: "10px",
                            border: "1px solid #e6ddd5",
                            borderRadius: "14px",
                            padding: "16px",
                            background: "#fdfbf9",
                          }}
                        >
                          {/* 選択済み備品の一覧 */}
                          {rowEquip.length > 0 && (
                            <div style={{ marginBottom: "16px" }}>
                              <div
                                style={{
                                  fontSize: "13px",
                                  fontWeight: 700,
                                  color: "#7f523a",
                                  marginBottom: "8px",
                                }}
                              >
                                選択済みの備品
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {rowEquip.map((sel) => {
                                  const item = masterIndex.get(sel.itemId);
                                  if (!item) return null;

                                  const isSlotItem = item.price_per_slot > 0;

                                  // 控除後の金額・控除数は equipEstimate.lines から取得
                                  const lineInfo = equipEstimate.lines.find(
                                    (l) => l.rowId === row.id && l.itemId === sel.itemId
                                  );
                                  const lineTotal = lineInfo?.amount ?? 0;
                                  const freeDeduction = lineInfo?.freeDeduction ?? 0;

                                  return (
                                    <div
                                      key={sel.itemId}
                                      style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px 12px",
                                        background: "#fff",
                                        borderRadius: "10px",
                                        border: "1px solid #e6ddd5",
                                        fontSize: "13px",
                                      }}
                                    >
                                      <span style={{ fontWeight: 700, flex: "1 1 140px", minWidth: 0 }}>
                                        {item.item_name}
                                        {freeDeduction > 0 && (
                                          <span
                                            style={{
                                              marginLeft: "6px",
                                              fontSize: "11px",
                                              fontWeight: 600,
                                              color: "#2d7a3a",
                                              background: "#eafaf1",
                                              border: "1px solid #b2e0bc",
                                              borderRadius: "6px",
                                              padding: "1px 6px",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            🎁 {freeDeduction}本付属（無料）
                                          </span>
                                        )}
                                      </span>

                                      <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                        <span style={{ color: "#7b6f68", fontSize: "12px" }}>数量</span>
                                        <input
                                          type="number"
                                          min="0"
                                          value={sel.qty}
                                          onChange={(e) =>
                                            updateEquipmentQty(row.id, sel.itemId, e.target.value)
                                          }
                                          style={{
                                            width: "56px",
                                            padding: "4px 6px",
                                            borderRadius: "6px",
                                            border: "1px solid #d5c8be",
                                            fontSize: "13px",
                                            textAlign: "right",
                                          }}
                                        />
                                        <span style={{ color: "#7b6f68", fontSize: "12px" }}>
                                          {item.unit}
                                        </span>
                                      </label>

                                      {isSlotItem && (
                                        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                          <span style={{ color: "#7b6f68", fontSize: "12px" }}>区分</span>
                                          <select
                                            value={sel.slot}
                                            onChange={(e) =>
                                              updateEquipmentSlot(row.id, sel.itemId, e.target.value)
                                            }
                                            style={{
                                              padding: "4px 6px",
                                              borderRadius: "6px",
                                              border: "1px solid #d5c8be",
                                              fontSize: "13px",
                                            }}
                                          >
                                            <option value="">部屋と同じ</option>
                                            {EQUIPMENT_SLOT_OPTIONS.map((s) => (
                                              <option key={s} value={s}>{s}</option>
                                            ))}
                                          </select>
                                        </label>
                                      )}

                                      <span
                                        style={{
                                          fontWeight: 700,
                                          color: "#2f2723",
                                          minWidth: "80px",
                                          textAlign: "right",
                                        }}
                                      >
                                        {formatYen(lineTotal)}
                                      </span>

                                      <button
                                        type="button"
                                        style={equipRemoveBtnStyle}
                                        onClick={() => removeEquipmentItem(row.id, sel.itemId)}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* 依存条件の警告 */}
                          {depWarnings.length > 0 && (
                            <div
                              style={{
                                marginBottom: "14px",
                                padding: "10px 14px",
                                background: "#fff3cd",
                                border: "1px solid #f0c93a",
                                borderRadius: "10px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px",
                              }}
                            >
                              {depWarnings.map((w) => {
                                const requiredNames = w.requiredIds.map(
                                  (id) => masterIndex.get(id)?.item_name ?? id
                                );
                                return (
                                  <div
                                    key={w.itemId}
                                    style={{ fontSize: "13px", color: "#7a5800", fontWeight: 600 }}
                                  >
                                    ⚠ 「{w.itemName}」には「{requiredNames.join("」または「")}」が必要です
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* タイプA: 舞台設備技術者警告 */}
                          {stageTechWarnings.length > 0 && (
                            <div
                              style={{
                                marginBottom: "10px",
                                padding: "10px 14px",
                                background: "#e8f4fd",
                                border: "1px solid #b3d9f2",
                                borderRadius: "10px",
                              }}
                            >
                              <div style={{ fontSize: "13px", color: "#1a6090", fontWeight: 600 }}>
                                🔧 以下の備品は舞台設備技術者との打ち合わせが必要です：{stageTechWarnings.map((w) => w.itemName).join("、")}
                              </div>
                            </div>
                          )}

                          {/* タイプB: ホール音響照明打ち合わせ警告 */}
                          {hallConsultWarnings.length > 0 && (
                            <div
                              style={{
                                marginBottom: "14px",
                                padding: "10px 14px",
                                background: "#f0ebf8",
                                border: "1px solid #c4b5dc",
                                borderRadius: "10px",
                              }}
                            >
                              <div style={{ fontSize: "13px", color: "#5a3e8a", fontWeight: 600 }}>
                                📋 選択された音響・照明・舞台備品の料金はあくまで目安の基本料金です。ご利用には事前打ち合わせが必要で、打ち合わせ後に正式なお見積りとなります。
                              </div>
                            </div>
                          )}

                          {/* 備品追加セクション（グループ別） */}
                          <div
                            style={{
                              fontSize: "13px",
                              fontWeight: 700,
                              color: "#7f523a",
                              marginBottom: "8px",
                            }}
                          >
                            備品を追加（{displayRoomName(row.room)}で利用可能）
                          </div>

                          {groupedEquip.length === 0 && (
                            <div style={{ fontSize: "13px", color: "#7b6f68" }}>
                              この部屋で利用可能な備品はありません。
                            </div>
                          )}

                          {groupedEquip.map((group) => {
                            // 未選択の備品だけ表示
                            const unselected = group.items.filter(
                              (it) => !selectedIds.has(it.item_id)
                            );
                            if (unselected.length === 0) return null;

                            return (
                              <div key={group.group_id} style={{ marginBottom: "12px" }}>
                                <div
                                  style={{
                                    fontSize: "12px",
                                    fontWeight: 700,
                                    color: "#a08878",
                                    marginBottom: "6px",
                                    borderBottom: "1px solid #ede6df",
                                    paddingBottom: "4px",
                                  }}
                                >
                                  {group.group_name}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "6px",
                                  }}
                                >
                                  {unselected.map((item) => (
                                    <button
                                      key={item.item_id}
                                      type="button"
                                      style={equipAddBtnStyle}
                                      onClick={() =>
                                        addEquipmentItem(row.id, item.item_id, row.slot)
                                      }
                                      title={
                                        item.notes
                                          ? `${item.notes} — ${item.price_per_slot > 0 ? `${item.price_per_slot}円/区分` : `${item.price_once_yen}円`}`
                                          : item.price_per_slot > 0
                                            ? `${item.price_per_slot}円/区分`
                                            : `${item.price_once_yen}円`
                                      }
                                    >
                                      ＋ {item.item_name}
                                      <span
                                        style={{
                                          marginLeft: "6px",
                                          color: "#a08878",
                                          fontSize: "12px",
                                        }}
                                      >
                                        {item.price_per_slot > 0
                                          ? `${item.price_per_slot.toLocaleString()}円/区分`
                                          : `${item.price_once_yen.toLocaleString()}円`}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {isEquipOpen && !row.room && (
                        <div
                          style={{
                            marginTop: "10px",
                            padding: "12px",
                            background: "#fdfbf9",
                            borderRadius: "10px",
                            fontSize: "13px",
                            color: "#7b6f68",
                          }}
                        >
                          部屋を選択すると、利用可能な備品が表示されます。
                        </div>
                      )}

                      {/* ===== インターネットセクション ===== */}
                      {(() => {
                        const isInternetOpen = !!openInternetRows[row.id];
                        const currentPlan = internetSelections[row.id] ?? "none";
                        const availablePlans = row.room ? getAvailableInternetPlans(row.room) : [];
                        const currentPlanName = availablePlans.find((p) => p.key === currentPlan)?.name ?? "なし";
                        const hasSelection = currentPlan !== "none";

                        // トグルボタン用: 該当行の料金
                        const currentRowLine = internetEstimate.lines.find((l) => l.rowId === row.id);
                        const currentPrice = currentRowLine?.price ?? null;

                        // 固定回線: この行が同一部屋で何日目か
                        let fixedLineDayInfo = null;
                        if (currentPlan === "fixed_line") {
                          const fixedLinesForRoom = internetEstimate.lines
                            .filter((l) => l.plan === "fixed_line" && l.room === row.room)
                            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
                          const idx = fixedLinesForRoom.findIndex((l) => l.rowId === row.id);
                          if (idx !== -1) {
                            fixedLineDayInfo = {
                              dayNumber: idx + 1,
                              isFirstDay: fixedLinesForRoom[idx].isFirstDay,
                            };
                          }
                        }

                        // ラジオ選択肢の補足テキスト
                        const planSubtitles = {
                          pocket_wifi: "2,800円/日 ─ 全部屋で利用可能",
                          fixed_line: "初日 18,000円 ＋ 2日目以降 2,000円/日",
                          temporary_line: "5,000円（1回）",
                        };

                        return (
                          <>
                            <button
                              type="button"
                              style={internetToggleStyle}
                              onClick={() => toggleInternetSection(row.id)}
                            >
                              {isInternetOpen ? "▼" : "▶"} インターネット
                              {hasSelection && (
                                <span
                                  style={{
                                    marginLeft: "10px",
                                    background: "#4a9e6a",
                                    color: "#fff",
                                    borderRadius: "999px",
                                    padding: "2px 10px",
                                    fontSize: "12px",
                                  }}
                                >
                                  🌐 {currentPlanName}{currentPrice !== null ? ` ${formatYen(currentPrice)}` : ""}
                                </span>
                              )}
                            </button>

                            {isInternetOpen && (
                              <div
                                style={{
                                  marginTop: "10px",
                                  border: "1px solid #c8e0c8",
                                  borderRadius: "14px",
                                  padding: "16px",
                                  background: "#f8fcf8",
                                }}
                              >
                                {!row.room ? (
                                  <div style={{ fontSize: "13px", color: "#7b6f68" }}>
                                    部屋を選択すると、利用可能なプランが表示されます。
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {availablePlans.map((plan) => (
                                      <label
                                        key={plan.key}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "10px",
                                          padding: "10px 14px",
                                          borderRadius: "10px",
                                          border: currentPlan === plan.key ? "1px solid #7cc49a" : "1px solid #d4e8d4",
                                          background: currentPlan === plan.key ? "#ddf0e3" : "#fff",
                                          cursor: "pointer",
                                        }}
                                      >
                                        <input
                                          type="radio"
                                          name={`internet-${row.id}`}
                                          value={plan.key}
                                          checked={currentPlan === plan.key}
                                          onChange={() => updateInternetSelection(row.id, plan.key)}
                                          style={{ accentColor: "#4a9e6a", flexShrink: 0 }}
                                        />
                                        <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                          <span style={{ fontSize: "14px", fontWeight: 700, color: "#2f2723" }}>
                                            {plan.name}
                                          </span>
                                          {planSubtitles[plan.key] && (
                                            <span style={{ fontSize: "12px", color: "#7b6f68", fontWeight: 400 }}>
                                              {planSubtitles[plan.key]}
                                            </span>
                                          )}
                                        </span>
                                      </label>
                                    ))}
                                    {fixedLineDayInfo && (
                                      <div
                                        style={{
                                          marginTop: "4px",
                                          padding: "8px 12px",
                                          borderRadius: "8px",
                                          background: "#d4f0e0",
                                          color: "#2e7d52",
                                          fontSize: "13px",
                                          fontWeight: 700,
                                        }}
                                      >
                                        この部屋の固定回線: {fixedLineDayInfo.dayNumber}日目（{fixedLineDayInfo.isFirstDay ? `初日 ${formatYen(18000)}` : `2日目以降 ${formatYen(2000)}/日`}）
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* ========== サイドパネル ========== */}
        <aside className="panel panel-side">
          <div className="panel-head">
            <div>
              <h2>かんたん確認</h2>
              <p>現在の入力状況をまとめています。</p>
            </div>
          </div>

          <div className="summary-grid">
            <div className="summary-card">
              <div className="summary-label">現在のステップ</div>
              <div className="summary-value" style={{ fontSize: "22px" }}>
                {step === 1 ? "部屋選択" : "内容入力"}
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-label">選択部屋数</div>
              <div className="summary-value">{selectedRooms.length}室</div>
            </div>

            <div className="summary-card">
              <div className="summary-label">入力行数</div>
              <div className="summary-value">{dayRows.length}件</div>
            </div>

            <div className="summary-card">
              <div className="summary-label">未完了の行</div>
              <div className="summary-value">{incompleteCount}件</div>
            </div>
          </div>

          <div className="total-box">
            <div className="total-line">
              <span>部屋料金合計</span>
              <strong>{formatYen(roomEstimate.totalBasePrice)}</strong>
            </div>
            <div className="total-line">
              <span>延長料金合計</span>
              <strong>{formatYen(roomEstimate.totalExtensionPrice)}</strong>
            </div>
            <div className="total-line">
              <span>備品料金合計</span>
              <strong>{formatYen(equipEstimate.total)}</strong>
            </div>
            <div className="total-line">
              <span>インターネット料金合計</span>
              <strong>{formatYen(internetEstimate.total)}</strong>
            </div>
            <div className="total-line grand">
              <span>見積合計</span>
              <strong>{formatYen(grandTotal)}</strong>
            </div>
          </div>

          {step === 1 && (
            <div className="notice-box">
              <p>部屋を選ぶと、右下の大きいボタンから次へ進めます。</p>
            </div>
          )}

          {step === 2 && roomEstimate.hasError && (
            <div className="notice-box error-box">
              <h3>確認が必要です</h3>
              <ul>
                {roomEstimate.errors.map((error, index) => (
                  <li key={`${error}-${index}`}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {step === 2 && !roomEstimate.hasError && filledRows.length > 0 && (
            <div className="notice-box success-box">
              <p>部屋料金 + 延長料金 + 備品料金 + インターネット料金の計算ができています。</p>
            </div>
          )}
        </aside>
      </main>

      {/* ========== 見積確認 ========== */}
      {step === 2 && (
        <section className="panel estimate-panel">
          <div className="panel-head">
            <div>
              <h2>見積確認</h2>
              <p>1件ごとの内訳です。</p>
            </div>
          </div>

          {roomEstimate.items.length === 0 && equipEstimate.lines.length === 0 ? (
            <div className="notice-box">
              <p>利用区分を入力すると、ここに内訳が表示されます。</p>
            </div>
          ) : (
            <div className="estimate-table-wrap">
              {/* 部屋料金テーブル */}
              {roomEstimate.items.length > 0 && (
                <>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#7f523a", marginBottom: "10px" }}>
                    部屋料金・延長料金
                  </h3>
                  <table className="estimate-table">
                    <thead>
                      <tr>
                        <th>日付</th>
                        <th>部屋</th>
                        <th>曜日区分</th>
                        <th>料金種別</th>
                        <th>利用区分</th>
                        <th>部屋料金</th>
                        <th>延長</th>
                        <th>延長料金</th>
                        <th>合計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roomEstimate.items.map((item, index) => (
                        <tr key={`room-${item.date}-${item.room}-${item.slot}-${index}`}>
                          <td>{formatDateWithWeekday(item.date)}</td>
                          <td>{displayRoomName(item.room)}</td>
                          <td>{item.dayType}</td>
                          <td>{item.priceType}</td>
                          <td>{item.slot}</td>
                          <td>{formatYen(item.basePrice)}</td>
                          <td>
                            {item.extension}
                            {item.extensionCount > 0 ? `（${item.extensionCount}回）` : ""}
                          </td>
                          <td>{formatYen(item.extensionPrice)}</td>
                          <td>
                            <strong>{formatYen(item.total)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan="5">部屋・延長 小計</th>
                        <th>{formatYen(roomEstimate.totalBasePrice)}</th>
                        <th></th>
                        <th>{formatYen(roomEstimate.totalExtensionPrice)}</th>
                        <th>{formatYen(roomEstimate.grandTotal)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}

              {/* 備品料金テーブル */}
              {equipEstimate.lines.length > 0 && (
                <>
                  <h3
                    style={{
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#7f523a",
                      marginTop: "24px",
                      marginBottom: "10px",
                    }}
                  >
                    備品料金
                  </h3>
                  <table className="estimate-table">
                    <thead>
                      <tr>
                        <th>部屋</th>
                        <th>備品名</th>
                        <th>課金タイプ</th>
                        <th>区分</th>
                        <th>数量</th>
                        <th>単位</th>
                        <th>単価</th>
                        <th>金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipEstimate.lines.map((line, index) => (
                        <tr key={`equip-${line.rowId}-${line.itemId}-${index}`}>
                          <td>{displayRoomName(line.room)}</td>
                          <td>{line.itemName}</td>
                          <td>{line.chargeType}</td>
                          <td>{line.slot}</td>
                          <td>{line.qty}</td>
                          <td>{line.unit}</td>
                          <td>
                            {line.pricePerSlot > 0
                              ? `${formatYen(line.pricePerSlot)}/区分`
                              : formatYen(line.priceOnceYen)}
                          </td>
                          <td>
                            <strong>{formatYen(line.amount)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan="7">備品 小計</th>
                        <th>{formatYen(equipEstimate.total)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}

              {/* インターネット料金テーブル */}
              {internetEstimate.lines.length > 0 && (
                <>
                  <h3
                    style={{
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#7f523a",
                      marginTop: "24px",
                      marginBottom: "10px",
                    }}
                  >
                    インターネット料金
                  </h3>
                  <table className="estimate-table">
                    <thead>
                      <tr>
                        <th>日付</th>
                        <th>部屋</th>
                        <th>プラン</th>
                        <th>備考</th>
                        <th>料金</th>
                      </tr>
                    </thead>
                    <tbody>
                      {internetEstimate.lines.map((line, index) => (
                        <tr key={`internet-${line.rowId}-${index}`}>
                          <td>{formatDateWithWeekday(line.date)}</td>
                          <td>{displayRoomName(line.room)}</td>
                          <td>{line.planName}</td>
                          <td style={{ color: "#7b6f68", fontSize: "12px" }}>
                            {line.plan === "fixed_line" && (line.isFirstDay ? "初日" : "2日目以降")}
                          </td>
                          <td><strong>{formatYen(line.price)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan="4">インターネット 小計</th>
                        <th>{formatYen(internetEstimate.total)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}

              {/* 依存不足の警告（全行まとめ） */}
              {allDepWarnings.length > 0 && (
                <div
                  style={{
                    marginTop: "20px",
                    padding: "12px 16px",
                    background: "#fff3cd",
                    border: "1px solid #f0c93a",
                    borderRadius: "10px",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#7a5800", marginBottom: "8px" }}>
                    ⚠ 以下の備品に必要な機材が選択されていません：
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {allDepWarnings.map((w, i) => {
                      const requiredNames = w.requiredIds.map(
                        (id) => masterIndex.get(id)?.item_name ?? id
                      );
                      return (
                        <li key={`${w.row.id}-${w.itemId}-${i}`} style={{ fontSize: "13px", color: "#7a5800" }}>
                          {displayRoomName(w.row.room)}：「{w.itemName}」→「{requiredNames.join("」または「")}」が必要
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* タイプA: 舞台設備技術者警告（全行まとめ） */}
              {allStageTechWarnings.length > 0 && (
                <div
                  style={{
                    marginTop: "20px",
                    padding: "12px 16px",
                    background: "#e8f4fd",
                    border: "1px solid #b3d9f2",
                    borderRadius: "10px",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#1a6090", marginBottom: "6px" }}>
                    🔧 以下の備品は舞台設備技術者との打ち合わせが必要です：
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {allStageTechWarnings.map((w, i) => (
                      <li key={`${w.row.id}-${w.itemId}-${i}`} style={{ fontSize: "13px", color: "#1a6090" }}>
                        {displayRoomName(w.row.room)}：{w.itemName}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* タイプB: ホール音響照明打ち合わせ警告（全行まとめ） */}
              {hasHallConsultWarning && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "12px 16px",
                    background: "#f0ebf8",
                    border: "1px solid #c4b5dc",
                    borderRadius: "10px",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#5a3e8a" }}>
                    📋 選択された音響・照明・舞台備品の料金はあくまで目安の基本料金です。ご利用には事前打ち合わせが必要で、打ち合わせ後に正式なお見積りとなります。
                  </div>
                </div>
              )}

              {/* 総合計 */}
              <div
                style={{
                  marginTop: "20px",
                  padding: "16px 20px",
                  background: "linear-gradient(135deg, rgba(159,107,79,0.08), rgba(159,107,79,0.03))",
                  borderRadius: "14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#7f523a" }}>
                  見積総合計
                </div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: "#2f2723" }}>
                  {formatYen(grandTotal)}
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
