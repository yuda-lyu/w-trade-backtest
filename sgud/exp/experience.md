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
