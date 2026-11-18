# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

## 2026-11-18 依基礎單位定每單名義(Gitea #171)

- **`runStrategies` 之逐策略 `try/catch` 會吞下一切錯誤**(不只「時間點無參數無法下單」):新增之設定若在 `runStrategy` 內 throw,經 `runStrategies` 時該策略被靜默略過(全部略過則以誤導之 `invalid timeOhlcStart` 失敗).凡新增「給了而無效即拒絕」之設定鍵,須在 `runStrategies` 之迴圈前預檢(R-BU-05),並以「有效策略與無效策略並存」之案驗證(只測全部無效會被另一個錯誤訊息掩蓋).
- **輸入檢測落地順序**(跨套件規格 §7.2、Q3-c):以 `isenum`(正數另加 `{ gt: 0 }`、非負加 `{ min: 0 }`)或 `iseint(…, { min: 1 })` 判定,通過才 `cdbl`/`cint` 轉型,其後只用轉換值;不用 `isnum`、`Number()`、`cdbl` 之結果判斷.wsemi `isobj` 收類別實例(原型非 `Object.prototype`),與規格 O1(原型為 `Object.prototype` 或 `null`)不同:本案以 `isobj` 加原型檢查之 `isPlainObject`(`src/calcBaseUnitQuantity.mjs`,內部用)落實 O1,wsemi 側之調整列回饋.
- **十進位定點之結果轉回 Number 可能為 `Infinity`**:格數 `k` 在安全整數內不保證 `k × stepSize`、`× price`、`× units` 在雙精度範圍內(例:`stepSize` 1e308、`minQty` 1.5e308 時 `k` 為 2 而 `q0` 為 `Infinity`).對外回傳之數量與名義須 `Number.isFinite`,否則 throw(外審之第一個屬實發現,自己之輸入空間表漏了「結果超出值域」一軸).
- **字串輸入之精度**:十進位轉換經 `cdbl` 轉 Number 後以 `String(Number)` 之最短表示為準,字串須 15 位有效數字內才與原字串之十進位值相同;測試之隨機案以 `String(v)`、`' ' + String(v) + ' '`、`v.toExponential()`、`'+' + String(v)` 四種寫法驗證結果與數字輸入逐位相同.
- **快速評估耗時之比較須防雜訊**:同機有他任務並行時,中位數之誤差可達 ±6% 且正負號會翻(同一密集進場設定下,修改版對前一版之中位數差在 -2.1% 至 +6.9% 間,最小值之差在 +1.7% 至 +13.8% 間,後者亦受長時間執行之漂移影響);以多輪交替執行(兩種先後順序各一次)、以 `process.cpuUsage()` 之 CPU 時間計(比牆鐘受搶佔影響小)並同時看最小值(最不受干擾之估計)判斷,單次或單向之執行不足以下結論(本案以 CPU 時間、25 輪,中位數差為 -0.2% 與 +4.7%、最小值差為 +3.2% 與 +0.2%,兩種順序之正負號不一致,視為雜訊內).密集進場(約半數棒觸發)比稀疏進場更易顯出逐單額外判斷之成本,比較時兩種都要量.
- **`git archive` 於 `core.autocrlf=true` 環境輸出 CRLF 文字**,即使索引為 LF.以其為基準版做字串比對或變異時須先把換行正規化為 LF,否則 `find` 不到而變異未套用.
- **變異測試之做法**:於 `./tmp/` 之副本(src 與 test)內逐項「改壞 → 跑新測試 → 還原」,每項之 `find` 須恰出現一次(或指定第幾次),全部跑完核對副本與 repo 之 src 逐位相同;存活者先判斷是測試缺口還是等價變異(本案之 `X03`「預檢對 falsy 之 `unit` 略過」存活,補 `false`、`0`、`''` 案後轉紅).
- **測試不用 `new Number(…)`/`new String(…)` 造包裝物件**(lint `no-new-wrappers`):以 `Object(1)`、`Object('x')` 取得同樣之包裝物件.
- **對拍工具** `test/tools/cmpOutputs.mjs`:未給新選項時,以前一版 src 為基準比對全部輸出(R-OPT-01);工具本身以「在副本內微幅改動未給選項之路徑」驗證有鑑別力(三處各改一處皆報出差異).前一版 src 取得:`npm pack w-trade-backtest@<版本>` 解出 `package/src`,或 `git archive <commit> src` 解出.
- 暫存資料夾慣例:本套件測試用 `buildFdTmp(name)` 產出之 `./test/tmp-unit-<名>`(測試結束整夾刪除);`g.mjs` 會建 `./test/tmp-g/`,跑完須手動刪除(未被 `.gitignore` 排除).

## 2026-11-18 每根時長與時間口徑(R-BT)

- **修正「以開盤標籤計」之偏差在 4hr 也會改變數字**:持倉天數(日期差 + 1)與回測天數(首末根開盤之日差)之偏差於日線最明顯(次根出場 2 日、少計末根 1 日),但依實際時點重算時 4hr 之跨午夜短單與末根 20:00 之窗亦變.找不到「4hr 恰等於現行、日線正確」之有原則算式,故分成兩個選項:`intervalSec` 只宣告每根時長(不改任何數字),`timeBasis: 'span'` 才改口徑(R-BT-02 ~ 04).
- **摘要不可增欄**:使用端之忠實重放以摘要逐欄比對且把「新摘要獨有之欄」算作差異;新選項若回寫進摘要,即使數字全同也會被判不一致.口徑記在策略檔之 `settings`(策略檔隨檔落地 `settings`,檔名不含之).
- **`calcOrdersSummary` 會就地於訂單上加 `uTradeAll`、`rTradeAll`、`numTradeAll`**,`calcSummary` 會就地重算 `uEquity` 等:對拍時同一份訂單先後餵給摘要與再比訂單本身,會出現「假差異」(本案擴充對拍工具時踩到,改為兩邊各自重建訂單).
- **dayjs 之 `diff(…, 'day', true)` 以時差補償之小數日**:跨日光節約切換日之日線仍為 1 日;`add(n, 'second')` 保留原物件之時差(跨切換點後之當地時刻差 1 小時).
- **以發布版 src 對拍時,副本須放在能解析到同一份相依之位置**(副本置於可解析到同一份相依之專案內,使 `wsemi`、`lodash-es`、`dayjs` 皆解析到同一 `node_modules`),否則會向上解析到不相干之 `node_modules`.
- **`'span'` 改變年化之幅度與窗長成反比**:相對變化約為 `−intervalSec ÷ 86400 ÷ btDays`,長窗(約千日)約 −0.1%,7 根日線之窗約 −14%;只以長窗之實測寫幅度會低估短窗之影響.
- **每根時長之上限**:`intervalSec` 若只要求安全整數,極大值(如 `1e13`)會使 `'span'` 之 `btDays` 經 dayjs 變成 `NaN` 而不拋;故加上 365 日之上限與 60 之倍數.
- **上限之入口級測試須用 60 之倍數之極大值(如 `9e12`)**:`1e13` 不是 60 之倍數,會先被「60 之倍數」之檢查擋下,拿掉上限時入口案仍綠(實測:入口案用 `1e13` 時,拿掉 `max` 之變異存活;改用 `9e12` 後 4 個入口案轉紅,`calcBtDays` 於 `9e12`、`1e13` 皆得 `NaN`).上限、倍數兩個判準各須有只被自己擋下之值.

## 2026-11-18 settings 數值欄收數字字串並轉型(Gitea #181 之追加項,R-NUM、R-BU-06)

- **現況之失真形狀**(1.1.42 實測):`settings.uIni` 為數字字串時 `calcOrders` 之權益以字串串接(`'1000' + 4.9 …`),摘要之等效年化為 `'%'`;`rTakeProfit` 為字串時止盈價 `(1 + '0.05')` 為 `'10.05'`;`runStrategies` 之 `uIni` 為數字字串者被逐策略 `try/catch` 靜默略過,合併本金 0 而 reject `uIni[0]…`;`evaluate` 之 `input.tp` 為字串時 `uEquityFinal` 為 12717 對數字之 1017(同一隨機案);`ispnum(Infinity)` 為真,`uIni: Infinity` 通過後摘要為 `null`.
- **JS 型別強制使部分「用原值」之變異為等價變異**:`1 - '0.03'`、`'0.0005' * 100`、`uMaxMax - '1000'`、比較式皆將數字字串轉為數字,只有 `+`(串接)與以原值存入訂單欄位(`rTakeProfit: st.rTakeProfit`)才顯出差異.故變異「止損價(long)用原值」「止盈價(short)用原值」「`uFee` 之 `rFee` 用原值」「`calcOrdersSummary` 之 `uIni` 用原值」存活,經對拍工具確認 0 處不同後判為等價(非測試缺口);測試以「訂單與摘要之型別皆為 Number」與逐位相等斷言,已涵蓋會顯出差異之站點.
- **值域之判斷**:`uIni`、`uTrade`、`rTakeProfit`、`rStopLoss` 為正數,`rFee` 為非負數(0 為有效).數值之 0 與負數原先靜默產生失真摘要(實測:`uTrade: 0` 使 `uTradeAllMax` 為 0、`rWin` 為 `100.00%`;`rTakeProfit: -1` 使 `uEquityFinal` 為 -1029.9),與 `calcOrdersSummary` 既有之 `uIni` 正數判準、`genKLinesTpSl` 既有之 `tp`、`sl` 正數判準同向;屬「給了而無效即拒絕」之範圍(#181 已定).
- **快取鍵之污染**:快速評估之 `getFirstTouch(tp, sl)` 以 `` `${tp}_${sl}` `` 為鍵,`'0.05'` 與 `0.05` 同鍵;若 `opt.tpsls` 預建以字串建表,其後給數字者亦取到依字串建置之失真表.故轉型須在作鍵與建表之前.
- **`null` 與 `undefined`**:`lodash get(obj, key, 預設)` 只對 `undefined` 取預設,`null` 原樣回傳;快速評估之 `settings.uIni: null` 於舊版以 0 參與運算.統一以 `isGiven`(非 `undefined` 與 `null`)判斷未給.
- **`settings.unit` 給了時 `uTrade` 不使用**:不檢測(無效值不拒),以免拒絕一個不影響結果之欄位;`unit` 為 `null` 視同未給,`uTrade` 仍檢測.
- **修前紅之做法(不經 git stash/checkout)**:`git archive HEAD src` 解到 `./tmp/…/base/src` 為基準版;另建 `red/` 副本(基準版 src 加一個只存在於副本之 `parseSettings.mjs` 樁,使新測試檔可載入)與當前 `test/` 之複本,以 `npx mocha --no-parallel <副本內測試檔>` 跑,各案依 1.1.42 之行為各自失敗(新檔 `unit-parseSettings` 18 敗 3 過、`unit-timeBasis` 25 敗 6 過、`unit-buildBaseUnitNotional` 3 敗;`unit-parseBarTime` 因無 `src/barTime.mjs` 無法載入).
- **變異執行器之階段**:新測試四檔(約 5 秒/項)判生死,存活者再跑對拍工具(約 30 秒/項;數字字串案與「只給 `intervalSec` 不變」由它殺死)判等價與否;一次持鎖不超過 15 分鐘,分批跑.`find` 於 CRLF 檔(`genReport.mjs`、`runStrategiesAndBacktest.mjs`、`README.md`、`g.mjs`、`test/unit-setup.mjs`、`test/unit-buildBaseUnitNotional.test.mjs`)含 `\n` 者會找不到,單行 `find` 不受影響.
- **Edit 工具於 CRLF 檔**:新增之多行文字會依檔案換行寫成 CRLF(實測 `unit-buildBaseUnitNotional.test.mjs` 673 行皆有 CR),不必另轉換行.
- **熱路徑(快速評估)之固定成本**:每次 `evaluate` 新增之檢測(`parseSettingsNum` 三欄、`parseBarTime`、`tp`/`sl` 之 `parseNum`)初版為「逐次配置選項物件、逐欄組合名稱字串、數字亦經 `isenum`」,整體 A/B 單次量測之最小值差為 +6.8%(密集)與 +8.0%(稀疏);改寫後同法再量三次,最小值差落在 -11.7% ~ +16.5%(雜訊大於訊號,無法據以下結論);故改為模組層常數選項、名稱於 throw 時才組合、數字以直接比較先行(與 `isenum` 對數字之判準相同,以 2000 個隨機值與邊界值驗證)後,獨立量測(`process.cpuUsage()`、各 200 萬次)為 `parseSettingsNum` 約 0.14 µs、`parseBarTime` 約 0.01 µs、`parseNum` 兩次約 0.02 µs,合計約 0.2 µs,約為 `evaluate` 單次(約 55 µs,47 根 K 線)之 0.3%.整體 A/B 比較在多任務並行之機器上無法分辨此量級,應以固定成本之獨立量測為準.
- **獨立複審(sonnet,唯讀,只給契約與新舊碼)之收穫**:指出 `runStrategiesAndBacktest` 先讀取數據再檢測(提案已載明,維持)、數值之 0 與 `Infinity` 被收緊(已於 JSDoc 明寫)、三處 JSDoc 與行為不符(已修)、函數層同形缺陷(列入狀態檔「發現」).
