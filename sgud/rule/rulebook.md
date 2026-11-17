# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

需求出處:Gitea #171(使用端提出之擴充,下單之基礎單位改為交易所之最小可下單數量).本檔於 1.1.39 之後新建,收「依基礎單位定每單名義」一案之規則(R-BU-xx)與本輪觸及之既有規則(R-OPT-01、R-FAST-01、R-SETTLE-01、R-SUM-01、R-PKG-01);其餘既有功能之規則尚未列入.

## 1. 依基礎單位定每單名義(R-BU)

| 編號 | 規則 | 實作 | 測試 | 狀態 |
|---|---|---|---|---|
| R-BU-01 | **基礎單位數量** `calcBaseUnitQuantity(price, rule, opt)`:`rule = { stepSize, minQty, minNotional }`,`opt = { buffer = 0.1, units = 1 }`.格數 `k = max(⌈minQty ÷ stepSize⌉, ⌈minNotional × (1 + buffer) ÷ (price × stepSize)⌉)`,`q0 = k × stepSize`,`n0 = q0 × price`,`quantity = units × q0`,`notional = units × n0`;回傳 `{ k, q0, n0, units, quantity, notional, quantityStr }`(`quantityStr` 為小數位數同 `stepSize` 之定點字串).數量為步長之整數倍、不小於最小數量、名義不低於門檻,且為滿足三者之最小值(`k − 1` 必違反其一).全程十進位定點(BigInt;各數字轉為 Number 後以其最短十進位表示為準,字串須 15 位有效數字內才往返不失真),名義恰等於門檻之邊界不得多取或少取一格(浮點直接計算會多取,例:`Math.ceil(50 * 1.1 / (55000 * 0.001))` 為 2,應為 1).**輸入檢測依跨套件規格〈輸入參數之檢測機制〉**:`price`、`rule.stepSize`、`rule.minQty`、`rule.minNotional`、`opt.buffer` 為有效數字(`isenum`,數字或數字字串;`Infinity`、`NaN`、`'0x10'`、`''`、標記字串、布林、BigInt、包裝物件皆無效),`opt.units` 為有效整數(`iseint`),通過即轉型(`cdbl`、`cint`)後使用(交易所 API 之 `stepSize` 等常為字串);範圍:`price`、`rule` 三欄須大於 0,`buffer` 須大於等於 0,`units` 須大於等於 1.`opt` 為 `undefined` 或 `null` 視為未給;`buffer`、`units` 為 `undefined` 或 `null` 取預設;**給了而無效即 throw,不依 K3 改用預設**(影響下單數量與名義,不靜默改值).訊息一律 `invalid <名稱>: must be <種類>` 且不含輸入值(V19、V20):`invalid price: must be a positive number`、`invalid rule: must be an object`、`invalid rule.<stepSize\|minQty\|minNotional>: must be a positive number`、`invalid opt: must be an object`、`invalid opt.buffer: must be a non-negative number`、`invalid opt.units: must be a positive integer`;格數 `k` 超過 `Number.MAX_SAFE_INTEGER`:`invalid price or rule: step count k must not exceed Number.MAX_SAFE_INTEGER`;`q0`、`n0`、`quantity`、`notional` 轉回 Number 為 `Infinity`(步長、價格或單位數過大,格數雖在安全整數內):`invalid price or rule: quantity and notional must be finite numbers`(不回傳 `Infinity`).`rule` 與 `opt` 須為一般物件(原型為 `Object.prototype` 或 `null`,規格 O1;類別實例、陣列、`Date`、`Map` 無效;內部 `isPlainObject` 為 `isobj` 加原型檢查).不改寫呼叫端之 `rule`、`opt`(V9).自聚合入口匯出 | `src/calcBaseUnitQuantity.mjs`(內部另匯出 `isPlainObject`、`parseBaseUnitPrice`、`parseBaseUnitRule`、`parseBaseUnitOpt`、`calcBaseUnitCore`,不入聚合入口與文件) | `test/unit-calcBaseUnitQuantity.test.mjs`(12 案) | 已做 |
| R-BU-02 | **`unit` 選項**:`runStrategy` 與快速評估之 `settings.unit`、`ordersFromBars` 之 `opt.unit`(形狀 `{ rule, buffer, units }`).給定時每單 `uTrade = units × q0(進場價) × 進場價`(不讀 `uTrade` 設定)、`uFee = rFee × 該單 uTrade`,其餘算式不變(損益 = 名義 × 每單報酬率).`unit` 為 `undefined` 或 `null` ⇒ 視同未給,行為與輸出逐位不變(R-OPT-01);給了而形狀無效(含 `false`、`0`、`''` 等非物件)⇒ 於任何進場之前 throw:`runStrategy`(reject)與快速評估 `evaluate`(throw)為 `invalid settings.unit: must be an object`、`invalid settings.unit.rule: …`、`invalid settings.unit.rule.<欄>: …`、`invalid settings.unit.buffer: …`、`invalid settings.unit.units: …`,`ordersFromBars` 為 `invalid opt.unit…`;價格1之格數超過安全整數或數量與名義超出雙精度範圍 ⇒ `invalid <名稱>: step count k must not exceed Number.MAX_SAFE_INTEGER`、`invalid <名稱>: quantity and notional must be finite numbers`;`unit` 須為一般物件(類別實例無效).三路徑共用 `src/buildBaseUnitNotional.mjs`(`buildBaseUnitNotional(unit, name)` → `{ key, getNotional(price) }`;建立時檢測並以價格 1 試算;同價快取;`key` 為轉型後選項之識別字串,快速評估與載入器內以 `key` 跨次重用;不改寫呼叫端之 `unit`;不入聚合入口,同 `settleOrderPnl`).`calcOrders` 不加選項,自行提交訂單者以 `calcBaseUnitQuantity` 定每單 `uTrade`;訂單不另帶數量欄 | `src/buildBaseUnitNotional.mjs`、`src/runStrategy.mjs`、`src/buildStrategyFastSession.mjs`、`src/loadKLinesTpSl.mjs` | `test/unit-buildBaseUnitNotional.test.mjs`(17 案) | 已做 |
| R-BU-03 | **摘要性質**(程式不改,以測試固化):各單名義不同時,最大持倉 = 各進場時刻未出場各單之進場名義和之最大值;等效年化 = 損益和 ÷ 最大持倉 ÷ 年數;完整版與精簡版對應欄位逐位相同;每單報酬率 `rProfitOrLoss`(= 損益 ÷ 該單名義)與是否給選項無關(相對差 ≤ 1e-12);各單名義為同一常數 C 時,與「未給選項、`uTrade = C`」之訂單與摘要逐位相同 | `src/calcOrdersSummary.mjs`、`src/calcOrdersSummarySimple.mjs`(未改) | `test/unit-buildBaseUnitNotional.test.mjs`(36 組隨機案、常數名義案、績效之例) | 已做 |
| R-BU-04 | **持倉超過本金:套件不檢**.給 `unit` 且最大持倉名義大於 `uIni` 時各路徑照常回傳、不拋錯,摘要之 `uTradeAllMax` 為實際名義(對 `uIni` 之 `rTradeAllMax` 可 ≥ 100%);是否異常由呼叫端以 `summary.uTradeAllMax` 與自己之 `uIni` 比較並決定處置;未給 `unit` 時亦不檢(現行).`runStrategies` 之合併本金為各策略 `uIni` 之和(現行,不因 `unit` 改變).預設 `uIni`(1000)不改 | 上列各路徑皆無此檢查 | `test/unit-buildBaseUnitNotional.test.mjs`(持倉超過 `uIni` 案;`runStrategies` 案) | 已做 |
| R-BU-05 | **多策略預檢**(本案另增,草案無):`runStrategies`(與經其之 `runStrategiesAndBacktest`)之個別策略失敗會被略過(既有行為,以 `try/catch` 吞下一切錯誤),故各策略 `settings.unit` 給了而無效時須先於任何策略之執行即 reject,訊息 `invalid strategies[<索引>].settings.unit…`,不使該策略被靜默略過(靜默略過會改變合併結果);`unit` 為 `undefined` 或 `null` 時不檢 | `src/runStrategies.mjs` | `test/unit-buildBaseUnitNotional.test.mjs`(`runStrategies` 案) | 已做 |

**R-BU 之盤點指令**(站點全集:三條路徑皆經 `buildBaseUnitNotional`):`git grep -n "buildBaseUnitNotional" src`(應僅 `runStrategy`、`buildStrategyFastSession`、`loadKLinesTpSl`、`runStrategies` 四處匯入,另 `calcBaseUnitQuantity` 為其底);`git grep -n "bu.getNotional" src`(逐單定名義之站點:`runStrategy` 1、快速評估 1、`ordersFromBars` 1,各以 `bu !== null` 分支,未給時走原式).

## 2. 本輪觸及之既有規則

| 編號 | 規則 | 實作 | 測試與指令 | 狀態 |
|---|---|---|---|---|
| R-OPT-01 | 未給新選項(`settings.unit`、`opt.unit` 為 `undefined`、`null` 或不存在)時,`runStrategy`、`runStrategies`、快速評估、`ordersFromBars` 與摘要之輸出與前一版逐位相同(浮點以最短十進位字串比對、區分 -0,`timeTest` 除外);快速評估之內迴圈於未給選項時只多一個 `bu !== null` 判斷 | `src/runStrategy.mjs`、`src/buildStrategyFastSession.mjs`、`src/loadKLinesTpSl.mjs` | 對拍工具:`node test/tools/cmpOutputs.mjs <前一版src資料夾>`(150 組隨機案,離開碼 0 為 0 處不同;前一版 src 以 `npm pack` 或 `git archive` 取得);既有單元測試全套 | 已做 |
| R-FAST-01 | 快速評估與官方全鏈(`runStrategy` → `calcOrders` → `calcOrdersSummary`)對應欄位嚴格相等;訂單之結算與累計與 `ordersFromBars` 同構 | `src/buildStrategyFastSession.mjs` | `test/unit-buildStrategyFastSession.test.mjs`(既有);給 `unit` 時 `test/unit-buildBaseUnitNotional.test.mjs` | 已做 |
| R-SETTLE-01 | 單筆結算式與 `calcOrders` 逐字對齊(`settleOrderPnl`,long 為 `uTrade*(priceEnd/priceStart)-uTrade-2*uFee`),供快速評估與 `ordersFromBars` 共用;名義與手續費逐單傳入,不假設各單等額 | `src/settleOrderPnl.mjs` | `test/unit-buildStrategyFastSession.test.mjs`、`test/unit-loadKLinesTpSl.test.mjs`(既有) | 已做 |
| R-SUM-01 | 完整版 `calcOrdersSummary` 與精簡版 `calcOrdersSummarySimple` 對應欄位逐位相同;持倉以各單自身 `uTrade` 於進場時加、出場時減 | `src/calcOrdersSummary.mjs`、`src/calcOrdersSummarySimple.mjs` | `test/unit-calcOrdersSummarySimple.test.mjs`(既有)、`test/unit-buildBaseUnitNotional.test.mjs`(各單名義相異) | 已做 |
| R-PKG-01 | 聚合入口 `src/WTradeBacktest.mjs` 匯出清單(鍵數 16 與順序)須與測試相符;JSDoc 範例所載輸出須與實跑一致(本輪核對新增之 `calcBaseUnitQuantity`、`buildBaseUnitNotional`,既有函數之範例未動);內部共用函數(`settleOrderPnl`、`buildBaseUnitNotional`)不入聚合入口 | `src/WTradeBacktest.mjs` | `test/unit-WTradeBacktest.test.mjs`(匯出清單);`g.mjs` 與 `README.md` 之範例輸出以 `node g.mjs` 實跑核對(會建 `./test/tmp-g/`,核對後須刪除) | 已做 |

## 3. 測試表

| 測試檔 | 規則 | 案數 | 內容 |
|---|---|---|---|
| `test/unit-calcBaseUnitQuantity.test.mjs` | R-BU-01 | 12 | 對照表十列(含名義恰等於門檻三列、受最小數量限制一列);`units`;`buffer`;負向(價格、規則、`opt`、`buffer`、`units`,依跨套件規格之輸入矩陣:標記字串、`'Infinity'`、`'0x10'`、`null`、`undefined`、布林、`NaN`、`Infinity`、BigInt、包裝物件、物件、陣列、類別實例,訊息全文比對;原型為 `null` 之物件有效);格數過大;數量與名義超出雙精度範圍(`Infinity`);數字字串(與數字輸入逐位相同、`rule` 與 `opt` 不被改寫);數字字串之性質(隨機 1000 組、四種字串寫法);各格數之邊界價格與其相鄰浮點數(6 組規則);隨機 2000 組之性質(合法且最小、回傳值為精確十進位之最近浮點數) |
| `test/unit-buildBaseUnitNotional.test.mjs` | R-BU-02 ~ 05 | 17 | 共用函數之值、預設、`key`、事後修改 `rule` 不影響;選項無效之訊息;數字字串之 `key` 與名義;三路徑 36 組隨機案之每單名義、損益、識別不變、摘要(以定義獨立計算)、精簡版與完整版、快速評估與 `ordersFromBars` 與 `runStrategy` 逐位相同;各單名義為常數時與未給選項逐位相同;績效之例;持倉超過 `uIni` 時不拋;無效選項與 `null`(三路徑);不讀 `uTrade`、快取不混用;`runStrategies`;`unit` 各欄為數字字串之三路徑 |
| `test/unit-WTradeBacktest.test.mjs` | R-PKG-01 | 1(既有) | 匯出清單含 `calcBaseUnitQuantity` |

合成資料:K 線為隨機漫步(各棒收盤價相異 ⇒ 各單名義相異)、因子序列逐棒隨機;統計之鑑別前提寫於測試內(36 組中名義相異者 ≥ 30、已平倉 ≥ 200、未平倉 ≥ 10;邊界案每組規則 ≥ 5 個、總數 ≥ 60;性質案兩種約束主導者各 ≥ 100;四種字串寫法各 ≥ 100).

## 4. 破壞性變更紀錄

- 1.1.39 → 本案:無破壞性變更(未給 `unit` 時輸出逐位不變);新增 `calcBaseUnitQuantity` 匯出(聚合入口鍵數 15 → 16).
