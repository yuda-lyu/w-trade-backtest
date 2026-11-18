# 狀態(現況)

本檔記當前已開發功能之最新狀態:各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本.規則帳本(`sgud/rule/rulebook.md`)為藍圖,本檔為現況,兩者比對即知尚未做到者.只記現況,不寫過程(過程寫入 `sgud/exp/experience.md`).

- 最近一次驗證:以 1.1.42 為底之擴充(Gitea #181:每根時長與時間口徑 R-BT;追加:`settings` 數值欄收數字字串並轉型 R-NUM 與 `buildBaseUnitNotional` 回傳 `unit` R-BU-06),全套 157 通過(基準 93 + R-BT 新增 39 + R-NUM 與 R-BU-06 新增 25;wsemi 1.9.66),對拍工具 0 處不同(150 案、21000 項,含「待測版給數字字串 vs 基準版給數字」),未發布(發布由維運端執行).前一次:以 1.1.39 為底之擴充(Gitea #171),全套 93 通過.

## 每根時長與時間口徑(R-BT)

| 功能 | 規則 | 現況 | 測試 | 已知缺口與待辦 |
|---|---|---|---|---|
| `intervalSec`、`timeBasis` 之檢測(`src/barTime.mjs`,不入聚合入口) | R-BT-01 | 已做(60 之倍數、上限 31536000) | `unit-parseBarTime.test.mjs` 8 案 | 不檢查 `intervalSec` 與 K 線之實際間距(不符時 `'span'` 之 `btDays` 與區間檢查失真) |
| 未開 `'span'` 時輸出不變(含只給 `intervalSec`) | R-BT-02 | 已做 | `unit-timeBasis.test.mjs`;對拍工具 | 無 |
| `'span'` 之持倉天數、回測天數 | R-BT-03、04 | 已做 | `unit-timeBasis.test.mjs` | 有日光節約之時區:`btDays` 以末根之時差加秒數(跨切換點可能差 1 小時);本套件預設時區無日光節約 |
| 各入口之傳遞、`runStrategies` 一致性預檢 | R-BT-05 | 已做 | 同上 | 無 |
| `closeAndSummaryOrders` 區間檢查 | R-BT-06 | 已做 | 同上 | 未給 `intervalSec` 時仍以截斷之時數判斷(未對齊之區間如 `00:00 → 04:30` 通過)、不檢查起訖先後(現行,未改) |
| 夏普值年化因子不變 | R-BT-07 | 已做 | 同上 | √252 與年化報酬之 365 口徑不一(既有定義,未改) |

- 同一根 K 線同時觸及止盈與止損時一律先判止損、只用同週期 OHLC(現行,未改;日線之同觸比例較高).
- 結單與報表之產出(`closeAndSummaryOrders`、`genReport`、`runStrategiesAndBacktest` 之 `summary.json` 與報表)不記所用之時間口徑,事後無法分辨(另案).

## settings 數值欄收數字字串並轉型(R-NUM,Gitea #181 之追加項)

| 功能 | 規則 | 現況 | 測試 | 已知缺口與待辦 |
|---|---|---|---|---|
| 數值欄之檢測與轉型(`src/parseSettings.mjs`,不入聚合入口):`uIni`、`uTrade`、`rTakeProfit`、`rStopLoss` 正數,`rFee` 非負數 | R-NUM-01 | 已做:給了(非 `undefined`、`null`)須為有效數字(數字或數字字串),通過即轉 Number 且其後只用轉換值;無效即拒絕、不改用預設;訊息 `invalid <名稱>: must be a positive number`/`a non-negative number` | `unit-parseSettings.test.mjs` 22 案 | 未給之 `uTrade`、`rTakeProfit`、`rStopLoss`、`rFee` 於 `runStrategy`、`runStrategies` 維持原行為(以未給之值運算,摘要失真),**待裁示是否改為拒絕**(現況不屬「給了」) |
| 各入口一致:`runStrategy`、快速評估 `evaluate`、`runStrategies`、`runStrategiesAndBacktest` | R-NUM-02 | 已做:同一檢測函數;先於讀取數據與任何進場(`runStrategiesAndBacktest` 先讀取數據再檢測,不寫檔);`settings.unit` 給了時 `uTrade` 不檢 | 同上;對拍工具 | `runStrategiesAndBacktest` 之檢測可前置於讀取數據(目前只在 `runStrategies` 內預檢,提案已載明,另案) |
| 快速評估之 `tp`、`sl` 與預設 | R-NUM-03 | 已做:`input.tp`、`input.sl`、`opt.tpsls` 同判準並於作鍵與建表前轉型;`settings.uIni`、`uTrade`、`rFee` 未給(含 `null`)取預設 | 同上 | `evaluate` 不使用 `settings.rTakeProfit`、`rStopLoss`(以 `input.tp`、`sl` 為準),故不檢 |
| `runStrategies` 之本金以轉換值累加 | R-NUM-04 | 已做:`uIni` 為數字字串者不再被靜默略過 | 同上 | `runStrategies` 之 `try/catch` 仍吞下其餘一切錯誤(既有) |
| **發現(同形缺陷,不在本案範圍,未改)** | R-NUM-05 | 函數層之數字字串仍以原字串運算:`calcSummary`、`calcOrdersSummary`、`closeAndSummaryOrders` 之 `uIni` 引數(`ispnum` 收字串後 `uEquity = uIni` 串接)、`genReport` 之 `opt.uIni`、`calcOrders` 之 `opt.uIni`(`null` 不取預設)、`loadKLinesTpSl.ordersFromBars` 之 `opt.uTrade`、`uIni`、`rFee`、`tpsl`、`genKLinesTpSl`/`buildKLinesTpSl` 之 `tp`、`sl`、`conds[].th` | — | **待裁示是否另案以 `src/parseSettings.mjs` 同判準處理** |

## 依基礎單位定每單名義(Gitea #171)

| 功能 | 規則 | 現況 | 測試 | 已知缺口與待辦 |
|---|---|---|---|---|
| `calcBaseUnitQuantity(price, rule, opt)`(聚合入口匯出,鍵數 16) | R-BU-01 | 已做:十進位定點(BigInt);price、rule 三欄、buffer、units 收數字或數字字串並通過即轉型;`buffer`、`units` 給了而無效即 throw;訊息依跨套件規格 V19、V20;`rule`、`opt` 須為一般物件(O1);數量或名義轉回 Number 為 `Infinity` 時 throw | `unit-calcBaseUnitQuantity.test.mjs` 12 案 | 無 |
| `settings.unit`(`runStrategy`、快速評估)、`opt.unit`(`ordersFromBars`) | R-BU-02 | 已做:共用 `src/buildBaseUnitNotional.mjs`(不入聚合入口);給了而無效於任何進場之前 throw;未給或 `null` 逐位不變 | `unit-buildBaseUnitNotional.test.mjs` 20 案(含 R-BU-06 三案) | 無 |
| `buildBaseUnitNotional` 回傳轉型後之 `unit` | R-BU-06 | 已做:`{ rule:{stepSize,minQty,minNotional}, buffer, units }`(Number,預設已填),新物件;JSDoc 寫明可計算性檢測為以價格 1 試算 | 同上 | 下游(求解、策略設定、下單端等取用 `src/buildBaseUnitNotional.mjs` 者)改用另排,本輪不改他套件 |
| 摘要之各單名義不同時之性質 | R-BU-03 | 已做(摘要程式未改,以測試固化) | 同上 | 無 |
| 持倉超過本金套件不檢 | R-BU-04 | 已做 | 同上 | 呼叫端以 `summary.uTradeAllMax` 與自己之 `uIni` 比較(使用端各處之處置不同) |
| `runStrategies` 之 `settings.unit` 預檢 | R-BU-05 | 已做:無效 `unit` 先於任何策略之執行即 reject,不被個別策略失敗之略過吞掉 | 同上 | `runStrategies` 之 `try/catch` 仍吞下其餘一切錯誤(既有行為,本案未改) |

## 本案未涵蓋(使用端已定或另案)

- `runStrategies` 之合併本金為各策略 `uIni` 之和(現行);預設 `uIni` 不改;`calcOrders` 不加 `unit` 選項;訂單不另帶數量欄(可由 `calcBaseUnitQuantity(priceStart, rule, { buffer, units })` 重現);快速評估之精簡訂單無 `rProfitOrLoss`(現行);摘要之百分比字串只到 0.01%(現行);`rProfitOrLoss` 於給與不給選項時差 ≤ 1e-12(相對).
- 「回測與線上同一實作」(下單端深層取用 `src/calcBaseUnitQuantity.mjs`,其匯入限於 `wsemi/src/*` 與同層檔案)待下單端套件之案再定.
- `dist/`、`docs/` 未重建(發布流程產生).
