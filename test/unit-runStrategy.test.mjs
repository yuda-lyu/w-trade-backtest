import assert from 'assert'
import ott from '../src/ott.mjs'
import runStrategy from '../src/runStrategy.mjs'
import { t00, t04, t08, t12, t20, buildStrategy, buildFunGetSeries } from './unit-setup.mjs'


//規格來源: src/runStrategy.mjs
//  runStrategy(ott, strategy, funGetSeries, opt): 依conds(sym/th/opr)於各時間點判斷觸發下單, 以settings計算止盈止損價格, 再走calcOrders+summary


describe('runStrategy', function() {

    let funGetSeries = buildFunGetSeries()

    it('long策略: sig>0.5於t00與t08下單, t00單止盈於t04, t08單止損於t12', async function() {
        let r = await runStrategy(ott, buildStrategy('long', '>', 0.5), funGetSeries)
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
        let r = await runStrategy(ott, buildStrategy('long', '>', 0.5), funGetSeries)
        assert.strictEqual(r.summary.timeOhlcStart, t00)
        assert.strictEqual(r.summary.timeOhlcEnd, t20)
        assert.strictEqual(r.summary.uIni, 1000)
        assert.strictEqual(r.summary.numTrade, 2)
        assert.strictEqual(r.summary.numTradeFin, 2)
        assert.strictEqual(r.summary.rWin, '50.00%')
    })

    it('mode非long或short時reject', async function() {
        await assert.rejects(runStrategy(ott, { mode: 'x' }, funGetSeries), { message: `invalid strategy.mode[x] not 'long' or 'short'` })
    })

    it('withSummary:false時summary不含統計欄位', async function() {
        let r = await runStrategy(ott, buildStrategy('long', '>', 0.5), funGetSeries, { withSummary: false })
        assert.strictEqual(r.summary.numTrade, undefined)
        assert.strictEqual(r.summary.timeOhlcStart, t00)
    })

})
