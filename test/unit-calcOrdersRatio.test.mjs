import assert from 'assert'
import calcOrders from '../src/calcOrders.mjs'
import calcOrdersRatio from '../src/calcOrdersRatio.mjs'
import ott from '../src/ott.mjs'
import { approx, t00, buildArrOhlc, buildOrders } from './unit-setup.mjs'


//規格來源: src/calcOrdersRatio.mjs
//  calcOrdersRatio(ott, orders): 各已平倉單計算dayHold(以日期差+1)與rProfitOrLossDay = (1+rProfitOrLoss)^(1/dayHold)-1


describe('calcOrdersRatio', function() {

    it('同日結算單dayHold=1, rProfitOrLossDay=(1+rProfitOrLoss)^(1/1)-1', async function() {
        let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
        orders = calcOrdersRatio(ott, orders)
        assert.strictEqual(orders[0].dayHold, 1)
        assert.ok(approx(orders[0].rProfitOrLossDay, 0.049), `rProfitOrLossDay=${orders[0].rProfitOrLossDay}`)
        assert.strictEqual(orders[1].dayHold, 1)
        assert.ok(approx(orders[1].rProfitOrLossDay, -0.031), `rProfitOrLossDay=${orders[1].rProfitOrLossDay}`)
    })

    it('跨日單dayHold以日期差+1, rProfitOrLossDay=(1.331)^(1/3)-1=0.1', function() {
        let orders = calcOrdersRatio(ott, [{
            modeResult: 'profit',
            timeStart: '2020-01-01T20:00:00',
            timeEnd: '2020-01-03T04:00:00',
            rProfitOrLoss: 0.331,
        }])
        assert.strictEqual(orders[0].dayHold, 3)
        assert.ok(approx(orders[0].rProfitOrLossDay, 0.1), `rProfitOrLossDay=${orders[0].rProfitOrLossDay}`)
    })

    it('未平倉單不計算(無dayHold欄位)', function() {
        let orders = calcOrdersRatio(ott, [{ modeResult: '', timeStart: t00 }])
        assert.strictEqual(orders[0].dayHold, undefined)
    })

})
