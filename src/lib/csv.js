// src/lib/csv.js

function stripBom(text) {
  if (!text) return "";
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      // "" はエスケープされたダブルクォート
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((v) => v.trim());
}

export function parseCsv(text) {
  const cleaned = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
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