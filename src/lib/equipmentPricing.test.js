// src/lib/equipmentPricing.test.js
import { describe, it, expect } from "vitest";
import { calculateInternetEstimate } from "./equipmentPricing";

function row(id, room, date) {
  return { id, room, date, slot: "午前" };
}

describe("calculateInternetEstimate – 固定回線の連続日付グループ判定", () => {
  it("1日だけ選択 → 初日料金 18,000 円", () => {
    const usageRows = [row("r1", "大集会室", "2026-04-01")];
    const internetSelections = { r1: "fixed_line" };
    const result = calculateInternetEstimate({ usageRows, internetSelections });
    expect(result.total).toBe(18000);
    expect(result.lines[0].isFirstDay).toBe(true);
  });

  it("連続2日（4/1, 4/2）→ 18,000 + 2,000 = 20,000 円", () => {
    const usageRows = [
      row("r1", "大集会室", "2026-04-01"),
      row("r2", "大集会室", "2026-04-02"),
    ];
    const internetSelections = { r1: "fixed_line", r2: "fixed_line" };
    const result = calculateInternetEstimate({ usageRows, internetSelections });
    expect(result.total).toBe(20000);
    const byDate = Object.fromEntries(result.lines.map((l) => [l.date, l]));
    expect(byDate["2026-04-01"].isFirstDay).toBe(true);
    expect(byDate["2026-04-01"].price).toBe(18000);
    expect(byDate["2026-04-02"].isFirstDay).toBe(false);
    expect(byDate["2026-04-02"].price).toBe(2000);
  });

  it("非連続（4/1, 4/10）→ 各グループで初日 → 18,000 + 18,000 = 36,000 円", () => {
    const usageRows = [
      row("r1", "大集会室", "2026-04-01"),
      row("r2", "大集会室", "2026-04-10"),
    ];
    const internetSelections = { r1: "fixed_line", r2: "fixed_line" };
    const result = calculateInternetEstimate({ usageRows, internetSelections });
    expect(result.total).toBe(36000);
    expect(result.lines.every((l) => l.isFirstDay)).toBe(true);
  });

  it("連続3日（4/1, 4/2, 4/3）→ 18,000 + 2,000 + 2,000 = 22,000 円", () => {
    const usageRows = [
      row("r1", "大集会室", "2026-04-01"),
      row("r2", "大集会室", "2026-04-02"),
      row("r3", "大集会室", "2026-04-03"),
    ];
    const internetSelections = {
      r1: "fixed_line",
      r2: "fixed_line",
      r3: "fixed_line",
    };
    const result = calculateInternetEstimate({ usageRows, internetSelections });
    expect(result.total).toBe(22000);
  });

  it("連続2日 + 1日空き + 1日 → 20,000 + 18,000 = 38,000 円", () => {
    const usageRows = [
      row("r1", "大集会室", "2026-04-01"),
      row("r2", "大集会室", "2026-04-02"),
      row("r3", "大集会室", "2026-04-04"), // 4/3 をスキップ
    ];
    const internetSelections = {
      r1: "fixed_line",
      r2: "fixed_line",
      r3: "fixed_line",
    };
    const result = calculateInternetEstimate({ usageRows, internetSelections });
    expect(result.total).toBe(38000);
  });

  it("部屋が異なる場合は別グループ → それぞれ初日料金", () => {
    const usageRows = [
      row("r1", "大集会室", "2026-04-01"),
      row("r2", "中集会室", "2026-04-02"),
    ];
    const internetSelections = { r1: "fixed_line", r2: "fixed_line" };
    const result = calculateInternetEstimate({ usageRows, internetSelections });
    expect(result.total).toBe(36000);
    expect(result.lines.every((l) => l.isFirstDay)).toBe(true);
  });

  it("ポケットWi-Fi は 2,800 円/日でフラットに計算される", () => {
    const usageRows = [
      row("r1", "大集会室", "2026-04-01"),
      row("r2", "大集会室", "2026-04-02"),
    ];
    const internetSelections = { r1: "pocket_wifi", r2: "pocket_wifi" };
    const result = calculateInternetEstimate({ usageRows, internetSelections });
    expect(result.total).toBe(5600);
  });
});
