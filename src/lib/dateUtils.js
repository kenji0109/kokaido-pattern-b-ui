// src/lib/dateUtils.js

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

export function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

export function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return isValidDate(value) ? value : null;
  }

  const text = String(value).trim();
  if (!text) return null;

  // "YYYY-MM-DD" をローカル日付として安全に解釈
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const d = new Date(year, month - 1, day);

    // 不正日付（2026-02-31 など）を除外
    if (
      d.getFullYear() === year &&
      d.getMonth() === month - 1 &&
      d.getDate() === day
    ) {
      return d;
    }
    return null;
  }

  const parsed = new Date(text);
  return isValidDate(parsed) ? parsed : null;
}

export function formatDateInput(value) {
  const date = parseDate(value);
  if (!date) return "";

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateJP(value) {
  const date = parseDate(value);
  if (!date) return "";

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  return `${yyyy}/${mm}/${dd}`;
}

export function getWeekdayIndex(value) {
  const date = parseDate(value);
  if (!date) return null;
  return date.getDay();
}

export function getWeekdayJa(value) {
  const dayIndex = getWeekdayIndex(value);
  if (dayIndex === null) return "";
  return WEEKDAYS_JA[dayIndex];
}

export function formatDateWithWeekday(value) {
  const base = formatDateJP(value);
  const weekday = getWeekdayJa(value);

  if (!base || !weekday) return "";
  return `${base}（${weekday}）`;
}

export function isSaturday(value) {
  return getWeekdayIndex(value) === 6;
}

export function isSunday(value) {
  return getWeekdayIndex(value) === 0;
}

export function isWeekend(value) {
  const day = getWeekdayIndex(value);
  return day === 0 || day === 6;
}

/**
 * 現段階では簡易版として
 * 土曜・日曜 = 土日祝
 * 月〜金 = 平日
 *
 * ※ 祝日判定は後で拡張可能
 */
export function getAutoDayType(value) {
  return isWeekend(value) ? "土日祝" : "平日";
}

/**
 * UI側で day_type が未指定なら自動判定、
 * 指定済みならその値を優先したい時に使う
 */
export function resolveDayType({ date, dayType }) {
  const manual = String(dayType ?? "").trim();
  if (manual === "平日" || manual === "土日祝") {
    return manual;
  }

  return getAutoDayType(date);
}

export function addDays(value, days) {
  const date = parseDate(value);
  if (!date) return null;

  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

export function createDateRange(startValue, endValue) {
  const start = parseDate(startValue);
  const end = parseDate(endValue);

  if (!start || !end) return [];
  if (start.getTime() > end.getTime()) return [];

  const result = [];
  let current = new Date(start);

  while (current.getTime() <= end.getTime()) {
    result.push({
      date: formatDateInput(current),
      dateLabel: formatDateJP(current),
      weekday: getWeekdayJa(current),
      dayType: getAutoDayType(current),
    });

    current = addDays(current, 1);
  }

  return result;
}