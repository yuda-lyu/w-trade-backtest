import assert from 'assert'
import calcOrders from '../src/calcOrders.mjs'
import calcSummary from '../src/calcSummary.mjs'
import ott from '../src/ott.mjs'
import { approx, t00, t20, buildArrOhlc, buildOrders } from './unit-setup.mjs'


//規格來源: src/calcSummary.mjs
//  calcSummary(ott, uIni, orders, timeOhlcStart, timeOhlcEnd): 重算累積收益後執行ratio+summary, 另附timeTest/timeOhlcStart/timeOhlcEnd/uIni


describe('calcSummary', function() {

    it('重算累積收益後回傳完整摘要, 附timeTest/timeOhlcStart/timeOhlcEnd/uIni', async function() {
        let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
        let sm = await calcSummary(ott, 1000, orders, t00, t20)
        assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(sm.timeTest), `timeTest=${sm.timeTest}`)
        assert.strictEqual(sm.timeOhlcStart, t00)
        assert.strictEqual(sm.timeOhlcEnd, t20)
        assert.strictEqual(sm.uIni, 1000)
        assert.strictEqual(sm.numTrade, 4)
        assert.strictEqual(sm.rWin, '66.67%')
        assert.ok(approx(sm.uEquityFinal, 1006.7), `uEquityFinal=${sm.uEquityFinal}`)
    })

    it('timeOhlcStart非有效字串時reject', async function() {
        await assert.rejects(calcSummary(ott, 1000, [], '', t20), { message: `invalid timeOhlcStart[]` })
    })

})
