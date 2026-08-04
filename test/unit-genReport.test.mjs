import assert from 'assert'
import fs from 'fs'
import path from 'path'
import fsWriteJson from 'wsemi/src/fsWriteJson.mjs'
import calcOrders from '../src/calcOrders.mjs'
import genReport from '../src/genReport.mjs'
import ott from '../src/ott.mjs'
import { approx, t00, t16, t20, buildArrOhlc, buildOrders, buildFdTmp } from './unit-setup.mjs'


//規格來源: src/genReport.mjs
//  genReport(ott, fpOrders, opt): 讀orders.json後calcSummary+genReportCore產出html, 回傳{orders,summary,fpOut};
//    opt.fpOut預設同資料夾report.html, opt.name預設所在資料夾名, opt.uIni預設由首筆已結算單推回(uEquity-uCumuProfitOrLoss),
//    opt.timeOhlcStart/timeOhlcEnd預設由訂單起訖推得, opt.withWriteSummary:true另輸出summary.json


let fdTmp = buildFdTmp('genReport')


describe('genReport', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    //writeSettledOrders: 將已結算訂單寫至`${fdTmp}/${fd}/orders.json`並回傳其路徑
    let writeSettledOrders = async (fd) => {
        let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
        let fpOrders = path.resolve(fdTmp, fd, 'orders.json')
        fsWriteJson(fpOrders, orders)
        return fpOrders
    }

    it('預設輸出同資料夾report.html, name取所在資料夾名, uIni由首筆已結算單推回', async function() {
        let fpOrders = await writeSettledOrders('gr-default')

        let r = await genReport(ott, fpOrders)

        //fpOut
        assert.strictEqual(r.fpOut, path.resolve(fdTmp, 'gr-default', 'report.html'))
        assert.ok(fs.existsSync(r.fpOut))

        //orders
        assert.strictEqual(r.orders.length, 4)

        //summary, uIni由首筆已結算單推回(1004.9-4.9=1000), 統計區間由訂單起訖推得(t00至未平倉D單之timeStart=t16)
        assert.strictEqual(r.summary.uIni, 1000)
        assert.strictEqual(r.summary.timeOhlcStart, t00)
        assert.strictEqual(r.summary.timeOhlcEnd, t16)
        assert.strictEqual(r.summary.numTrade, 4)
        assert.strictEqual(r.summary.numTradeUnsettled, 1)
        assert.strictEqual(r.summary.rWin, '66.67%')
        assert.ok(approx(r.summary.uEquityFinal, 1006.7), `uEquityFinal=${r.summary.uEquityFinal}`)

        //html已置換name與orders
        let h = fs.readFileSync(r.fpOut, 'utf8')
        assert.ok(h.includes('gr-default'))
        assert.ok(!h.includes('{orders}'))
        assert.ok(!h.includes('{summary}'))
    })

    it('opt指定fpOut/name/uIni/timeOhlcStart/timeOhlcEnd, withWriteSummary另輸出summary.json', async function() {
        let fpOrders = await writeSettledOrders('gr-opt')
        let fpOut = path.resolve(fdTmp, 'gr-opt-out', 'rpt.html')

        let r = await genReport(ott, fpOrders, {
            fpOut,
            name: '指定報表名',
            uIni: 2000,
            timeOhlcStart: t00,
            timeOhlcEnd: t20,
            withWriteSummary: true,
        })

        //fpOut
        assert.strictEqual(r.fpOut, fpOut)
        assert.ok(fs.existsSync(fpOut))
        assert.ok(fs.readFileSync(fpOut, 'utf8').includes('指定報表名'))

        //summary
        assert.strictEqual(r.summary.uIni, 2000)
        assert.strictEqual(r.summary.timeOhlcStart, t00)
        assert.strictEqual(r.summary.timeOhlcEnd, t20)

        //summary.json, 與fpOut同資料夾, 內含name與summary
        let fpSummary = path.resolve(fdTmp, 'gr-opt-out', 'summary.json')
        let stsm = JSON.parse(fs.readFileSync(fpSummary, 'utf8'))
        assert.strictEqual(stsm.name, '指定報表名')
        assert.strictEqual(stsm.summary.numTrade, 4)
    })

    it('withWriteSummary預設false, 不輸出summary.json', async function() {
        let fpOrders = await writeSettledOrders('gr-nosummary')
        await genReport(ott, fpOrders)
        assert.ok(!fs.existsSync(path.resolve(fdTmp, 'gr-nosummary', 'summary.json')))
    })

    it('fpOrders非有效字串時reject', async function() {
        await assert.rejects(genReport(ott, ''), { message: `invalid fpOrders` })
    })

    it('fpOrders非檔案時reject', async function() {
        let fp = path.resolve(fdTmp, 'gr-none', 'orders.json')
        await assert.rejects(genReport(ott, fp), { message: `fpOrders[${fp}] is not a file` })
    })

    it('orders.json內容非有效陣列時reject', async function() {
        let fp = path.resolve(fdTmp, 'gr-invalid', 'orders.json')
        fsWriteJson(fp, [])
        await assert.rejects(genReport(ott, fp), { message: `orders in fpOrders[${fp}] is not an effective array` })
    })

})
