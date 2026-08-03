import assert from 'assert'
import calcOrders from '../src/calcOrders.mjs'
import { approx, t04, t12, buildArrOhlc, buildOrders } from './unit-setup.mjs'


//規格來源: src/calcOrders.mjs
//  calcOrders(arrOhlc, orders, {uIni}): 依timeStart排序逐單結算, long以Low<=priceStopLoss先判止損, High>=priceTakeProfit判止盈;
//    short以High>=priceStopLoss先判止損, Low<=priceTakeProfit判止盈; 僅檢查time>timeStart之K棒;
//    long盈虧 = uTrade*(priceEnd/priceStart) - uTrade - 2*uFee; short盈虧 = (priceStart-priceEnd)*(uTrade/priceStart) - 2*uFee;
//    並累計uCumuProfitOrLoss/uEquity(自uIni起), modeResult = 盈虧<0 ? 'loss' : 'profit', 未觸發者維持原單(未平倉)


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
