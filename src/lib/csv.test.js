// src/lib/csv.test.js
import { describe, it, expect } from "vitest";
import { parseCsv, toNumber } from "./csv";

describe("parseCsv", () => {
  it("基本的な CSV をパースできる", () => {
    const text = "name,age\nAlice,30\nBob,25";
    const result = parseCsv(text);
    expect(result).toEqual([
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ]);
  });

  it("BOM 付き UTF-8 を処理できる", () => {
    const bom = "\uFEFF";
    const text = `${bom}id,value\n1,foo`;
    const result = parseCsv(text);
    expect(result).toEqual([{ id: "1", value: "foo" }]);
  });

  it("quoted field 内のカンマを正しく扱う", () => {
    const text = 'a,b\n"hello, world",42';
    const result = parseCsv(text);
    expect(result).toEqual([{ a: "hello, world", b: "42" }]);
  });

  it("quoted field 内の改行を正しく扱う", () => {
    const text = 'title,body\n"first","line1\nline2"';
    const result = parseCsv(text);
    expect(result).toEqual([{ title: "first", body: "line1\nline2" }]);
  });

  it('"" エスケープを正しく扱う', () => {
    const text = 'q\n"say ""hello"""';
    const result = parseCsv(text);
    expect(result).toEqual([{ q: 'say "hello"' }]);
  });

  it("CRLF 改行を正しく扱う", () => {
    const text = "x,y\r\n1,2\r\n3,4";
    const result = parseCsv(text);
    expect(result).toEqual([
      { x: "1", y: "2" },
      { x: "3", y: "4" },
    ]);
  });

  it("空行を無視する", () => {
    const text = "a,b\n\n1,2\n\n3,4\n";
    const result = parseCsv(text);
    expect(result).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("空テキストで空配列を返す", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   ")).toEqual([]);
  });
});

describe("toNumber", () => {
  it("数値文字列を変換する", () => {
    expect(toNumber("1234")).toBe(1234);
    expect(toNumber("1,234")).toBe(1234);
  });

  it("空文字でフォールバックを返す", () => {
    expect(toNumber("", 99)).toBe(99);
    expect(toNumber(null, 5)).toBe(5);
  });

  it("数値をそのまま返す", () => {
    expect(toNumber(42)).toBe(42);
  });

  it("Infinity でフォールバックを返す", () => {
    expect(toNumber(Infinity, 0)).toBe(0);
  });
});
