import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ott from '../src/ott.mjs'
import runStrategiesAndBacktest from '../src/runStrategiesAndBacktest.mjs'
import { t00, t20, buildArrOhlc, buildArrSig, buildStrategy, buildFdTmp } from './unit-setup.mjs'


//規格來源: src/runStrategiesAndBacktest.mjs
//  runStrategiesAndBacktest(ott, fdOhlc, fdParam, strategies, timeStart, timeEnd, fdTest, opt):
//    以w-data-tdprovide讀取fdOhlc/fdParam數據建立funGetSeries後跑runStrategies, 結果name為'全部策略',
//    並依opt.writeOrders/writeSummary/writeReport(皆預設true)輸出orders.json/summary.json/report.html至fdTest


let fdTmp = buildFdTmp('runStrategiesAndBacktest')


describe('runStrategiesAndBacktest', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    let strategies = [
        { sid: 's1', ...buildStrategy('long', '>', 0.5) },
        { sid: 's2', ...buildStrategy('short', '<', 0.5) },
    ]

    //buildFdData: 於`${fdTmp}/${fd}`建立data-ohlc(btc.json)與data-param(sig.json), 回傳兩資料夾路徑
    let buildFdData = (fd) => {
        let fdOhlc = path.resolve(fdTmp, fd, 'data-ohlc')
        let fdParam = path.resolve(fdTmp, fd, 'data-param')
        fs.mkdirSync(fdOhlc, { recursive: true })
        fs.mkdirSync(fdParam, { recursive: true })
        fs.writeFileSync(path.resolve(fdOhlc, 'btc.json'), JSON.stringify(buildArrOhlc()), 'utf8')
        fs.writeFileSync(path.resolve(fdParam, 'sig.json'), JSON.stringify(buildArrSig()), 'utf8')
        return { fdOhlc, fdParam }
    }

    it('讀取數據執行多策略, 回傳name為全部策略之合併結果並輸出orders.json/summary.json/report.html', async function() {
        let { fdOhlc, fdParam } = buildFdData('rsab-all')
        let fdTest = path.resolve(fdTmp, 'rsab-all', 'result')

        let r = await runStrategiesAndBacktest(ott, fdOhlc, fdParam, strategies, t00, t20, fdTest)

        //r, 同runStrategies之合併結果(s1兩單, s2四單, 依timeStart排序)另附name
        assert.strictEqual(r.name, '全部策略')
        assert.strictEqual(r.orders.length, 6)
        assert.deepStrictEqual(r.orders.map((o) => o.sid), ['s1', 's2', 's1', 's2', 's2', 's2'])
        assert.strictEqual(r.summary.uIni, 2000)
        assert.strictEqual(r.summary.timeOhlcStart, t00)
        assert.strictEqual(r.summary.timeOhlcEnd, t20)
        assert.strictEqual(r.summary.numTrade, 6)
        assert.strictEqual(r.summary.numTradeUnsettled, 1)
        assert.strictEqual(r.summary.rWin, '40.00%')

        //orders.json
        let orders = JSON.parse(fs.readFileSync(path.resolve(fdTest, 'orders.json'), 'utf8'))
        assert.strictEqual(orders.length, 6)
        assert.strictEqual(orders[0].sid, 's1')
        assert.strictEqual(orders[0].timeStart, t00)

        //summary.json
        let stsm = JSON.parse(fs.readFileSync(path.resolve(fdTest, 'summary.json'), 'utf8'))
        assert.strictEqual(stsm.name, '全部策略')
        assert.strictEqual(stsm.summary.numTrade, 6)
        assert.strictEqual(stsm.summary.rWin, '40.00%')

        //report.html, 已置換name與orders
        let fpHtml = path.resolve(fdTest, 'report.html')
        assert.ok(fs.existsSync(fpHtml))
        let h = fs.readFileSync(fpHtml, 'utf8')
        assert.ok(h.includes('全部策略'))
        assert.ok(!h.includes('{orders}'))
        assert.ok(!h.includes('{summary}'))
    })

    it('writeOrders/writeSummary/writeReport皆false時不輸出檔案, 仍回傳結果', async function() {
        let { fdOhlc, fdParam } = buildFdData('rsab-nowrite')
        let fdTest = path.resolve(fdTmp, 'rsab-nowrite', 'result')

        let r = await runStrategiesAndBacktest(ott, fdOhlc, fdParam, strategies, t00, t20, fdTest, {
            writeOrders: false,
            writeSummary: false,
            writeReport: false,
        })

        assert.strictEqual(r.orders.length, 6)
        assert.ok(!fs.existsSync(path.resolve(fdTest, 'orders.json')))
        assert.ok(!fs.existsSync(path.resolve(fdTest, 'summary.json')))
        assert.ok(!fs.existsSync(path.resolve(fdTest, 'report.html')))
    })

    it('fdOhlc非資料夾時reject', async function() {
        let { fdParam } = buildFdData('rsab-invalid')
        let fdOhlc = path.resolve(fdTmp, 'rsab-invalid', 'none')
        let fdTest = path.resolve(fdTmp, 'rsab-invalid', 'result')
        await assert.rejects(runStrategiesAndBacktest(ott, fdOhlc, fdParam, strategies, t00, t20, fdTest), { message: `fdOhlc[${fdOhlc}] is not a forder` })
    })

    it('fdParam非資料夾時reject', async function() {
        let { fdOhlc } = buildFdData('rsab-invalid2')
        let fdParam = path.resolve(fdTmp, 'rsab-invalid2', 'none')
        let fdTest = path.resolve(fdTmp, 'rsab-invalid2', 'result')
        await assert.rejects(runStrategiesAndBacktest(ott, fdOhlc, fdParam, strategies, t00, t20, fdTest), { message: `fdParam[${fdParam}] is not a forder` })
    })

    it('strategies非有效陣列時reject', async function() {
        let { fdOhlc, fdParam } = buildFdData('rsab-nostrategies')
        let fdTest = path.resolve(fdTmp, 'rsab-nostrategies', 'result')
        await assert.rejects(runStrategiesAndBacktest(ott, fdOhlc, fdParam, [], t00, t20, fdTest), { message: `invalid strategies` })
    })

})
