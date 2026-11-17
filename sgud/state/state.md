# 狀態(現況)

本檔記當前已開發功能之最新狀態:各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本.規則帳本(`sgud/rule/rulebook.md`)為藍圖,本檔為現況,兩者比對即知尚未做到者.只記現況,不寫過程(過程寫入 `sgud/exp/experience.md`).

- 最近一次驗證:以 1.1.39 為底之擴充(Gitea #171),全套 93 通過(基準 64 + 新增 29),未發布(發布由維運端執行).

## 依基礎單位定每單名義(Gitea #171)

| 功能 | 規則 | 現況 | 測試 | 已知缺口與待辦 |
|---|---|---|---|---|
| `calcBaseUnitQuantity(price, rule, opt)`(聚合入口匯出,鍵數 16) | R-BU-01 | 已做:十進位定點(BigInt);price、rule 三欄、buffer、units 收數字或數字字串並通過即轉型;`buffer`、`units` 給了而無效即 throw;訊息依跨套件規格 V19、V20;`rule`、`opt` 須為一般物件(O1);數量或名義轉回 Number 為 `Infinity` 時 throw | `unit-calcBaseUnitQuantity.test.mjs` 12 案 | 無 |
| `settings.unit`(`runStrategy`、快速評估)、`opt.unit`(`ordersFromBars`) | R-BU-02 | 已做:共用 `src/buildBaseUnitNotional.mjs`(不入聚合入口);給了而無效於任何進場之前 throw;未給或 `null` 逐位不變 | `unit-buildBaseUnitNotional.test.mjs` 17 案 | 無 |
| 摘要之各單名義不同時之性質 | R-BU-03 | 已做(摘要程式未改,以測試固化) | 同上 | 無 |
| 持倉超過本金套件不檢 | R-BU-04 | 已做 | 同上 | 呼叫端以 `summary.uTradeAllMax` 與自己之 `uIni` 比較(使用端各處之處置不同) |
| `runStrategies` 之 `settings.unit` 預檢 | R-BU-05 | 已做:無效 `unit` 先於任何策略之執行即 reject,不被個別策略失敗之略過吞掉 | 同上 | `runStrategies` 之 `try/catch` 仍吞下其餘一切錯誤(既有行為,本案未改) |

## 本案未涵蓋(使用端已定或另案)

- `runStrategies` 之合併本金為各策略 `uIni` 之和(現行);預設 `uIni` 不改;`calcOrders` 不加 `unit` 選項;訂單不另帶數量欄(可由 `calcBaseUnitQuantity(priceStart, rule, { buffer, units })` 重現);快速評估之精簡訂單無 `rProfitOrLoss`(現行);摘要之百分比字串只到 0.01%(現行);`rProfitOrLoss` 於給與不給選項時差 ≤ 1e-12(相對).
- 「回測與線上同一實作」(下單端深層取用 `src/calcBaseUnitQuantity.mjs`,其匯入限於 `wsemi/src/*` 與同層檔案)待下單端套件之案再定.
- `dist/`、`docs/` 未重建(發布流程產生).
