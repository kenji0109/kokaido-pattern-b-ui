// src/lib/roomPricing.js

import { resolveDayType, parseDate } from "./dateUtils";

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function createPricesIndex(priceRows) {
  const map = new Map();
  const seen = new Set();

  (priceRows ?? []).forEach((row) => {
    const room = normalizeText(row.room);
    const dayType = normalizeText(row.day_type);
    const priceType = normalizeText(row.price_type);
    const slot = normalizeText(row.slot);
    const amount = Number(row.amount ?? 0);

    if (!room || !dayType || !priceType || !slot) return;

    const key = [room, dayType, priceType, slot].join("|");
    if (seen.has(key)) {
      console.warn(`[roomPricing] 料金マスタに重複キーがあります: ${key}`);
    }
    seen.add(key);
    map.set(key, Number.isFinite(amount) ? amount : 0);
  });

  return map;
}

export function makePriceKey({ room, dayType, priceType, slot }) {
  return [
    normalizeText(room),
    normalizeText(dayType),
    normalizeText(priceType),
    normalizeText(slot),
  ].join("|");
}

export function findPrice(index, { room, dayType, priceType, slot }) {
  if (!index) return null;

  const key = makePriceKey({ room, dayType, priceType, slot });
  return index.has(key) ? index.get(key) : null;
}

export function getExtensionCount(extensionValue) {
  const value = normalizeText(extensionValue);

  switch (value) {
    case "前延長30分":
    case "後延長30分":
      return 1;
    case "前後延長30分":
      return 2;
    case "なし":
    case "":
    default:
      return 0;
  }
}

export function calculateRoomBasePrice(index, { room, dayType, priceType, slot }) {
  const amount = findPrice(index, { room, dayType, priceType, slot });

  if (amount === null) {
    return {
      found: false,
      amount: 0,
      message: `部屋料金が見つかりません: ${room} / ${dayType} / ${priceType} / ${slot}`,
    };
  }

  return {
    found: true,
    amount,
    message: "",
  };
}

export function calculateExtensionPrice(index, { room, dayType, priceType, extension }) {
  const extensionCount = getExtensionCount(extension);

  if (extensionCount === 0) {
    return {
      found: true,
      unitAmount: 0,
      count: 0,
      amount: 0,
      message: "",
    };
  }

  const unitAmount = findPrice(index, {
    room,
    dayType,
    priceType,
    slot: "延長30分",
  });

  if (unitAmount === null) {
    return {
      found: false,
      unitAmount: 0,
      count: extensionCount,
      amount: 0,
      message: `延長料金が見つかりません: ${room} / ${dayType} / ${priceType} / 延長30分`,
    };
  }

  return {
    found: true,
    unitAmount,
    count: extensionCount,
    amount: unitAmount * extensionCount,
    message: "",
  };
}

/**
 * 1日分の部屋料金を計算
 *
 * 想定入力例:
 * {
 *   date: "2026-04-01",
 *   room: "大会議室",
 *   slot: "午前",
 *   priceType: "通常",
 *   extension: "前後延長30分",
 *   dayType: "平日" // 未指定なら date から自動判定
 * }
 */
export function calculateRoomDayPrice(index, day) {
  const room = normalizeText(day?.room);
  const slot = normalizeText(day?.slot);
  const priceType = normalizeText(day?.priceType || "通常");
  const extension = normalizeText(day?.extension || "なし");
  const date = normalizeText(day?.date);

  const errors = [];

  // 日付バリデーション（実質必須・不正日付はエラー）
  if (!date) {
    errors.push("利用日が未入力です");
  } else if (!parseDate(date)) {
    errors.push(`利用日が不正です: ${date}`);
  }

  if (!room) errors.push("部屋が未指定です");
  if (!slot) errors.push("利用区分が未指定です");

  // 日付不正なら dayType を自動判定できないため早期リターン
  if (!date || !parseDate(date)) {
    return {
      date,
      room,
      slot,
      dayType: "",
      priceType,
      extension,
      basePrice: 0,
      extensionPrice: 0,
      total: 0,
      extensionCount: getExtensionCount(extension),
      isValid: false,
      errors,
      baseFound: false,
      extensionFound: false,
    };
  }

  const dayType = resolveDayType({ date, dayType: day?.dayType });

  if (!room || !slot) {
    return {
      date,
      room,
      slot,
      dayType,
      priceType,
      extension,
      basePrice: 0,
      extensionPrice: 0,
      total: 0,
      extensionCount: getExtensionCount(extension),
      isValid: false,
      errors,
      baseFound: false,
      extensionFound: false,
    };
  }

  const baseResult = calculateRoomBasePrice(index, {
    room,
    dayType,
    priceType,
    slot,
  });

  const extensionResult = calculateExtensionPrice(index, {
    room,
    dayType,
    priceType,
    extension,
  });

  if (!baseResult.found && baseResult.message) {
    errors.push(baseResult.message);
  }

  if (!extensionResult.found && extensionResult.message) {
    errors.push(extensionResult.message);
  }

  const total = baseResult.amount + extensionResult.amount;

  return {
    date,
    room,
    slot,
    dayType,
    priceType,
    extension,
    basePrice: baseResult.amount,
    extensionPrice: extensionResult.amount,
    extensionUnitPrice: extensionResult.unitAmount,
    extensionCount: extensionResult.count,
    total,
    isValid: errors.length === 0,
    errors,
    baseFound: baseResult.found,
    extensionFound: extensionResult.found,
  };
}

/**
 * 複数日まとめて計算
 * isValid === false の行は合計に含めない（誤計算防止）
 */
export function calculateRoomEstimate(index, dayList) {
  const items = (dayList ?? []).map((day) => calculateRoomDayPrice(index, day));

  const validItems = items.filter((item) => item.isValid);
  const totalBasePrice = validItems.reduce((sum, item) => sum + item.basePrice, 0);
  const totalExtensionPrice = validItems.reduce((sum, item) => sum + item.extensionPrice, 0);
  const grandTotal = validItems.reduce((sum, item) => sum + item.total, 0);

  const errors = items.flatMap((item) => item.errors);
  const hasError = errors.length > 0;
  const hasInvalidItems = items.some((item) => !item.isValid);

  return {
    items,
    totalBasePrice,
    totalExtensionPrice,
    grandTotal,
    hasError,
    hasInvalidItems,
    errors,
  };
}

export function formatYen(value) {
  const num = Number(value ?? 0);

  return `${num.toLocaleString("ja-JP")}円`;
}