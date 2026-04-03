// src/lib/csv.js

function stripBom(text) {
  if (!text) return "";
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * CSV テキスト全体をパースし、フィールド配列の配列を返す。
 * quoted field 内の改行・カンマ・"" エスケープを正しく処理する。
 */
function tokenizeCsv(text) {
  const rows = [];
  let fields = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // "" はエスケープされたダブルクォート
        if (text[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          // 閉じクォート
          inQuotes = false;
          i += 1;
        }
      } else {
        // quoted field 内の改行もそのまま取り込む
        current += ch;
        i += 1;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
        i += 1;
      } else if (ch === "\n") {
        fields.push(current.trim());
        current = "";
        // 完全に空の行は無視する
        if (fields.some((f) => f !== "")) {
          rows.push(fields);
        }
        fields = [];
        i += 1;
      } else {
        current += ch;
        i += 1;
      }
    }
  }

  // ファイル末尾に改行がない場合の残余処理
  fields.push(current.trim());
  if (fields.some((f) => f !== "")) {
    rows.push(fields);
  }

  return rows;
}

export function parseCsv(text) {
  const cleaned = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = tokenizeCsv(cleaned);

  if (rows.length === 0) return [];

  const headers = rows[0];

  return rows.slice(1).map((fields) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? "";
    });
    return row;
  });
}

export async function loadCsv(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`CSVの読み込みに失敗しました: ${path}`);
  }

  const text = await response.text();
  return parseCsv(text);
}

export function toNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .trim();

  if (normalized === "") return fallback;

  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizePriceRow(row) {
  return {
    room: String(row.room ?? "").trim(),
    day_type: String(row.day_type ?? "").trim(),
    price_type: String(row.price_type ?? "").trim(),
    slot: String(row.slot ?? "").trim(),
    amount: toNumber(row.amount, 0),
  };
}

export async function loadPricesCsv(path) {
  const resolvedPath = path ?? `${import.meta.env.BASE_URL}data/prices.csv`;
  const rows = await loadCsv(resolvedPath);

  return rows
    .map(normalizePriceRow)
    .filter((row) => row.room && row.day_type && row.price_type && row.slot);
}