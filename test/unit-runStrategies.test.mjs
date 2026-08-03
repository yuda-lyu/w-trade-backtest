import assert from 'assert'
import ott from '../src/ott.mjs'
import runStrategies from '../src/runStrategies.mjs'
import { buildStrategy, buildFunGetSeries } from './unit-setup.mjs'


//規格來源: src/runStrategies.mjs
//  runStrategies(ott, strategies, funGetSeries, opt): 逐策略執行(withSummary:false), 合併orders附sid, 以uIni總和跑calcSummary


describe('runStrategies', function() {

    let funGetSeries = buildFunGetSeries()

    it('合併多策略訂單附sid, 以uIni總和2000計算summary', async function() {
        let strategies = [
            { sid: 's1', ...buildStrategy('long', '>', 0.5) },
            { sid: 's2', ...buildStrategy('short', '<', 0.5) },
        ]
        let rr = await runStrategies(ott, strategies, funGetSeries)
        //s1: t00/t08下單2筆; s2: sig<0.5於t04/t12/t16/t20下單4筆(t20單其後無K棒未平倉)
        assert.strictEqual(rr.orders.length, 6)
        assert.deepStrictEqual(rr.orders.map((o) => o.sid), ['s1', 's2', 's1', 's2', 's2', 's2']) //依timeStart排序
        assert.strictEqual(rr.summary.uIni, 2000)
        assert.strictEqual(rr.summary.numTrade, 6)
        assert.strictEqual(rr.summary.numTradeFin, 5)
        assert.strictEqual(rr.summary.rWin, '40.00%') //s1一勝一敗, s2一勝二敗一未平
    })

})
