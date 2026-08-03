import assert from 'assert'
import fs from 'fs'
import path from 'path'
import buildKLinesTpSl from '../src/buildKLinesTpSl.mjs'
import calcOrders from '../src/calcOrders.mjs'
import loadKLinesTpSl from '../src/loadKLinesTpSl.mjs'
import { approx, t00, t04, t08, t12, t16, t20, buildArrOhlc, buildOrder, buildFdTmp } from './unit-setup.mjs'


//規格來源: src/loadKLinesTpSl.mjs
//  loadKLinesTpSl(fpJson): 載入快取回傳{meta,bars,ordersFromBars}, ordersFromBars(mode,tpsl,entryTimes,opt)依快取重建訂單陣列,
//    opt含uTrade/uIni/rFee/maxExitTime/skipSort, 盈虧與累計欄位公式對齊calcOrders, 未結單各盈虧欄位留空


let fdTmp = buildFdTmp('loadKLinesTpSl')


describe('loadKLinesTpSl', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    //buildCache: 產一份long/short各tpsl=5之快取檔, 回傳其路徑
    let buildCache = async (fd) => {
        let fdOhlc = path.resolve(fdTmp, fd, 'data-ohlc')
        let fdParam = path.resolve(fdTmp, fd, 'data-param')
        fs.mkdirSync(fdOhlc, { recursive: true })
        fs.mkdirSync(fdParam, { recursive: true })
        fs.writeFileSync(path.resolve(fdOhlc, 'btc.json'), JSON.stringify(buildArrOhlc()), 'utf8')
        let fpJson = path.resolve(fdTmp, fd, 'kltpsl.json')
        await buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'btc', ts: t00, te: t20, tps: [5], modes: ['long', 'short'] })
        return fpJson
    }

    it('回傳meta與bars, ordersFromBars重建已結單各欄位與累計值', async function() {
        let fpJson = await buildCache('lkts-basic')
        let r = loadKLinesTpSl(fpJson)

        //meta與bars
        assert.strictEqual(r.meta.nBars, 6)
        assert.strictEqual(r.bars[t00].close, 100)

        //ordersFromBars, t00與t16皆止盈
        let orders = r.ordersFromBars('long', 5, [t00, t16], { uTrade: 100, uIni: 1000 })
        assert.strictEqual(orders.length, 2)

        let o0 = orders[0]
        assert.strictEqual(o0.mode, 'long')
        assert.strictEqual(o0.timeStart, t00)
        assert.strictEqual(o0.priceStart, 100)
        assert.strictEqual(o0.priceTakeProfit, 105) //(1+0.05)*100
        assert.strictEqual(o0.priceStopLoss, 95) //(1-0.05)*100
        assert.strictEqual(o0.timeEnd, t04)
        assert.strictEqual(o0.priceEnd, 105)
        assert.strictEqual(o0.modeResult, 'profit')
        assert.strictEqual(o0.uFee, 0.05) //rFee=0.0005, uTrade=100
        assert.ok(approx(o0.uProfitOrLoss, 4.9), `uProfitOrLoss=${o0.uProfitOrLoss}`) //100*(105/100)-100-2*0.05
        assert.ok(approx(o0.rProfitOrLoss, 0.049), `rProfitOrLoss=${o0.rProfitOrLoss}`)
        assert.ok(approx(o0.uEquity, 1004.9), `uEquity=${o0.uEquity}`)
        assert.strictEqual(o0.rCumuProfitOrLoss, '0.49%')

        //累計跨單累加
        let o1 = orders[1]
        assert.strictEqual(o1.timeStart, t16)
        assert.strictEqual(o1.timeEnd, t20)
        assert.ok(approx(o1.uCumuProfitOrLoss, 9.8), `uCumuProfitOrLoss=${o1.uCumuProfitOrLoss}`)
        assert.ok(approx(o1.uEquity, 1009.8), `uEquity=${o1.uEquity}`)
        assert.strictEqual(o1.rCumuProfitOrLoss, '0.98%')
    })

    it('未結單各盈虧欄位留空, 且不影響其後已結單累計', async function() {
        let fpJson = await buildCache('lkts-unsettled')
        let r = loadKLinesTpSl(fpJson)

        //t12為未結(win=-1)
        let orders = r.ordersFromBars('long', 5, [t00, t12], { uTrade: 100, uIni: 1000 })
        let o1 = orders[1]
        assert.strictEqual(o1.timeStart, t12)
        assert.strictEqual(o1.timeEnd, '')
        assert.strictEqual(o1.priceEnd, '')
        assert.strictEqual(o1.modeResult, '')
        assert.strictEqual(o1.uProfitOrLoss, '')
        assert.strictEqual(o1.uEquity, '')
    })

    it('entryTimes未排序時自動升序, skipSort:true則維持原順序', async function() {
        let fpJson = await buildCache('lkts-sort')
        let r = loadKLinesTpSl(fpJson)

        let orders = r.ordersFromBars('long', 5, [t16, t00], { uTrade: 100, uIni: 1000 })
        assert.deepStrictEqual(orders.map((o) => o.timeStart), [t00, t16])

        let ordersSkip = r.ordersFromBars('long', 5, [t16, t00], { uTrade: 100, uIni: 1000, skipSort: true })
        assert.deepStrictEqual(ordersSkip.map((o) => o.timeStart), [t16, t00])
    })

    it('maxExitTime時出場時間大於等於它之單視為未平倉', async function() {
        let fpJson = await buildCache('lkts-maxexit')
        let r = loadKLinesTpSl(fpJson)

        //t00單出場於t04, maxExitTime給t04則視為未平倉
        let orders = r.ordersFromBars('long', 5, [t00], { uTrade: 100, uIni: 1000, maxExitTime: t04 })
        assert.strictEqual(orders[0].timeEnd, '')
        assert.strictEqual(orders[0].modeResult, '')

        //maxExitTime給t08則正常結算
        let orders2 = r.ordersFromBars('long', 5, [t00], { uTrade: 100, uIni: 1000, maxExitTime: t08 })
        assert.strictEqual(orders2[0].timeEnd, t04)
        assert.strictEqual(orders2[0].modeResult, 'profit')
    })

    it('快取內查無之進場時間會被濾除, opt未給時uTrade為1且rFee為0.0005', async function() {
        let fpJson = await buildCache('lkts-filter')
        let r = loadKLinesTpSl(fpJson)

        let orders = r.ordersFromBars('long', 5, ['1999-01-01T00:00:00', t00])
        assert.strictEqual(orders.length, 1)
        assert.strictEqual(orders[0].timeStart, t00)
        assert.strictEqual(orders[0].uTrade, 1)
        assert.strictEqual(orders[0].rFee, 0.0005)
        assert.ok(approx(orders[0].uFee, 0.0005), `uFee=${orders[0].uFee}`)
    })

    it('已結單盈虧與累計欄位與calcOrders逐欄一致', async function() {
        let fpJson = await buildCache('lkts-samewith-calcorders')
        let r = loadKLinesTpSl(fpJson)

        //ordersFromBars, t00(止盈於t04)與t16(止盈於t20)
        let orders = r.ordersFromBars('long', 5, [t00, t16], { uTrade: 100, uIni: 1000 })

        //calcOrders, 以相同進場價與止盈止損價下單
        let ordersSubmit = [
            buildOrder('long', t00, 100, 105, 95),
            buildOrder('long', t16, 93, 97.65, 88.35),
        ]
        let ordersCalc = await calcOrders(buildArrOhlc(), ordersSubmit, { uIni: 1000 })

        let keys = ['timeStart', 'timeEnd', 'priceStart', 'priceEnd', 'modeResult', 'uProfitOrLoss', 'rProfitOrLoss', 'uCumuProfitOrLoss', 'rCumuProfitOrLoss', 'uEquity']
        for (let i = 0; i < 2; i++) {
            for (let k of keys) {
                if (typeof ordersCalc[i][k] === 'number') {
                    assert.ok(approx(orders[i][k], ordersCalc[i][k]), `orders[${i}].${k}=${orders[i][k]}, ordersCalc[${i}].${k}=${ordersCalc[i][k]}`)
                }
                else {
                    assert.strictEqual(orders[i][k], ordersCalc[i][k], `orders[${i}].${k}`)
                }
            }
        }
    })

    it('fpJson非有效字串或非檔案時throw', function() {
        let fp = path.resolve(fdTmp, 'lkts-none', 'kltpsl.json')
        assert.throws(() => loadKLinesTpSl(''), { message: `invalid fpJson` })
        assert.throws(() => loadKLinesTpSl(fp), { message: `fpJson[${fp}] is not a file` })
    })

})
