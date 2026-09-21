# 料金シミュレーター

## 2026-09-21 第1段階の作業版

ブランチ `feat/calculator-integration-phase1`、起点 `f82f63c315dd04e18e9ef15f399d48c0a53b5cda`。
`src/Calculator.jsx` は既存 `App.jsx` の日程カード・入力欄・小計表示を室料のみへ抽出し、
Flaskの `/api/calculator/catalog` と `/api/calculator/estimate` に接続します。
旧 `App.jsx`・料金ライブラリ・CSVは次段階の参照用として残し、現画面からは呼びません。
延長と祝日を含む金額はPython APIだけで算出し、障害時のCSVへの切替はありません。

- botを `http://127.0.0.1:5000` で起動し、`npm ci` → `npm run dev`。Vite proxyで接続します。
- `npm test`、`npm run build`、`npm run build:integrated` が検証コマンドです。
- 統合版の移植先はbotの `frontend/calculator/`。受け渡し後の主な更新先はbotです。
  Bとbotで恒常的な二重手修正は行いません。
- APIが必要なので、このブランチをGitHub Pagesへデプロイしません。
- 備品・ネット・技術者・複数行・AI相談引継ぎは今回の画面の対象外です。
- 2026-09-21追加承認により、本作業ブランチだけcommit/pushを行います。mainへのmergeと本番反映は別途確認後です。
- GitHub Pagesの現在の配信元は `gh-pages`。本ブランチのCIはテスト・ビルドのみで、`npm run deploy` やPages公開処理を含みません。

## 旧版の仕様・手順（このブランチの現行画面には適用しない）

個人が趣味で作った。部屋利用料・延長料・備品料・インターネット料金を  
ブラウザ上でかんたんに試算できる React アプリです。

---

## アプリ概要

- **STEP 1**: 利用する部屋を選択
- **STEP 2**: 日程・時間区分・備品・インターネットを入力し、リアルタイムで見積を確認

料金データは `public/data/` 以下の CSV ファイルから動的に読み込みます。  
CSV を更新するだけで料金改定に対応できます。

---

## 開発起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開いてください。

---

## ビルド

```bash
npm run build
```

`dist/` ディレクトリに本番用ファイルが出力されます。

---

## GitHub Pages デプロイ

```bash
npm run deploy
```

`vite.config.js` の `base` が `/kokaido-pattern-b-ui/` に設定されています。  
リポジトリ名が異なる場合はここを変更してください。

デプロイ先: `https://<ユーザー名>.github.io/kokaido-pattern-b-ui/`

---

## テスト

```bash
npm test
```

[Vitest](https://vitest.dev/) を使用しています。  
テストファイルは `src/lib/*.test.js` に配置しています。

---

## Lint

```bash
npm run lint
```

---

## public/data/*.csv の役割

| ファイル | 内容 |
|---|---|
| `prices.csv` | 部屋ごとの基本料金（平日・土日祝、時間区分別） |
| `equipment_groups.csv` | 備品グループ定義（適用部屋・区分継承可否） |
| `equipment_master.csv` | 備品マスタ（単価・依存関係・数量上限など） |

---

## 料金計算ルール概要

### 部屋料金
- 時間区分（午前／午後／夜間／全日など）と曜日種別（平日／土日祝）で単価が決まります
- 延長（前後 30 分単位）は別途加算されます

### 備品料金
- **区分課金**: `price_per_slot × 時間倍率 × 数量`
- **一回課金**: `price_once_yen × 数量`（時間区分に関係なく固定）
- PA 拡声装置を選択すると、付属マイク・マイクスタンドが規定本数まで無料になります

### インターネット料金
| プラン | 料金 |
|---|---|
| ポケット Wi-Fi | 2,800 円 / 日 |
| 固定回線 | 初日 18,000 円、**連続した日付**の 2 日目以降 2,000 円 / 日 |
| 臨時回線 | 5,000 円（一回） |

> 固定回線は「連続した日付のまとまり」ごとに初日判定を行います。  
> 例: 4/1-4/2 は連続（18,000 + 2,000）、4/10 は別グループとして再び初日（18,000）。

---

## 技術スタック

- [React 19](https://react.dev/)
- [Vite 8](https://vite.dev/)
- [Vitest](https://vitest.dev/)
- ESLint (flat config)
