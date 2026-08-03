import assert from 'assert'
import fs from 'fs'
import path from 'path'
import closeAndSummaryOrders from '../src/closeAndSummaryOrders.mjs'
import ott from '../src/ott.mjs'
import { t00, t04, t20, buildArrOhlc, buildOrder, buildFdTmp } from './unit-setup.mjs'


//規格來源: src/closeAndSummaryOrders.mjs
//  closeAndSummaryOrders(ott, fdOhlc, fdParam, uIni, timeOhlcStart, timeOhlcEnd, keyOhlc, ordersSubmit, fdTest, opt):
//    以w-data-tdprovide讀取fdOhlc/fdParam數據, 結算ordersSubmit並輸出orders.json/summary.json/report.html至fdTest


let fdTmp = buildFdTmp('closeAndSummaryOrders')


describe('closeAndSummaryOrders', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

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

        await closeAndSummaryOrders(ott, fdOhlc, fdParam, 1000, t00, t20, 'btc', ordersSubmit, fdTest)

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
