import assert from 'assert'
import fs from 'fs'
import path from 'path'
import calcOrders from '../src/calcOrders.mjs'
import calcOrdersRatio from '../src/calcOrdersRatio.mjs'
import calcOrdersSummary from '../src/calcOrdersSummary.mjs'
import calcOrdersSummarySimple from '../src/calcOrdersSummarySimple.mjs'
import calcSummary from '../src/calcSummary.mjs'
import closeAndSummaryOrders from '../src/closeAndSummaryOrders.mjs'
import genReport from '../src/genReport.mjs'
import ott, { nowTpeStr } from '../src/ott.mjs'
import runStrategies from '../src/runStrategies.mjs'
import runStrategy from '../src/runStrategy.mjs'
import writeJson from '../src/writeJson.mjs'
import writeTxt from '../src/writeTxt.mjs'


//規格來源: src/calcOrders.mjs, src/calcOrdersRatio.mjs, src/calcOrdersSummary.mjs, src/calcOrdersSummarySimple.mjs,
//         src/calcSummary.mjs, src/runStrategy.mjs, src/runStrategies.mjs, src/genReport.mjs, src/closeAndSummaryOrders.mjs
//  calcOrders(arrOhlc, orders, {uIni}): 依timeStart排序逐單結算, long以Low<=priceStopLoss先判止損, High>=priceTakeProfit判止盈;
//    short以High>=priceStopLoss先判止損, Low<=priceTakeProfit判止盈; 僅檢查time>timeStart之K棒;
//    long盈虧 = uTrade*(priceEnd/priceStart) - uTrade - 2*uFee; short盈虧 = (priceStart-priceEnd)*(uTrade/priceStart) - 2*uFee;
//    並累計uCumuProfitOrLoss/uEquity(自uIni起), modeResult = 盈虧<0 ? 'loss' : 'profit', 未觸發者維持原單(未平倉)
//  calcOrdersRatio(orders): 各已平倉單計算dayHold(以日期差+1)與rProfitOrLossDay = (1+rProfitOrLoss)^(1/dayHold)-1
//  calcOrdersSummary(uIni, ordersAll, timeOhlcStart, timeOhlcEnd): 統計交易次數/勝率/最大回撤/最大持倉/夏普值/最終權益等
//  calcOrdersSummarySimple: 精簡版, 只算選股熱路徑欄位, 與完整版對應欄位一致
//  calcSummary(uIni, orders, timeOhlcStart, timeOhlcEnd): 重算累積收益後執行ratio+summary, 另附timeTest/timeOhlcStart/timeOhlcEnd/uIni
//  runStrategy(strategy, funGetSeries, opt): 依conds(sym/th/opr)於各時間點判斷觸發下單, 以settings計算止盈止損價格, 再走calcOrders+summary
//  runStrategies(strategies, funGetSeries, opt): 逐策略執行(withSummary:false), 合併orders附sid, 以uIni總和跑calcSummary
//  genReport(r, fpOut): 讀取src內tmp.html與render*.js模板, 置換{name}/{orders}/{summary}後寫出html
//  closeAndSummaryOrders(fdOhlc, fdParam, uIni, timeOhlcStart, timeOhlcEnd, keyOhlc, ordersSubmit, fdTest, opt):
//    以w-data-tdprovide讀取fdOhlc/fdParam數據, 結算ordersSubmit並輸出orders.json/summary.json/report.html至fdTest


//approx, 浮點容差比較
let approx = (a, b, tol = 1e-9) => Math.abs(a - b) < tol


//fixtures: 6根4hr K線(同一日內, 2020-01-01T00:00至20:00)
let t00 = '2020-01-01T00:00:00'
let t04 = '2020-01-01T04:00:00'
let t08 = '2020-01-01T08:00:00'
let t12 = '2020-01-01T12:00:00'
let t16 = '2020-01-01T16:00:00'
let t20 = '2020-01-01T20:00:00'
let buildArrOhlc = () => {
    return [
        { time: t00, Open: 100, High: 101, Low: 99, Close: 100 },
        { time: t04, Open: 100, High: 106, Low: 100, Close: 105 },
        { time: t08, Open: 105, High: 107, Low: 102, Close: 103 },
        { time: t12, Open: 103, High: 104, Low: 94, Close: 95 },
        { time: t16, Open: 95, High: 98, Low: 92, Close: 93 },
        { time: t20, Open: 93, High: 99, Low: 95, Close: 97 },
    ]
}

//buildOrders: 4張手工下單(calcOrders會就地修改訂單, 故每次重建)
//  A: long@t00, priceStart=100, TP=105(t04之High=106觸發止盈), SL=97
//  B: long@t04, priceStart=105, TP=110.25, SL=101.85(t12之Low=94觸發止損)
//  C: short@t08, priceStart=103, TP=97.85(t12之Low=94觸發止盈), SL=106.09
//  D: long@t16, priceStart=93, TP=105, SL=85(其後K棒皆未觸發, 未平倉)
let buildOrder = (mode, timeStart, priceStart, priceTakeProfit, priceStopLoss) => {
    return {
        mode,
        timeStart,
        priceStart,
        uTrade: 100,
        priceTakeProfit,
        priceStopLoss,
        timeEnd: '',
        priceEnd: '',
        modeResult: '',
        uFee: 0.05, //rFee=0.0005, uFee=0.0005*100
    }
}
let buildOrders = () => {
    return [
        buildOrder('long', t00, 100, 105, 97),
        buildOrder('long', t04, 105, 110.25, 101.85),
        buildOrder('short', t08, 103, 97.85, 106.09),
        buildOrder('long', t16, 93, 105, 85),
    ]
}

//暫存根資料夾: 各測試檔獨立使用./test/tmp-{測試名}, 結束時整夾刪除, 不與其他測試檔共用父層
let fdTmp = path.resolve('./test/tmp-unit-WDataTdbacktest')


describe('WDataTdbacktest', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    describe('calcOrders', function() {

        it('long止盈: A單於t04以High>=priceTakeProfit結算, 盈虧=100*(105/100)-100-2*0.05=4.9', async function() {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            let o = orders[0]
            assert.strictEqual(o.timeEnd, t04)
            assert.strictEqual(o.priceEnd, 105)
            assert.strictEqual(o.modeResult, 'profit')
            assert.ok(approx(o.uProfitOrLoss, 4.9), `uProfitOrLoss=${o.uProfitOrLoss}`)
            assert.ok(approx(o.rProfitOrLoss, 0.049), `rProfitOrLoss=${o.rProfitOrLoss}`)
            assert.ok(approx(o.uCumuProfitOrLoss, 4.9), `uCumuProfitOrLoss=${o.uCumuProfitOrLoss}`)
            assert.strictEqual(o.rCumuProfitOrLoss, '0.49%')
            assert.ok(approx(o.uEquity, 1004.9), `uEquity=${o.uEquity}`)
        })

        it('long止損: B單於t12以Low<=priceStopLoss結算, 盈虧=100*(101.85/105)-100-0.1=-3.1', async function() {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            let o = orders[1]
            assert.strictEqual(o.timeEnd, t12)
            assert.strictEqual(o.priceEnd, 101.85)
            assert.strictEqual(o.modeResult, 'loss')
            assert.ok(approx(o.uProfitOrLoss, -3.1), `uProfitOrLoss=${o.uProfitOrLoss}`)
            assert.ok(approx(o.uCumuProfitOrLoss, 1.8), `uCumuProfitOrLoss=${o.uCumuProfitOrLoss}`)
            assert.strictEqual(o.rCumuProfitOrLoss, '0.18%')
            assert.ok(approx(o.uEquity, 1001.8), `uEquity=${o.uEquity}`)
        })

        it('short止盈: C單於t12以Low<=priceTakeProfit結算, 盈虧=(103-97.85)*(100/103)-0.1=4.9', async function() {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            let o = orders[2]
            assert.strictEqual(o.timeEnd, t12)
            assert.strictEqual(o.priceEnd, 97.85)
            assert.strictEqual(o.modeResult, 'profit')
            assert.ok(approx(o.uProfitOrLoss, 4.9), `uProfitOrLoss=${o.uProfitOrLoss}`)
            assert.ok(approx(o.uCumuProfitOrLoss, 6.7), `uCumuProfitOrLoss=${o.uCumuProfitOrLoss}`)
            assert.strictEqual(o.rCumuProfitOrLoss, '0.67%')
            assert.ok(approx(o.uEquity, 1006.7), `uEquity=${o.uEquity}`)
        })

        it('未觸發止盈止損: D單維持未平倉(modeResult為空字串)', async function() {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            let o = orders[3]
            assert.strictEqual(o.timeEnd, '')
            assert.strictEqual(o.priceEnd, '')
            assert.strictEqual(o.modeResult, '')
        })

    })

    describe('calcOrdersRatio', function() {

        it('同日結算單dayHold=1, rProfitOrLossDay=(1+rProfitOrLoss)^(1/1)-1', async function() {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            orders = calcOrdersRatio(orders)
            assert.strictEqual(orders[0].dayHold, 1)
            assert.ok(approx(orders[0].rProfitOrLossDay, 0.049), `rProfitOrLossDay=${orders[0].rProfitOrLossDay}`)
            assert.strictEqual(orders[1].dayHold, 1)
            assert.ok(approx(orders[1].rProfitOrLossDay, -0.031), `rProfitOrLossDay=${orders[1].rProfitOrLossDay}`)
        })

        it('跨日單dayHold以日期差+1, rProfitOrLossDay=(1.331)^(1/3)-1=0.1', function() {
            let orders = calcOrdersRatio([{
                modeResult: 'profit',
                timeStart: '2020-01-01T20:00:00',
                timeEnd: '2020-01-03T04:00:00',
                rProfitOrLoss: 0.331,
            }])
            assert.strictEqual(orders[0].dayHold, 3)
            assert.ok(approx(orders[0].rProfitOrLossDay, 0.1), `rProfitOrLossDay=${orders[0].rProfitOrLossDay}`)
        })

        it('未平倉單不計算(無dayHold欄位)', function() {
            let orders = calcOrdersRatio([{ modeResult: '', timeStart: t00 }])
            assert.strictEqual(orders[0].dayHold, undefined)
        })

    })

    describe('calcOrdersSummary', function() {

        let buildSummary = async () => {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            orders = calcOrdersRatio(orders)
            return calcOrdersSummary(1000, orders, t00, t20)
        }

        it('交易次數與勝率: 4筆共3筆已平倉, 2勝1敗, rWin=66.67%', async function() {
            let sm = await buildSummary()
            assert.strictEqual(sm.numTrade, 4)
            assert.strictEqual(sm.numTradeFin, 3)
            assert.strictEqual(sm.numTradeUnsettled, 1)
            assert.strictEqual(sm.rWin, '66.67%')
        })

        it('最大回撤: uEquity自1004.9降至1001.8, uDrawdownMax=3.1, rDrawdownMax=3.1/1004.9=0.31%', async function() {
            let sm = await buildSummary()
            assert.ok(approx(sm.uDrawdownMax, 3.1), `uDrawdownMax=${sm.uDrawdownMax}`)
            assert.strictEqual(sm.rDrawdownMax, '0.31%')
            //等效最大回撤 = 3.1/(1004.9-1000+200) = 1.51%
            assert.strictEqual(sm.rEquivalentDrawdownMax, '1.51%')
        })

        it('最大持倉: t08時A已平倉而B/C在倉共200, rTradeAllMax=20.00%, numTradeAllMax=2', async function() {
            let sm = await buildSummary()
            assert.strictEqual(sm.uTradeAllMax, 200)
            assert.strictEqual(sm.rTradeAllMax, '20.00%')
            assert.strictEqual(sm.numTradeAllMax, 2)
        })

        it('最終權益與盈虧: uEquityFinal=1006.7, uCumuProfitOrLossFinal=6.7, 等效盈虧=6.7/200=3.35%', async function() {
            let sm = await buildSummary()
            assert.ok(approx(sm.uEquityFinal, 1006.7), `uEquityFinal=${sm.uEquityFinal}`)
            assert.ok(approx(sm.uCumuProfitOrLossFinal, 6.7), `uCumuProfitOrLossFinal=${sm.uCumuProfitOrLossFinal}`)
            assert.strictEqual(sm.rCumuProfitOrLossFinal, '0.67%')
            assert.strictEqual(sm.rEquivalentCumuProfitOrLossFinal, '3.35%')
        })

        it('夏普值: 日報酬{0.049,-0.031,0.049}加權計算, rSharpe=(0.0223/0.0462)*sqrt(252)=7.676', async function() {
            let sm = await buildSummary()
            assert.ok(approx(sm.rSharpe, 7.6758, 0.01), `rSharpe=${sm.rSharpe}`)
        })

        it('回測時長: 同日內btDays=0, btYears=0.0, 年化與等效年化為0.00%', async function() {
            let sm = await buildSummary()
            assert.strictEqual(sm.btDays, 0)
            assert.strictEqual(sm.btYears, '0.0')
            assert.strictEqual(sm.rCumuProfitOrLossFinalNormYear, '0.00%')
            assert.strictEqual(sm.rEquivalentCumuProfitOrLossFinalNormYear, '0.00%')
        })

        it('uIni非正數時throw', function() {
            assert.throws(() => {
                calcOrdersSummary(0, [], t00, t20)
            }, { message: `uIni[0] is not a positive number` })
        })

    })

    describe('calcOrdersSummarySimple', function() {

        it('對應欄位與完整版一致(numTrade/rWin/uTradeAllMax/uEquityFinal/btDays等)', async function() {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            let sm = calcOrdersSummarySimple(1000, orders, t00, t20)
            assert.strictEqual(sm.numTrade, 4)
            assert.strictEqual(sm.numTradeFin, 3)
            assert.strictEqual(sm.rWin, '66.67%')
            assert.strictEqual(sm.uTradeAllMax, 200)
            assert.strictEqual(sm.rTradeAllMax, '20.00%')
            assert.ok(approx(sm.uEquityFinal, 1006.7), `uEquityFinal=${sm.uEquityFinal}`)
            assert.strictEqual(sm.btDays, 0)
            assert.strictEqual(sm.btYears, '0.0')
            assert.strictEqual(sm.rEquivalentCumuProfitOrLossFinalNormYear, '0.00%')
            assert.strictEqual(sm.timeOhlcStart, t00)
            assert.strictEqual(sm.timeOhlcEnd, t20)
        })

    })

    describe('calcSummary', function() {

        it('重算累積收益後回傳完整摘要, 附timeTest/timeOhlcStart/timeOhlcEnd/uIni', async function() {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            let sm = await calcSummary(1000, orders, t00, t20)
            assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(sm.timeTest), `timeTest=${sm.timeTest}`)
            assert.strictEqual(sm.timeOhlcStart, t00)
            assert.strictEqual(sm.timeOhlcEnd, t20)
            assert.strictEqual(sm.uIni, 1000)
            assert.strictEqual(sm.numTrade, 4)
            assert.strictEqual(sm.rWin, '66.67%')
            assert.ok(approx(sm.uEquityFinal, 1006.7), `uEquityFinal=${sm.uEquityFinal}`)
        })

        it('timeOhlcStart非有效字串時reject', async function() {
            await assert.rejects(calcSummary(1000, [], '', t20), { message: `invalid timeOhlcStart[]` })
        })

    })

    describe('runStrategy', function() {

        //sig訊號: t00與t08為1(>th觸發), 其餘為0
        let arrSig = [
            { time: t00, param: 1 },
            { time: t04, param: 0 },
            { time: t08, param: 1 },
            { time: t12, param: 0 },
            { time: t16, param: 0 },
            { time: t20, param: 0 },
        ]
        let funGetSeries = async (key) => {
            if (key === 'btc') {
                return buildArrOhlc()
            }
            if (key === 'sig') {
                return arrSig
            }
            throw new Error(`invalid key[${key}]`)
        }
        let buildStrategy = (mode, sym, th) => {
            return {
                mode,
                keyOhlc: 'btc',
                conds: [{ key: 'sig', sym, th, opr: 'and' }],
                settings: {
                    uIni: 1000,
                    uTrade: 100,
                    rTakeProfit: 0.05,
                    rStopLoss: 0.03,
                    rFee: 0.0005,
                },
            }
        }

        it('long策略: sig>0.5於t00與t08下單, t00單止盈於t04, t08單止損於t12', async function() {
            let r = await runStrategy(buildStrategy('long', '>', 0.5), funGetSeries)
            assert.strictEqual(r.orders.length, 2)
            let o0 = r.orders[0]
            assert.strictEqual(o0.mode, 'long')
            assert.strictEqual(o0.timeStart, t00)
            assert.strictEqual(o0.priceStart, 100) //下單時Close
            assert.strictEqual(o0.timeEnd, t04)
            assert.strictEqual(o0.priceEnd, 105) //priceTakeProfit=(1+0.05)*100
            assert.strictEqual(o0.modeResult, 'profit')
            let o1 = r.orders[1]
            assert.strictEqual(o1.timeStart, t08)
            assert.strictEqual(o1.priceStart, 103)
            assert.strictEqual(o1.timeEnd, t12)
            assert.strictEqual(o1.priceEnd, 99.91) //priceStopLoss=(1-0.03)*103
            assert.strictEqual(o1.modeResult, 'loss')
        })

        it('summary附timeOhlcStart/timeOhlcEnd/uIni與統計欄位', async function() {
            let r = await runStrategy(buildStrategy('long', '>', 0.5), funGetSeries)
            assert.strictEqual(r.summary.timeOhlcStart, t00)
            assert.strictEqual(r.summary.timeOhlcEnd, t20)
            assert.strictEqual(r.summary.uIni, 1000)
            assert.strictEqual(r.summary.numTrade, 2)
            assert.strictEqual(r.summary.numTradeFin, 2)
            assert.strictEqual(r.summary.rWin, '50.00%')
        })

        it('mode非long或short時reject', async function() {
            await assert.rejects(runStrategy({ mode: 'x' }, funGetSeries), { message: `invalid strategy.mode[x] not 'long' or 'short'` })
        })

        it('withSummary:false時summary不含統計欄位', async function() {
            let r = await runStrategy(buildStrategy('long', '>', 0.5), funGetSeries, { withSummary: false })
            assert.strictEqual(r.summary.numTrade, undefined)
            assert.strictEqual(r.summary.timeOhlcStart, t00)
        })

        it('runStrategies: 合併多策略訂單附sid, 以uIni總和2000計算summary', async function() {
            let strategies = [
                { sid: 's1', ...buildStrategy('long', '>', 0.5) },
                { sid: 's2', ...buildStrategy('short', '<', 0.5) },
            ]
            let rr = await runStrategies(strategies, funGetSeries)
            //s1: t00/t08下單2筆; s2: sig<0.5於t04/t12/t16/t20下單4筆(t20單其後無K棒未平倉)
            assert.strictEqual(rr.orders.length, 6)
            assert.deepStrictEqual(rr.orders.map((o) => o.sid), ['s1', 's2', 's1', 's2', 's2', 's2']) //依timeStart排序
            assert.strictEqual(rr.summary.uIni, 2000)
            assert.strictEqual(rr.summary.numTrade, 6)
            assert.strictEqual(rr.summary.numTradeFin, 5)
            assert.strictEqual(rr.summary.rWin, '40.00%') //s1一勝一敗, s2一勝二敗一未平
        })

    })

    describe('genReport', function() {

        it('置換模板{name}/{orders}/{summary}後寫出html', async function() {
            let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
            orders = calcOrdersRatio(orders)
            let summary = calcOrdersSummary(1000, orders, t00, t20)
            let fpOut = path.resolve(fdTmp, 'report.html')
            genReport({ name: '單元測試報告', orders, summary }, fpOut)
            assert.ok(fs.existsSync(fpOut))
            let h = fs.readFileSync(fpOut, 'utf8')
            assert.ok(h.includes('單元測試報告'))
            assert.ok(!h.includes('{orders}'))
            assert.ok(!h.includes('{summary}'))
            assert.ok(h.includes(t00)) //orders已注入
        })

    })

    describe('ott', function() {

        it('解析秒時間字串並可format與diff', function() {
            assert.strictEqual(ott('2020-01-01T00:00:00').format('YYYY-MM-DD'), '2020-01-01')
            assert.strictEqual(ott('2020-01-03T04:00:00').diff(ott('2020-01-01T20:00:00'), 'day'), 1)
        })

        it('nowTpeStr回傳台北時區秒時間字串', function() {
            assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(nowTpeStr()))
        })

    })

    describe('writeJson與writeTxt', function() {

        it('writeJson自動建立資料夾並寫出json, structured:true為多行縮排', function() {
            let fp = path.resolve(fdTmp, 'sub-json', 'a.json')
            writeJson(fp, { a: 1, b: [2, 3] }, { structured: true })
            let c = fs.readFileSync(fp, 'utf8')
            assert.deepStrictEqual(JSON.parse(c), { a: 1, b: [2, 3] })
            assert.ok(c.includes('\n'))
        })

        it('writeTxt自動建立資料夾並寫出文字', function() {
            let fp = path.resolve(fdTmp, 'sub-txt', 'a.txt')
            writeTxt(fp, 'abc中文')
            assert.strictEqual(fs.readFileSync(fp, 'utf8'), 'abc中文')
        })

    })

    describe('closeAndSummaryOrders', function() {

        it('以w-data-tdprovide讀取數據結算訂單, 輸出orders.json/summary.json/report.html', async function() {
            //fixtures: fdOhlc放btc.json, fdParam為空資料夾
            let fdOhlc = path.resolve(fdTmp, 'data-ohlc')
            let fdParam = path.resolve(fdTmp, 'data-param')
            let fdTest = path.resolve(fdTmp, 'result')
            fs.mkdirSync(fdOhlc, { recursive: true })
            fs.mkdirSync(fdParam, { recursive: true })
            fs.writeFileSync(path.resolve(fdOhlc, 'btc.json'), JSON.stringify(buildArrOhlc()), 'utf8')

            //ordersSubmit: A單(止盈於t04)
            let ordersSubmit = [buildOrder('long', t00, 100, 105, 97)]

            await closeAndSummaryOrders(fdOhlc, fdParam, 1000, t00, t20, 'btc', ordersSubmit, fdTest)

            //orders.json
            let orders = JSON.parse(fs.readFileSync(path.resolve(fdTest, 'orders.json'), 'utf8'))
            assert.strictEqual(orders.length, 1)
            assert.strictEqual(orders[0].timeEnd, t04)
            assert.strictEqual(orders[0].modeResult, 'profit')

            //summary.json
            let stsm = JSON.parse(fs.readFileSync(path.resolve(fdTest, 'summary.json'), 'utf8'))
            assert.strictEqual(stsm.name, '全部策略')
            assert.strictEqual(stsm.summary.numTrade, 1)
            assert.strictEqual(stsm.summary.rWin, '100.00%')

            //report.html
            assert.ok(fs.existsSync(path.resolve(fdTest, 'report.html')))
        })

    })

})
