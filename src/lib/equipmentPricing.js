// src/lib/equipmentPricing.js
//
// 備品料金の計算ロジック
// - equipment_groups.csv / equipment_master.csv を読み込み
// - 部屋に応じて利用可能な備品を絞り込み
// - 区分課金 / 一回課金 を計算
//
// ※ 依存条件チェック・PA付属無料控除・舞台設備技術者警告・インターネット料金 対応済み

import { loadCsv, toNumber } from "./csv";

// =========================================
// CSV 正規化
// =========================================

function normalizeText(value) {
  return String(value ?? "").trim();
}

/**
 * equipment_groups.csv の1行を正規化
 */
function normalizeGroupRow(row) {
  return {
    group_id: normalizeText(row.group_id),
    group_name: normalizeText(row.group_name),
    applies_to_rooms: normalizeText(row.applies_to_rooms),
    default_inherit_room_slot: toNumber(row.default_inherit_room_slot, 1),
    allowed_slot_override: toNumber(row.allowed_slot_override, 1),
  };
}

/**
 * equipment_master.csv の1行を正規化
 */
function normalizeMasterRow(row) {
  return {
    item_id: normalizeText(row.item_id),
    group_id: normalizeText(row.group_id),
    item_name: normalizeText(row.item_name),
    unit: normalizeText(row.unit),
    price_per_slot: toNumber(row.price_per_slot, 0),
    price_once_yen: toNumber(row.price_once_yen, 0),
    requires_item_ids: normalizeText(row.requires_item_ids),
    notes: normalizeText(row.notes),
    is_countable: toNumber(row.is_countable, 1),
    is_power_item: toNumber(row.is_power_item, 0),
    max_qty: toNumber(row.max_qty, 0), // 0 = 制限なし
  };
}

// =========================================
// CSV 読み込み
// =========================================

export async function loadEquipmentGroupsCsv(path) {
  const resolvedPath = path ?? `${import.meta.env.BASE_URL}data/equipment_groups.csv`;
  const rows = await loadCsv(resolvedPath);
  return rows.map(normalizeGroupRow).filter((r) => r.group_id);
}

export async function loadEquipmentMasterCsv(path) {
  const resolvedPath = path ?? `${import.meta.env.BASE_URL}data/equipment_master.csv`;
  const rows = await loadCsv(resolvedPath);
  return rows.map(normalizeMasterRow).filter((r) => r.item_id && r.group_id);
}

// =========================================
// インデックス構築
// =========================================

/**
 * グループ一覧を { group_id → groupRow } の Map にする
 */
export function buildEquipmentGroupIndex(groups) {
  const map = new Map();
  (groups ?? []).forEach((g) => {
    if (g.group_id) {
      map.set(g.group_id, g);
    }
  });
  return map;
}

/**
 * マスタ一覧を { item_id → masterRow } の Map にする
 */
export function buildEquipmentMasterIndex(items) {
  const map = new Map();
  (items ?? []).forEach((item) => {
    if (item.item_id) {
      map.set(item.item_id, item);
    }
  });
  return map;
}

// =========================================
// 部屋 → 備品の絞り込み
// =========================================

/**
 * applies_to_rooms をパースして部屋名の配列にする
 *
 * "*" → すべての部屋に適用
 * "小集会室・大会議室" → ["小集会室", "大会議室"]
 */
function parseAppliesToRooms(cell) {
  const s = normalizeText(cell);
  if (!s || s === "*" || s.toLowerCase() === "all") {
    return ["*"];
  }

  // 全角・半角の区切り文字を統一
  const normalized = s
    .replace(/[、，,／/;；\n\t]/g, "・")
    .replace(/\s+/g, "");

  return normalized
    .split("・")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * あるグループが指定された部屋で利用可能かどうか
 */
function isGroupAvailableForRoom(group, room) {
  const targets = parseAppliesToRooms(group.applies_to_rooms);

  if (targets.includes("*")) return true;

  return targets.includes(room);
}

/**
 * 指定された部屋で利用可能な備品アイテムを返す
 *
 * @param {string} room - 部屋名
 * @param {Map} groupIndex - buildEquipmentGroupIndex の結果
 * @param {Map} masterIndex - buildEquipmentMasterIndex の結果
 * @returns {Array} 利用可能な備品アイテムの配列（グループ情報付き）
 */
export function getAvailableEquipmentForRoom(room, groupIndex, masterIndex) {
  if (!room || !groupIndex || !masterIndex) return [];

  const result = [];

  for (const [, item] of masterIndex) {
    const group = groupIndex.get(item.group_id);
    if (!group) continue;

    if (isGroupAvailableForRoom(group, room)) {
      result.push({
        ...item,
        group_name: group.group_name,
        default_inherit_room_slot: group.default_inherit_room_slot,
        allowed_slot_override: group.allowed_slot_override,
      });
    }
  }

  return result;
}

/**
 * 複数の部屋で利用可能な備品を、グループごとにまとめて返す
 * （UI表示用：グループ名でセクション分けしやすいように）
 */
export function getAvailableEquipmentGrouped(rooms, groupIndex, masterIndex) {
  if (!rooms || rooms.length === 0) return [];

  // 選択された全部屋で使える備品を集める（重複排除）
  const itemSet = new Map();

  for (const room of rooms) {
    const items = getAvailableEquipmentForRoom(room, groupIndex, masterIndex);
    for (const item of items) {
      if (!itemSet.has(item.item_id)) {
        itemSet.set(item.item_id, item);
      }
    }
  }

  // グループごとにまとめる
  const grouped = new Map();

  for (const [, item] of itemSet) {
    const groupId = item.group_id;
    if (!grouped.has(groupId)) {
      const group = groupIndex.get(groupId);
      grouped.set(groupId, {
        group_id: groupId,
        group_name: group?.group_name ?? groupId,
        items: [],
      });
    }
    grouped.get(groupId).items.push(item);
  }

  return [...grouped.values()];
}

// =========================================
// 区分 → 倍率
// =========================================

const SLOT_MULTIPLIER = {
  午前: 1,
  午後: 1,
  夜間: 1,
  "午前-午後": 2,
  "午後-夜間": 2,
  全日: 3,
  "延長30分": 1,
  利用なし: 0,
};

export function getSlotMultiplier(slot) {
  return SLOT_MULTIPLIER[normalizeText(slot)] ?? 1;
}

// =========================================
// 備品1件の料金計算
// =========================================

/**
 * 備品1アイテム分の料金を計算
 *
 * @param {object} item - マスタの1行（normalizeMasterRow 済み）
 * @param {number} qty - 数量
 * @param {string} slot - 利用区分（"午前", "午前-午後" など）
 * @returns {object} { itemId, itemName, qty, unit, slot, multiplier,
 *                      slotSubtotal, onceSubtotal, amount, chargeType }
 */
export function calculateEquipmentLine(item, qty, slot) {
  const safeQty = Math.max(0, Math.floor(toNumber(qty, 0)));
  const multiplier = getSlotMultiplier(slot);

  const isSlotItem = item.price_per_slot > 0;
  const isOnceItem = item.price_per_slot === 0 && item.price_once_yen > 0;

  let slotSubtotal = 0;
  let onceSubtotal = 0;
  let chargeType = "";
  let displaySlot = slot;

  if (isSlotItem) {
    // 区分課金: price_per_slot × 倍率 × 数量
    slotSubtotal = item.price_per_slot * multiplier * safeQty;
    // 一回課金も併用する場合（現データにはほぼ無いが安全策）
    onceSubtotal = item.price_once_yen * safeQty;
    chargeType = "区分課金";
  } else if (isOnceItem) {
    // 一回課金: price_once_yen × 数量（区分に関係なし）
    onceSubtotal = item.price_once_yen * safeQty;
    chargeType = "一回課金";
    displaySlot = "—";
  } else {
    chargeType = "料金未設定";
    displaySlot = "—";
  }

  const amount = slotSubtotal + onceSubtotal;

  return {
    itemId: item.item_id,
    itemName: item.item_name,
    groupId: item.group_id,
    qty: safeQty,
    unit: item.unit,
    slot: displaySlot,
    multiplier: isSlotItem ? multiplier : 0,
    pricePerSlot: item.price_per_slot,
    priceOnceYen: item.price_once_yen,
    slotSubtotal,
    onceSubtotal,
    amount,
    chargeType,
    notes: item.notes,
  };
}

// =========================================
// PA 付属マイク・スタンドの無料控除ルール
// =========================================

/**
 * 各拡声装置に付属するマイク・スタンドの無料控除ルール
 *
 * freeMicIds  : 対象のマイク item_id（優先度は単価の安い順で控除）
 * freeStandIds: 対象のスタンド item_id
 * freeMicCount / freeStandCount: PA 1台選択につき無料になる本数
 */
const PA_FREE_RULES = [
  {
    paId: "pa_a",
    freeMicIds: ["hallbig_wired_mic_a", "wireless_a"],
    freeStandIds: ["hallbig_mic_stand_a"],
    freeMicCount: 1,
    freeStandCount: 1,
  },
  {
    paId: "pa_b",
    freeMicIds: ["mid_wired_mic_a", "mid_wireless_mic_a"],
    freeStandIds: ["mid_mic_stand_a"],
    freeMicCount: 1,
    freeStandCount: 1,
  },
  {
    paId: "pa_c",
    freeMicIds: ["mic_wired", "mic_wireless"],
    freeStandIds: ["mic_stand"],
    freeMicCount: 1,
    freeStandCount: 1,
  },
  {
    paId: "pa_d",
    freeMicIds: ["mic_wired", "mic_wireless"],
    freeStandIds: ["mic_stand"],
    freeMicCount: 1,
    freeStandCount: 1,
  },
];

/**
 * PA 付属分のマイク・スタンド無料控除を計算し、控除後の数量マップを返す
 *
 * - PA が選択されている（qty > 0）ルールごとに、対応するマイク/スタンドを
 *   freeMicCount / freeStandCount 本ずつ無料にする
 * - 複数 PA が選択された場合は控除が累積する（pa_c + pa_d → 合計 2 本無料）
 * - 同じ freeMicIds を持つルールが複数ある場合、控除は選択済みの qty が
 *   残っている限り単価の安い順に適用する
 *
 * @param {Array} selections - [{ itemId, qty }]
 * @param {Map} masterIndex - buildEquipmentMasterIndex の結果
 * @returns {{ [itemId: string]: number }} 控除後の数量マップ
 *   （控除対象でないアイテムは元の qty のまま）
 */
export function applyPaFreeDeductions(selections, masterIndex) {
  if (!selections || !masterIndex || selections.length === 0) return {};

  // 元の数量をコピー（控除はこのマップを更新していく）
  const adjustedQtys = {};
  for (const sel of selections) {
    adjustedQtys[sel.itemId] = toNumber(sel.qty, 0);
  }

  for (const rule of PA_FREE_RULES) {
    // PA が選択されていなければスキップ
    const paSel = selections.find(
      (s) => s.itemId === rule.paId && toNumber(s.qty, 0) > 0
    );
    if (!paSel) continue;

    // ---- マイク控除（単価の安い順）----
    let remainingMic = rule.freeMicCount;
    const sortedMics = rule.freeMicIds
      .filter((id) => (adjustedQtys[id] ?? 0) > 0)
      .map((id) => ({ id, price: masterIndex.get(id)?.price_per_slot ?? 0 }))
      .sort((a, b) => a.price - b.price);

    for (const { id } of sortedMics) {
      if (remainingMic <= 0) break;
      const deduction = Math.min(remainingMic, adjustedQtys[id]);
      adjustedQtys[id] -= deduction;
      remainingMic -= deduction;
    }

    // ---- スタンド控除（単価の安い順）----
    let remainingStand = rule.freeStandCount;
    const sortedStands = rule.freeStandIds
      .filter((id) => (adjustedQtys[id] ?? 0) > 0)
      .map((id) => ({ id, price: masterIndex.get(id)?.price_per_slot ?? 0 }))
      .sort((a, b) => a.price - b.price);

    for (const { id } of sortedStands) {
      if (remainingStand <= 0) break;
      const deduction = Math.min(remainingStand, adjustedQtys[id]);
      adjustedQtys[id] -= deduction;
      remainingStand -= deduction;
    }
  }

  return adjustedQtys;
}

// =========================================
// 舞台設備技術者・ホール打ち合わせ警告
// =========================================

/**
 * 「舞台設備技術者との打ち合わせが必要」な備品を検出する
 *
 * notes に "舞台設備技術者" を含む備品を返す（qty > 0 のみ）
 *
 * @param {Array} selections - [{ itemId, qty }]
 * @param {Map} masterIndex
 * @returns {Array} [{ itemId, itemName }]
 */
export function getStageTechWarnings(selections, masterIndex) {
  if (!selections || !masterIndex) return [];

  const result = [];
  for (const sel of selections) {
    if ((sel.qty ?? 0) <= 0) continue;
    const item = masterIndex.get(sel.itemId);
    if (!item) continue;
    if (item.notes && item.notes.includes("舞台設備技術者")) {
      result.push({ itemId: item.item_id, itemName: item.item_name });
    }
  }
  return result;
}

/**
 * 大集会室・中集会室の音響照明舞台備品（事前打ち合わせ必要）を検出する
 *
 * 対象グループ: hall_big_light / hall_big_sound / hall_big_video /
 *               hall_big_stage / hall_mid
 *
 * @param {Array} selections - [{ itemId, qty }]
 * @param {Map} masterIndex
 * @returns {Array} [{ itemId, itemName, groupId }]
 */
const HALL_CONSULTATION_GROUP_IDS = new Set([
  "hall_big_light",
  "hall_big_sound",
  "hall_big_video",
  "hall_big_stage",
  "hall_mid",
]);

export function getHallConsultationWarnings(selections, masterIndex) {
  if (!selections || !masterIndex) return [];

  const result = [];
  for (const sel of selections) {
    if ((sel.qty ?? 0) <= 0) continue;
    const item = masterIndex.get(sel.itemId);
    if (!item) continue;
    if (HALL_CONSULTATION_GROUP_IDS.has(item.group_id)) {
      result.push({ itemId: item.item_id, itemName: item.item_name, groupId: item.group_id });
    }
  }
  return result;
}

// =========================================
// 依存条件チェック
// =========================================

/**
 * 選択済み備品の依存条件チェック
 *
 * requires_item_ids が "|" 区切りで定義されている場合、
 * いずれか1つが同一行に選択されていなければ警告を返す。
 *
 * @param {Array} selections - [{ itemId, qty }]
 * @param {Map} masterIndex - buildEquipmentMasterIndex の結果
 * @returns {Array} 依存が満たされていない項目の配列
 *   [{ itemId, itemName, requiredIds: string[] }]
 */
export function getMissingDependencies(selections, masterIndex) {
  if (!selections || !masterIndex) return [];

  // qty > 0 の選択済み item_id セット
  const selectedIds = new Set(
    selections.filter((s) => (s.qty ?? 0) > 0).map((s) => s.itemId)
  );

  const warnings = [];

  for (const sel of selections) {
    if ((sel.qty ?? 0) <= 0) continue;

    const item = masterIndex.get(sel.itemId);
    if (!item || !item.requires_item_ids) continue;

    const requiredIds = item.requires_item_ids
      .split("|")
      .map((id) => id.trim())
      .filter(Boolean);

    if (requiredIds.length === 0) continue;

    // OR条件: いずれか1つが選択済みであればOK
    const satisfied = requiredIds.some((id) => selectedIds.has(id));

    if (!satisfied) {
      warnings.push({
        itemId: item.item_id,
        itemName: item.item_name,
        requiredIds,
      });
    }
  }

  return warnings;
}

// =========================================
// 見積全体の計算
// =========================================

/**
 * 全備品の見積を計算
 *
 * @param {object} params
 * @param {Array} params.usageRows - dayRows（App.jsx の利用行配列）
 * @param {object} params.equipmentSelections - { rowId: [{ itemId, qty, slot? }] }
 * @param {Map} params.groupIndex
 * @param {Map} params.masterIndex
 * @returns {object} { total, lines }
 */
export function calculateEquipmentEstimate({
  usageRows,
  equipmentSelections,
  groupIndex,
  masterIndex,
}) {
  const lines = [];
  let total = 0;

  if (!usageRows || !equipmentSelections || !masterIndex) {
    return { total: 0, lines: [] };
  }

  for (const row of usageRows) {
    const rowId = row.id;
    const selections = equipmentSelections[rowId];
    if (!selections || selections.length === 0) continue;

    // この行の利用区分（備品のデフォルト区分として使う）
    const rowSlot = normalizeText(row.slot);

    // PA付属分の無料控除を計算
    const adjustedQtys = applyPaFreeDeductions(selections, masterIndex);

    for (const sel of selections) {
      const item = masterIndex.get(sel.itemId);
      if (!item) continue;

      const originalQty = toNumber(sel.qty, 0);
      if (originalQty <= 0) continue;

      // 控除後の実質数量（0以上）
      const effectiveQty = Math.max(0, adjustedQtys[sel.itemId] ?? originalQty);
      const freeDeduction = originalQty - effectiveQty;

      // 備品の区分: 個別指定があればそれ、なければ行の利用区分を引き継ぐ
      const group = groupIndex.get(item.group_id);
      let equipSlot;
      if (sel.slot) {
        equipSlot = sel.slot;
      } else if (group && group.default_inherit_room_slot) {
        equipSlot = rowSlot;
      } else {
        equipSlot = rowSlot;
      }

      const line = calculateEquipmentLine(item, effectiveQty, equipSlot);

      lines.push({
        rowId,
        room: row.room,
        date: row.date,
        ...line,
        originalQty,   // ユーザーが選択した数量（UI表示用）
        freeDeduction, // 無料控除された本数（0 = 控除なし）
      });

      total += line.amount;
    }
  }

  return { total, lines };
}

// =========================================
// インターネット料金
// =========================================

/**
 * インターネットプラン定義
 * allowedRooms: null = 全部屋OK
 */
export const INTERNET_PLANS = {
  pocket_wifi: {
    name: "ポケットWi-Fi",
    pricePerDay: 2800,
    allowedRooms: null,
  },
  fixed_line: {
    name: "固定回線",
    firstDayPrice: 18000,
    additionalDayPrice: 2000,
    allowedRooms: ["大集会室", "中集会室", "小集会室"],
  },
  temporary_line: {
    name: "臨時回線",
    priceOnce: 5000,
    allowedRooms: ["大集会室", "中集会室", "小集会室"],
  },
};

/**
 * 部屋で利用可能なインターネットプランを返す（"なし" を含む）
 *
 * @param {string} room - 部屋名
 * @returns {Array} [{ key, name, label }]
 */
export function getAvailableInternetPlans(room) {
  const result = [{ key: "none", name: "なし", label: "なし" }];

  for (const [key, plan] of Object.entries(INTERNET_PLANS)) {
    if (plan.allowedRooms === null || plan.allowedRooms.includes(room)) {
      let label = plan.name;
      if (key === "pocket_wifi")    label += "（2,800円/日）";
      if (key === "fixed_line")     label += "（初日18,000円＋2日目以降2,000円/日）";
      if (key === "temporary_line") label += "（5,000円）";
      result.push({ key, name: plan.name, label });
    }
  }

  return result;
}

/**
 * インターネット料金を計算
 *
 * 固定回線は同じ部屋でグループ化し日付順にソートして
 * 初日 18,000円、2日目以降 2,000円/日 を適用する。
 *
 * @param {object} params
 * @param {Array}  params.usageRows          - filledRows（room・slot が入力済みの行）
 * @param {object} params.internetSelections - { rowId: planKey }
 * @returns {{ total: number, lines: Array }}
 *   lines[]: { rowId, room, date, plan, planName, price, isFirstDay }
 */
export function calculateInternetEstimate({ usageRows, internetSelections }) {
  if (!usageRows || !internetSelections) return { total: 0, lines: [] };

  // 固定回線: 部屋ごとにまとめて日付順ソート →
  // 「連続した日付のまとまり」ごとに初日を判定する。
  // 例: 4/1, 4/2 は連続 → 4/1=初日, 4/2=2日目以降
  //     4/10 は別グループ → 4/10=初日
  const fixedLineByRoom = new Map();
  for (const row of usageRows) {
    if (internetSelections[row.id] === "fixed_line") {
      const arr = fixedLineByRoom.get(row.room) ?? [];
      arr.push(row);
      fixedLineByRoom.set(row.room, arr);
    }
  }
  for (const arr of fixedLineByRoom.values()) {
    arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  // rowId → isFirstDay（連続グループの先頭だけ true）
  const fixedLineInfo = new Map();
  for (const arr of fixedLineByRoom.values()) {
    let prevDateMs = null;
    for (const r of arr) {
      const curDateMs = r.date ? new Date(r.date).getTime() : NaN;
      const isConsecutive =
        prevDateMs !== null &&
        Number.isFinite(curDateMs) &&
        curDateMs - prevDateMs === 86400000; // 1日 = 86,400,000ms
      fixedLineInfo.set(r.id, !isConsecutive);
      prevDateMs = Number.isFinite(curDateMs) ? curDateMs : null;
    }
  }

  const lines = [];
  let total = 0;

  for (const row of usageRows) {
    const planKey = internetSelections[row.id];
    if (!planKey || planKey === "none") continue;

    let price = 0;
    let planName = "";
    let isFirstDay = false;

    if (planKey === "pocket_wifi") {
      price = INTERNET_PLANS.pocket_wifi.pricePerDay;
      planName = INTERNET_PLANS.pocket_wifi.name;
    } else if (planKey === "fixed_line") {
      isFirstDay = fixedLineInfo.get(row.id) ?? false;
      price = isFirstDay
        ? INTERNET_PLANS.fixed_line.firstDayPrice
        : INTERNET_PLANS.fixed_line.additionalDayPrice;
      planName = INTERNET_PLANS.fixed_line.name;
    } else if (planKey === "temporary_line") {
      price = INTERNET_PLANS.temporary_line.priceOnce;
      planName = INTERNET_PLANS.temporary_line.name;
    } else {
      continue;
    }

    lines.push({
      rowId: row.id,
      room: row.room,
      date: row.date,
      plan: planKey,
      planName,
      price,
      isFirstDay,
    });
    total += price;
  }

  return { total, lines };
}