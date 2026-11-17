# 回饋

本檔記任務中發現之自有套件、全域技能、全域設定之調整與抽提提案(一條一列,只增不改;處置結果另記一列並寫明承接哪一列).回饋是紀錄與提案,實際修改依全域設定§5.2、§13 之通報管道.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-18 | 自有套件 | wsemi `isobj` | `isobj` 對類別實例回 `true`(以 `Object.prototype.toString` 判定),而跨套件規格〈輸入參數之檢測機制〉§3.6 O1 定義一般物件為原型是 `Object.prototype` 或 `null`、類別實例無效.本套件 `rule`、`opt`、`unit` 以 `isobj` 加原型檢查之內部 `isPlainObject` 落實 O1(`src/calcBaseUnitQuantity.mjs`);建議 wsemi 提供符合 O1 之共用判斷函數(各套件各寫一份加原型檢查即為等價實作),或於 `isobj` 之 JSDoc 明載與 O1 之差異 | `node_modules/wsemi/src/isobj.mjs:16-19`;實跑:`isobj(new (class A {})())` 為 `true` |
| 2026-11-18 | 全域設定 | 跨套件規格〈輸入參數之檢測機制〉§6 V19 | V19 之種類描述表只列 N1、N2、B1~B3、S1、S3、T1,未列「一般物件」「正數」「非負數」「正整數」等描述詞;本案自擬 `an object`、`a positive number`、`a non-negative number`、`a positive integer`(後者見該節範圍子型之例).建議補入描述表,以免各套件各自擬詞而訊息不一 | 規格 §6 V19 條列;`src/calcBaseUnitQuantity.mjs` 之訊息 |
| 2026-11-18 | 自有套件 | w-trade-backtest(`runStrategies`) | `runStrategies` 之逐策略 `try/catch` 吞下一切錯誤(註解寫「時間點無參數無法下單」,實際連 `uIni` 非數字等設定錯誤亦吞),使新增之「給了而無效即拒絕」設定被靜默略過;本案以預檢處理 `settings.unit`(R-BU-05).建議日後另案縮窄 `catch` 之範圍,或回報被略過之策略與原因 | `src/runStrategies.mjs:106,136`(`try` 與 `catch`);測試 `test/unit-buildBaseUnitNotional.test.mjs` 之 `runStrategies` 案(變異 X01 轉紅) |
| 2026-11-18 | 全域技能 | role-coder-for-test(變異測試) | 各套件之「變異清單」皆各自手寫執行器(副本內改壞 → 跑測試 → 還原 → 核對副本與原檔相同,`find` 須恰出現一次、多處編輯、存活者之處置);建議於技能附一份可複製之執行器範本與清單格式,減少各案重寫與漏還原之風險 | 本案 `./tmp/` 之 82 項變異執行器(未入庫,結案清除) |
