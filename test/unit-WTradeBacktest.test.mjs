import assert from 'assert'
import WTradeBacktest from '../src/WTradeBacktest.mjs'


//規格來源: src/WTradeBacktest.mjs
//  WTradeBacktest: 套件匯出物件, 彙整各函數供外部使用
//  各函數之行為測試分別位於同資料夾之unit-{函數名}.test.mjs


describe('WTradeBacktest', function() {

    it('匯出各函數且皆為function', function() {
        let keys = [
            'runStrategy',
            'runStrategies',
            'runStrategiesAndBacktest',
            'calcOrders',
            'calcOrdersRatio',
            'calcOrdersSummary',
            'calcOrdersSummarySimple',
            'calcSummary',
            'closeAndSummaryOrders',
            'genReport',
            'genReportCore',
            'genKLinesTpSl',
            'buildKLinesTpSl',
            'loadKLinesTpSl',
            'buildStrategyFastSession',
        ]
        assert.deepStrictEqual(Object.keys(WTradeBacktest), keys)
        for (let k of keys) {
            assert.strictEqual(typeof WTradeBacktest[k], 'function', `WTradeBacktest.${k}`)
        }
    })

})
