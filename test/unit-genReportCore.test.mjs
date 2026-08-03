import assert from 'assert'
import fs from 'fs'
import path from 'path'
import calcOrders from '../src/calcOrders.mjs'
import calcOrdersRatio from '../src/calcOrdersRatio.mjs'
import calcOrdersSummary from '../src/calcOrdersSummary.mjs'
import genReportCore from '../src/genReportCore.mjs'
import ott from '../src/ott.mjs'
import { t00, t20, buildArrOhlc, buildOrders, buildFdTmp } from './unit-setup.mjs'


//規格來源: src/genReportCore.mjs
//  genReportCore(r, fpOut): 讀取src內tmp.html與render*.js模板, 置換{name}/{orders}/{summary}後寫出html


let fdTmp = buildFdTmp('genReportCore')


describe('genReportCore', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('置換模板{name}/{orders}/{summary}後寫出html', async function() {
        let orders = await calcOrders(buildArrOhlc(), buildOrders(), { uIni: 1000 })
        orders = calcOrdersRatio(ott, orders)
        let summary = calcOrdersSummary(ott, 1000, orders, t00, t20)
        let fpOut = path.resolve(fdTmp, 'report.html')
        genReportCore({ name: '單元測試報告', orders, summary }, fpOut)
        assert.ok(fs.existsSync(fpOut))
        let h = fs.readFileSync(fpOut, 'utf8')
        assert.ok(h.includes('單元測試報告'))
        assert.ok(!h.includes('{orders}'))
        assert.ok(!h.includes('{summary}'))
        assert.ok(h.includes(t00)) //orders已注入
    })

})
