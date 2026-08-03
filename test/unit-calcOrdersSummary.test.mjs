import assert from 'assert'
import calcOrders from '../src/calcOrders.mjs'
import calcOrdersRatio from '../src/calcOrdersRatio.mjs'
import calcOrdersSummary from '../src/calcOrdersSummary.mjs'
import ott from '../src/ott.mjs'
import { approx, t00, t20, buildArrOhlc, buildOrders } from './unit-setup.mjs'


//規格來源: src/calcOrdersSummary.mjs
//  calcOrdersSummary(ott, uIni, ordersAll, timeOhlcStart, timeOhlcEnd): 統計交易次數/勝率/最大回撤/最大持倉/夏普值/最終權益等


describe('calcOrdersSummary', function() {

    let buildSummary = async () => {
        let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
        orders = calcOrdersRatio(ott, orders)
        return calcOrdersSummary(ott, 1000, orders, t00, t20)
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
            calcOrdersSummary(ott, 0, [], t00, t20)
        }, { message: `uIni[0] is not a positive number` })
    })

})
