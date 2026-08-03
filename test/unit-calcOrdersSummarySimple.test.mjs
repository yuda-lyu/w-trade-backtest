import assert from 'assert'
import calcOrders from '../src/calcOrders.mjs'
import calcOrdersSummarySimple from '../src/calcOrdersSummarySimple.mjs'
import ott from '../src/ott.mjs'
import { approx, t00, t20, buildArrOhlc, buildOrders } from './unit-setup.mjs'


//規格來源: src/calcOrdersSummarySimple.mjs
//  calcOrdersSummarySimple: 精簡版, 只算選股熱路徑欄位, 與完整版對應欄位一致


describe('calcOrdersSummarySimple', function() {

    it('對應欄位與完整版一致(numTrade/rWin/uTradeAllMax/uEquityFinal/btDays等)', async function() {
        let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
        let sm = calcOrdersSummarySimple(ott, 1000, orders, t00, t20)
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
