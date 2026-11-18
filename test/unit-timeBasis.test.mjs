import assert from 'assert'
import fs from 'fs'
import path from 'path'
import dig from 'wsemi/src/dig.mjs'
import runStrategy from '../src/runStrategy.mjs'
import runStrategies from '../src/runStrategies.mjs'
import buildStrategyFastSession from '../src/buildStrategyFastSession.mjs'
import buildKLinesTpSl from '../src/buildKLinesTpSl.mjs'
import loadKLinesTpSl from '../src/loadKLinesTpSl.mjs'
import calcOrders from '../src/calcOrders.mjs'
import calcOrdersRatio from '../src/calcOrdersRatio.mjs'
import calcOrdersSummary from '../src/calcOrdersSummary.mjs'
import calcOrdersSummarySimple from '../src/calcOrdersSummarySimple.mjs'
import calcSummary from '../src/calcSummary.mjs'
import closeAndSummaryOrders from '../src/closeAndSummaryOrders.mjs'
import genReport from '../src/genReport.mjs'
import ott from '../src/ott.mjs'
import { approx, mulberry32, buildTimes, genRandomCase, buildFdTmp } from './unit-setup.mjs'


//規格來源: 規則帳本R-BT-01 ~ R-BT-07(每根時長intervalSec與時間口徑timeBasis)、R-SUM-01、R-FAST-01
//  R-BT-02: 未給timeBasis或為'open'時(含只給intervalSec, 任何週期)各入口之輸出與未給選項時逐位相同
//  R-BT-03: timeBasis為'span'時各已平倉單dayHold = max(1, ceil(進場棒收盤至出場棒收盤之時長/1日)), rProfitOrLossDay = (1+r)^(1/dayHold)-1, rSharpe算式與sqrt(252)不變
//  R-BT-04: timeBasis為'span'時btDays = 首根開盤至末根收盤(末根開盤+intervalSec)之整日數(截斷), btYears、年化、等效年化隨之; 其餘摘要欄位不變
//  R-BT-05: 各入口之傳遞(runStrategy與快速評估之settings、runStrategies各策略settings須相同並先於執行預檢、calcSummary/genReport/closeAndSummaryOrders之opt)
//  R-BT-06: closeAndSummaryOrders之區間檢查(給intervalSec為毫秒差之整數倍, 未給為截斷時數之4倍數), 訊息不含輸入值
//  合成資料: 隨機漫步K線(各棒價格相異)、因子逐棒隨機, 時間標籤依各週期產生(unit-setup之genRandomCase)


let fdTmp = buildFdTmp('timeBasis')
let MS_DAY = 86400000
let DESC = 'a positive integer multiple of 60 up to 31536000'

//週期之情境: 每根秒數與首根時刻(日線另含開盤不在0點者; 1分線跨午夜與閏日; 週線)
let scenes = [
    { name: '1day', stepSec: 86400, timeStart: '2020-01-01T00:00:00' },
    { name: '1day@08:00', stepSec: 86400, timeStart: '2020-01-01T08:00:00' },
    { name: '4hr', stepSec: 14400, timeStart: '2020-01-01T00:00:00' },
    { name: '1hr', stepSec: 3600, timeStart: '2020-01-01T00:00:00' },
    { name: '1m', stepSec: 60, timeStart: '2024-02-29T23:40:00' },
    { name: '1w', stepSec: 604800, timeStart: '2024-01-01T00:00:00' },
]

//msOf, 標籤(Asia/Taipei, 無日光節約)之經過毫秒以UTC解析計(獨立於dayjs)
let msOf = (t) => Date.parse(`${t}Z`)

//dayHoldSpanRef, R-BT-03之獨立計算
let dayHoldSpanRef = (ts, te) => Math.max(1, Math.ceil((msOf(te) - msOf(ts)) / MS_DAY))

//dayHoldOpenRef, 現行(曆日差+1)之獨立計算
let dayHoldOpenRef = (ts, te) => Math.round((msOf(te.slice(0, 10) + 'T00:00:00') - msOf(ts.slice(0, 10) + 'T00:00:00')) / MS_DAY) + 1

//btDaysSpanRef, R-BT-04之獨立計算
let btDaysSpanRef = (ts, te, sec) => Math.trunc((msOf(te) + sec * 1000 - msOf(ts)) / MS_DAY)
let btDaysOpenRef = (ts, te) => Math.trunc((msOf(te) - msOf(ts)) / MS_DAY)

//sharpeRef, calcOrdersSummary之夏普值定義(dayHold加權, sqrt(252), 截於[-10,10])之獨立計算, 依timeStart序加總
let sharpeRef = (fins) => {
    let rrW = 0
    let rrD = 0
    for (let o of fins) {
        rrW += o.rDay * o.d
        rrD += o.d
    }
    let avg = rrD > 0 ? rrW / rrD : 0
    let rtW = 0
    for (let o of fins) {
        rtW += o.d * (o.rDay - avg) * (o.rDay - avg)
    }
    let std = rrD > 1 ? Math.sqrt(rtW / (rrD - 1)) : 0
    let s = std > 0 ? (avg / std) * Math.sqrt(252) : 0
    return Math.min(Math.max(s, -10), 10)
}

//omitTime
let omitTime = (s) => {
    let o = { ...s }
    delete o.timeTest
    return o
}

//mkFgs, 序列查詢函數(可計次)
let mkFgs = (cs, counter = { n: 0 }) => {
    return async (key) => {
        counter.n++
        if (key === 'ohlc') {
            return cs.arrOhlc
        }
        if (cs.serieses[key]) {
            return cs.serieses[key]
        }
        throw new Error(`invalid key[${key}]`)
    }
}

//mkStrategy
let mkStrategy = (cs, extra = {}) => {
    return {
        mode: cs.mode,
        keyOhlc: 'ohlc',
        conds: cs.conds,
        settings: { uIni: 1000, uTrade: 100, rTakeProfit: cs.tp, rStopLoss: cs.sl, rFee: 0.0005, ...extra },
    }
}

//genCases, 各情境之隨機案(各棒時間依情境)
let genCases = (scene, n, seed0) => {
    let cases = []
    for (let i = 0; i < n; i++) {
        let rng = mulberry32(seed0 + i * 7919)
        cases.push(genRandomCase(rng, { stepSec: scene.stepSec, timeStart: scene.timeStart }))
    }
    return cases
}

//keysSimple, 精簡摘要之全部欄位
let keysSimple = ['numTrade', 'numTradeFin', 'rWin', 'uTradeAllMax', 'rTradeAllMax', 'uEquityFinal', 'btDays', 'btYears', 'rEquivalentCumuProfitOrLossFinalNormYear', 'timeOhlcStart', 'timeOhlcEnd']

//keysChanged, span會改變之摘要欄位(R-BT-03、R-BT-04)
let keysChanged = ['btDays', 'btYears', 'rCumuProfitOrLossFinalNormYear', 'rEquivalentCumuProfitOrLossFinalNormYear', 'rSharpe']


describe('timeBasis與intervalSec', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    describe('R-BT-02: 未開span時(含只給intervalSec, 任何週期)各入口之輸出與未給選項逐位相同', function() {

        for (let scene of scenes) {
            it(`${scene.name}: runStrategy、快速評估、calcOrdersRatio、calcOrdersSummary、calcOrdersSummarySimple、calcSummary、runStrategies`, async function() {
                this.timeout(60000)
                let cases = genCases(scene, 12, 4100)
                let bts = [{ intervalSec: scene.stepSec }, { intervalSec: String(scene.stepSec), timeBasis: 'open' }, { intervalSec: 14400, timeBasis: null }]
                let nOrders = 0
                let nSpanDiff = 0
                for (let cs of cases) {
                    let r0 = await runStrategy(ott, mkStrategy(cs), mkFgs(cs))
                    nOrders += r0.orders.length
                    //鑑別前提: 同一資料下'span'與'open'至少一處不同(使「只給intervalSec不變」之斷言有意義)
                    let rS = await runStrategy(ott, mkStrategy(cs, { intervalSec: scene.stepSec, timeBasis: 'span' }), mkFgs(cs))
                    if (JSON.stringify(rS.orders) !== JSON.stringify(r0.orders) || JSON.stringify(omitTime(rS.summary)) !== JSON.stringify(omitTime(r0.summary))) {
                        nSpanDiff++
                    }
                    let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
                    let input = { conds: cs.conds, tp: cs.tp, sl: cs.sl, settings: { uIni: 1000, uTrade: 100, rFee: 0.0005 } }
                    let f0 = sess.evaluate(input, { withOrders: true })
                    let ts = cs.arrOhlc[0].time
                    let te = cs.arrOhlc[cs.arrOhlc.length - 1].time
                    for (let bt of bts) {
                        //runStrategy之settings
                        let r1 = await runStrategy(ott, mkStrategy(cs, bt), mkFgs(cs))
                        assert.deepStrictEqual(r1.orders, r0.orders)
                        assert.deepStrictEqual(omitTime(r1.summary), omitTime(r0.summary))
                        //快速評估之settings
                        let f1 = sess.evaluate({ ...input, settings: { ...input.settings, ...bt } }, { withOrders: true })
                        assert.deepStrictEqual(f1, f0)
                        //函數層之opt
                        let oA = calcOrdersRatio(ott, await calcOrders(cs.arrOhlc, r0.orders.map((o) => ({ ...o, timeEnd: '', priceEnd: '', modeResult: '' })), { uIni: 1000 }))
                        let oB = calcOrdersRatio(ott, await calcOrders(cs.arrOhlc, r0.orders.map((o) => ({ ...o, timeEnd: '', priceEnd: '', modeResult: '' })), { uIni: 1000 }), bt)
                        assert.deepStrictEqual(oB, oA)
                        assert.deepStrictEqual(calcOrdersSummary(ott, 1000, oB, ts, te, bt), calcOrdersSummary(ott, 1000, oA, ts, te))
                        assert.deepStrictEqual(calcOrdersSummarySimple(ott, 1000, oB, ts, te, bt), calcOrdersSummarySimple(ott, 1000, oA, ts, te))
                        assert.deepStrictEqual(omitTime(await calcSummary(ott, 1000, oB, ts, te, bt)), omitTime(await calcSummary(ott, 1000, oA, ts, te)))
                    }
                    //runStrategies: 各策略皆給同一intervalSec
                    let mkSts = (bt) => [
                        { sid: 'a', ...mkStrategy(cs, bt) },
                        { sid: 'b', ...mkStrategy(cs, bt), mode: cs.mode === 'long' ? 'short' : 'long' },
                    ]
                    let ss0 = await runStrategies(ott, mkSts({}), mkFgs(cs))
                    let ss1 = await runStrategies(ott, mkSts({ intervalSec: scene.stepSec }), mkFgs(cs))
                    assert.deepStrictEqual(ss1.orders, ss0.orders)
                    assert.deepStrictEqual(omitTime(ss1.summary), omitTime(ss0.summary))
                }
                //鑑別前提: 有訂單可比, 且span確實會改變輸出
                assert.ok(nOrders >= 50, `nOrders=${nOrders}`)
                assert.ok(nSpanDiff >= 1, `nSpanDiff=${nSpanDiff}`)
            })
        }

    })

    describe('R-BT-03、R-BT-04: timeBasis為span時之持倉天數、回測天數與其衍生欄位', function() {

        for (let scene of scenes) {
            it(`${scene.name}: runStrategy之訂單與摘要等於以定義獨立計算之值, 其餘欄位不變`, async function() {
                this.timeout(60000)
                let cases = genCases(scene, 16, 7300)
                let nFin = 0
                let nDayHoldDiff = 0
                let nDayHoldSame = 0
                let nBtDiff = 0
                for (let cs of cases) {
                    let bt = { intervalSec: scene.stepSec, timeBasis: 'span' }
                    let r0 = await runStrategy(ott, mkStrategy(cs), mkFgs(cs))
                    let r1 = await runStrategy(ott, mkStrategy(cs, bt), mkFgs(cs))
                    let idx = new Map(cs.arrOhlc.map((v, i) => [v.time, i]))

                    //訂單: 只有dayHold與rProfitOrLossDay改變(R-BT-03)
                    assert.strictEqual(r1.orders.length, r0.orders.length)
                    let fins = []
                    for (let k = 0; k < r1.orders.length; k++) {
                        let o1 = r1.orders[k]
                        let o0 = r0.orders[k]
                        let { dayHold: d1, rProfitOrLossDay: q1, ...rest1 } = o1
                        let { dayHold: d0, rProfitOrLossDay: q0, ...rest0 } = o0
                        assert.deepStrictEqual(rest1, rest0)
                        if (o1.modeResult === '') {
                            assert.strictEqual(d1, undefined)
                            continue
                        }
                        nFin++
                        let dRef = dayHoldSpanRef(o1.timeStart, o1.timeEnd)
                        assert.strictEqual(d1, dRef, `${o1.timeStart}->${o1.timeEnd}`)
                        if (scene.stepSec >= 86400) {
                            //日線(與更長): 持k根即k×每根日數
                            let kBars = idx.get(o1.timeEnd) - idx.get(o1.timeStart)
                            assert.strictEqual(d1, kBars * scene.stepSec / 86400)
                        }
                        let qRef = (1 + o1.rProfitOrLoss) >= 0 ? Math.pow(1 + o1.rProfitOrLoss, 1 / dRef) - 1 : 0
                        assert.strictEqual(q1, qRef)
                        //現行(open)之值亦依其定義(鑑別用)
                        assert.strictEqual(d0, dayHoldOpenRef(o0.timeStart, o0.timeEnd))
                        if (d1 !== d0) {
                            nDayHoldDiff++
                        }
                        else {
                            nDayHoldSame++
                        }
                        fins.push({ rDay: qRef, d: dRef })
                    }

                    //摘要(R-BT-04): btDays計至末根收盤, btYears、年化、等效年化隨之, 夏普值依span之dayHold且年化因子sqrt(252)
                    let sm1 = r1.summary
                    let sm0 = r0.summary
                    let ts = cs.arrOhlc[0].time
                    let te = cs.arrOhlc[cs.arrOhlc.length - 1].time
                    let btDays = btDaysSpanRef(ts, te, scene.stepSec)
                    assert.strictEqual(sm1.btDays, btDays)
                    assert.strictEqual(sm0.btDays, btDaysOpenRef(ts, te))
                    if (sm1.btDays !== sm0.btDays) {
                        nBtDiff++
                    }
                    let btYears = btDays / 365
                    assert.strictEqual(sm1.btYears, dig(btYears, 1))
                    let vY = (btYears === 0) ? 0 : (sm1.uEquityFinal - 1000) / 1000 / btYears
                    assert.strictEqual(sm1.rCumuProfitOrLossFinalNormYear, `${dig(vY * 100, 2)}%`)
                    let vE = (sm1.uTradeAllMax === 0 || btYears === 0) ? 0 : (sm1.uEquityFinal - 1000) / sm1.uTradeAllMax / btYears
                    assert.strictEqual(sm1.rEquivalentCumuProfitOrLossFinalNormYear, `${dig(vE * 100, 2)}%`)
                    assert.ok(approx(sm1.rSharpe, sharpeRef(fins), 1e-9), `rSharpe=${sm1.rSharpe} ref=${sharpeRef(fins)}`)
                    //其餘欄位不變
                    let rest1 = { ...omitTime(sm1) }
                    let rest0 = { ...omitTime(sm0) }
                    for (let k of keysChanged) {
                        delete rest1[k]
                        delete rest0[k]
                    }
                    assert.deepStrictEqual(rest1, rest0)
                }
                //鑑別前提: 有足量已平倉單; 日線之dayHold必與現行不同, 日內兩種皆有; 日線之btDays必與現行不同
                assert.ok(nFin >= 60, `nFin=${nFin}`)
                assert.ok(nDayHoldDiff >= 5, `nDayHoldDiff=${nDayHoldDiff}`) //1分線之情境只有跨午夜之單不同(約9單), 故門檻取5
                if (scene.stepSec >= 86400 && scene.timeStart.endsWith('T00:00:00')) {
                    assert.strictEqual(nDayHoldSame, 0)
                    assert.strictEqual(nBtDiff, cases.length)
                }
                if (scene.stepSec < 86400) {
                    assert.ok(nDayHoldSame >= 10, `nDayHoldSame=${nDayHoldSame}`)
                }
            })
        }

        it('4hr: 末根與首根時刻差為20小時之窗btDays多1日, 否則不變(截斷)', async function() {
            let rng = mulberry32(99)
            let cs = genRandomCase(rng, { stepSec: 14400 })
            let n = cs.arrOhlc.length
            let found = { diff: 0, same: 0 }
            for (let m = 12; m <= n; m++) {
                let ts = cs.arrOhlc[0].time
                let te = cs.arrOhlc[m - 1].time
                let a = calcOrdersSummarySimple(ott, 1000, [], ts, te, { intervalSec: 14400, timeBasis: 'span' })
                let b = calcOrdersSummarySimple(ott, 1000, [], ts, te)
                let hourDiff = (msOf(te) - msOf(ts)) / 3600000 % 24
                if (hourDiff === 20) {
                    assert.strictEqual(a.btDays, b.btDays + 1, `${ts}->${te}`)
                    found.diff++
                }
                else {
                    assert.strictEqual(a.btDays, b.btDays, `${ts}->${te}`)
                    found.same++
                }
            }
            assert.ok(found.diff >= 2 && found.same >= 10, JSON.stringify(found))
        })

        it('calcOrdersRatio: 日線次根出場為1日(現行2日), 4hr當日最後一根進場次根出場為1日, 28小時為2日', function() {
            let mk = (ts, te, r) => ({ modeResult: 'profit', timeStart: ts, timeEnd: te, rProfitOrLoss: r })
            let os = calcOrdersRatio(ott, [
                mk('2020-01-01T00:00:00', '2020-01-02T00:00:00', 0.05),
                mk('2020-01-01T20:00:00', '2020-01-02T00:00:00', 0.03),
                mk('2020-01-01T08:00:00', '2020-01-02T12:00:00', 0.21),
                { modeResult: '', timeStart: '2020-01-01T00:00:00', timeEnd: '', rProfitOrLoss: '' },
            ], { intervalSec: 86400, timeBasis: 'span' })
            assert.deepStrictEqual(os.map((o) => o.dayHold), [1, 1, 2, undefined])
            assert.strictEqual(os[0].rProfitOrLossDay, Math.pow(1.05, 1) - 1)
            assert.strictEqual(os[2].rProfitOrLossDay, Math.pow(1.21, 1 / 2) - 1)
            let os0 = calcOrdersRatio(ott, [mk('2020-01-01T00:00:00', '2020-01-02T00:00:00', 0.05)], { intervalSec: 86400 })
            assert.strictEqual(os0[0].dayHold, 2) //只給intervalSec維持現行
        })

        it('有缺根之日線: span之dayHold為經過之日數而非根數, btDays含缺口', async function() {
            //R-BT-03: 為經過之時長而非根數; R-BT-04: 首根開盤至末根收盤
            let nFin = 0
            let nGapOrders = 0
            for (let i = 0; i < 8; i++) {
                let rng = mulberry32(6100 + i * 7919)
                let cs = genRandomCase(rng, { stepSec: 86400 })
                //每3根刪1根(首末根保留), 因子序列同步刪除
                let n = cs.arrOhlc.length
                let keep = new Set(cs.arrOhlc.filter((v, k) => k === 0 || k === n - 1 || k % 3 !== 1).map((v) => v.time))
                cs.arrOhlc = cs.arrOhlc.filter((v) => keep.has(v.time))
                for (let key of Object.keys(cs.serieses)) {
                    cs.serieses[key] = cs.serieses[key].filter((v) => keep.has(v.time))
                }
                let idx = new Map(cs.arrOhlc.map((v, k) => [v.time, k]))
                let r = await runStrategy(ott, mkStrategy(cs, { intervalSec: 86400, timeBasis: 'span' }), mkFgs(cs))
                for (let o of r.orders.filter((o) => o.modeResult !== '')) {
                    nFin++
                    let dRef = dayHoldSpanRef(o.timeStart, o.timeEnd)
                    assert.strictEqual(o.dayHold, dRef, `${o.timeStart}->${o.timeEnd}`)
                    if (dRef !== idx.get(o.timeEnd) - idx.get(o.timeStart)) {
                        nGapOrders++ //經過日數與根數不同之單
                    }
                }
                let ts = cs.arrOhlc[0].time
                let te = cs.arrOhlc[cs.arrOhlc.length - 1].time
                assert.strictEqual(r.summary.btDays, btDaysSpanRef(ts, te, 86400))
            }
            //鑑別前提: 有足量已平倉單, 且有經過日數與根數不同之單
            assert.ok(nFin >= 30, `nFin=${nFin}`)
            assert.ok(nGapOrders >= 5, `nGapOrders=${nGapOrders}`)
        })

        it('每根時長與資料間距不符: 不檢查(不拋), btDays依所給之intervalSec計, dayHold不受影響', async function() {
            //R-BT-04: 不檢查intervalSec與K線之實際間距; 後果只限btDays與closeAndSummaryOrders之區間檢查
            let rng = mulberry32(6400)
            let cs = genRandomCase(rng, { stepSec: 86400 })
            let ts = cs.arrOhlc[0].time
            let te = cs.arrOhlc[cs.arrOhlc.length - 1].time
            let rDay = await runStrategy(ott, mkStrategy(cs, { intervalSec: 86400, timeBasis: 'span' }), mkFgs(cs))
            for (let sec of [14400, 604800]) {
                let r = await runStrategy(ott, mkStrategy(cs, { intervalSec: sec, timeBasis: 'span' }), mkFgs(cs))
                assert.strictEqual(r.summary.btDays, btDaysSpanRef(ts, te, sec))
                assert.deepStrictEqual(r.orders.map((o) => o.dayHold), rDay.orders.map((o) => o.dayHold))
            }
            assert.strictEqual(btDaysSpanRef(ts, te, 14400), btDaysOpenRef(ts, te)) //給14400時之btDays與open相同(日線之偏差未除)
            assert.strictEqual(btDaysSpanRef(ts, te, 604800), btDaysOpenRef(ts, te) + 7)
        })

    })

    describe('R-SUM-01、R-FAST-01: span下精簡版與完整版、快速評估與ordersFromBars與runStrategy逐位相同', function() {

        for (let scene of scenes) {
            it(`${scene.name}`, async function() {
                this.timeout(60000)
                let cases = genCases(scene, 10, 5200)
                let nCmp = 0
                for (let ic = 0; ic < cases.length; ic++) {
                    let cs = cases[ic]
                    let bt = { intervalSec: scene.stepSec, timeBasis: 'span' }
                    let r = await runStrategy(ott, mkStrategy(cs, bt), mkFgs(cs))
                    let ts = r.summary.timeOhlcStart
                    let te = r.summary.timeOhlcEnd

                    //精簡版(對runStrategy之訂單)與完整版
                    let smS = calcOrdersSummarySimple(ott, 1000, r.orders, ts, te, bt)
                    for (let k of keysSimple) {
                        assert.strictEqual(smS[k], r.summary[k], `simple ${k}`)
                    }

                    //快速評估(settings帶bt)
                    let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
                    let smF = sess.evaluate({ conds: cs.conds, tp: cs.tp, sl: cs.sl, settings: { uIni: 1000, uTrade: 100, rFee: 0.0005, ...bt } })
                    for (let k of keysSimple) {
                        assert.strictEqual(smF[k], r.summary[k], `fast ${k}`)
                    }

                    //ordersFromBars(tp與sl相同者)+精簡版
                    if (ic % 2 === 0) {
                        let tpsl = 3
                        let fd = path.resolve(fdTmp, `fb-${scene.name.replace(/[^a-z0-9]/gi, '')}-${ic}`)
                        fs.mkdirSync(path.resolve(fd, 'data-ohlc'), { recursive: true })
                        fs.mkdirSync(path.resolve(fd, 'data-param'), { recursive: true })
                        fs.writeFileSync(path.resolve(fd, 'data-ohlc', 'ohlc.json'), JSON.stringify(cs.arrOhlc), 'utf8')
                        let fpJson = path.resolve(fd, 'kltpsl.json')
                        await buildKLinesTpSl(path.resolve(fd, 'data-ohlc'), path.resolve(fd, 'data-param'), fpJson, { keyOhlc: 'ohlc', ts, te, tps: [tpsl], modes: [cs.mode] })
                        let csB = { ...cs, tp: tpsl / 100, sl: tpsl / 100 }
                        let rB = await runStrategy(ott, mkStrategy(csB, bt), mkFgs(csB))
                        let orders = loadKLinesTpSl(fpJson).ordersFromBars(cs.mode, tpsl, rB.orders.map((o) => o.timeStart), { uTrade: 100, uIni: 1000, rFee: 0.0005 })
                        let smB = calcOrdersSummarySimple(ott, 1000, orders, ts, te, bt)
                        for (let k of keysSimple) {
                            assert.strictEqual(smB[k], rB.summary[k], `ordersFromBars ${k}`)
                        }
                    }
                    nCmp++
                }
                assert.strictEqual(nCmp, cases.length)
            })
        }

    })

    describe('R-BT-05: 各入口之傳遞', function() {

        it('calcSummary與genReport以opt計span摘要, 等於calcOrdersRatio+calcOrdersSummary(span)', async function() {
            let rng = mulberry32(31)
            let cs = genRandomCase(rng, { stepSec: 86400 })
            let bt = { intervalSec: 86400, timeBasis: 'span' }
            let r = await runStrategy(ott, mkStrategy(cs), mkFgs(cs))
            let ts = r.summary.timeOhlcStart
            let te = r.summary.timeOhlcEnd
            let clone = () => JSON.parse(JSON.stringify(r.orders))
            let ref = calcOrdersSummary(ott, 1000, calcOrdersRatio(ott, clone(), bt), ts, te, bt)
            let smC = omitTime(await calcSummary(ott, 1000, clone(), ts, te, bt))
            let { timeOhlcStart, timeOhlcEnd, uIni, ...smCRest } = smC
            assert.deepStrictEqual(smCRest, ref)
            assert.strictEqual(smC.btDays, btDaysSpanRef(ts, te, 86400))
            //genReport
            let fd = path.resolve(fdTmp, 'genReport')
            fs.mkdirSync(fd, { recursive: true })
            let fpOrders = path.resolve(fd, 'orders.json')
            fs.writeFileSync(fpOrders, JSON.stringify(clone()), 'utf8')
            let g = await genReport(ott, fpOrders, { uIni: 1000, timeOhlcStart: ts, timeOhlcEnd: te, ...bt })
            assert.deepStrictEqual(omitTime(g.summary), smC)
            let g0 = await genReport(ott, fpOrders, { uIni: 1000, timeOhlcStart: ts, timeOhlcEnd: te })
            assert.strictEqual(g0.summary.btDays, smC.btDays - 1) //鑑別: 未給時少1日
        })

        it('runStrategies: 各策略之span由合併摘要採用, 等於calcSummary(span)', async function() {
            let rng = mulberry32(57)
            let cs = genRandomCase(rng, { stepSec: 86400 })
            let bt = { intervalSec: 86400, timeBasis: 'span' }
            let sts = [
                { sid: 'a', ...mkStrategy(cs, bt) },
                { sid: 'b', ...mkStrategy(cs, bt), mode: cs.mode === 'long' ? 'short' : 'long' },
            ]
            let rr = await runStrategies(ott, sts, mkFgs(cs))
            let ts = rr.summary.timeOhlcStart
            let te = rr.summary.timeOhlcEnd
            let ref = await calcSummary(ott, 2000, JSON.parse(JSON.stringify(rr.orders)), ts, te, bt)
            assert.deepStrictEqual(omitTime(rr.summary), omitTime(ref))
            assert.strictEqual(rr.summary.btDays, btDaysSpanRef(ts, te, 86400))
            assert.ok(rr.orders.filter((o) => o.modeResult !== '').every((o) => o.dayHold === dayHoldSpanRef(o.timeStart, o.timeEnd)))
        })

        it('runStrategies: 各策略之intervalSec或timeBasis不同、或其一無效時, 先於任何策略之執行即reject', async function() {
            let rng = mulberry32(58)
            let cs = genRandomCase(rng, { stepSec: 86400 })
            let mk = (extra) => ({ sid: 'x', ...mkStrategy(cs, extra) })
            let cases = [
                [[mk({ intervalSec: 86400 }), mk({ intervalSec: 14400 })], 'invalid strategies[1].settings.intervalSec: must be the same for all strategies'],
                [[mk({ intervalSec: 86400 }), mk({})], 'invalid strategies[1].settings.intervalSec: must be the same for all strategies'],
                [[mk({}), mk({}), mk({ intervalSec: '86400' })], 'invalid strategies[2].settings.intervalSec: must be the same for all strategies'],
                [[mk({ intervalSec: 86400, timeBasis: 'span' }), mk({ intervalSec: 86400 })], 'invalid strategies[1].settings.timeBasis: must be the same for all strategies'],
                [[mk({ intervalSec: 86400 }), mk({ intervalSec: 0 })], `invalid strategies[1].settings.intervalSec: must be ${DESC}`],
                [[mk({ intervalSec: 86400 }), mk({ intervalSec: 9e12 })], `invalid strategies[1].settings.intervalSec: must be ${DESC}`], //9e12為60之倍數, 只有上限會擋(拿掉上限則span之btDays變NaN而不拋)
                [[mk({}), mk({ timeBasis: 'span' })], `invalid strategies[1].settings.intervalSec: must be ${DESC} when strategies[1].settings.timeBasis is 'span'`],
                [[mk({}), mk({ intervalSec: 86400, timeBasis: 'close' })], `invalid strategies[1].settings.timeBasis: must be one of 'open', 'span'`],
            ]
            for (let [sts, msg] of cases) {
                let counter = { n: 0 }
                await assert.rejects(runStrategies(ott, sts, mkFgs(cs, counter)), { message: msg })
                assert.strictEqual(counter.n, 0, msg)
            }
            //各策略皆'span'且intervalSec寫法不同(數字與字串)視為相同
            let ok = await runStrategies(ott, [mk({ intervalSec: 86400, timeBasis: 'span' }), mk({ intervalSec: '86400', timeBasis: 'span' })], mkFgs(cs))
            assert.ok(ok.summary.numTrade >= 0)
        })

    })

    describe('R-BT-01: 各入口之檢測先於副作用', function() {

        let rng = mulberry32(77)
        let cs = genRandomCase(rng, { stepSec: 86400 })
        let bads = [
            [{ intervalSec: 0 }, `intervalSec: must be ${DESC}`],
            [{ intervalSec: 9e12, timeBasis: 'span' }, `intervalSec: must be ${DESC}`], //極大值: 9e12為60之倍數, 只有上限會擋(拿掉上限則span之btDays變NaN而不拋)
            [{ intervalSec: 90, timeBasis: 'span' }, `intervalSec: must be ${DESC}`], //非60之倍數
            [{ intervalSec: 86400, timeBasis: 'SPAN' }, `timeBasis: must be one of 'open', 'span'`],
            [{ timeBasis: 'span' }, `intervalSec: must be ${DESC} when #.timeBasis is 'span'`],
        ]
        let msgOf = (pre, m) => `invalid ${pre}.${m.replace('#', pre)}`

        it('runStrategy(reject, 未呼叫funGetSeries)、快速評估(throw)', async function() {
            let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
            for (let [bt, m] of bads) {
                let counter = { n: 0 }
                await assert.rejects(runStrategy(ott, mkStrategy(cs, bt), mkFgs(cs, counter)), { message: msgOf('settings', m) })
                assert.strictEqual(counter.n, 0)
                assert.throws(() => sess.evaluate({ conds: cs.conds, tp: cs.tp, sl: cs.sl, settings: { uIni: 1000, ...bt } }), { message: msgOf('settings', m) })
            }
        })

        it('calcOrdersRatio、calcOrdersSummary、calcOrdersSummarySimple(throw), calcSummary(reject), 皆不改寫訂單', async function() {
            let r = await runStrategy(ott, mkStrategy(cs), mkFgs(cs))
            let ts = r.summary.timeOhlcStart
            let te = r.summary.timeOhlcEnd
            for (let [bt, m] of bads) {
                let orders = r.orders.map((o) => {
                    let { dayHold, rProfitOrLossDay, uTradeAll, rTradeAll, numTradeAll, ...rest } = o
                    return { ...rest, uEquity: o.modeResult === '' ? '' : -1 } //uEquity故意改為-1, calcSummary若先改寫訂單即被重算
                })
                let snap = JSON.stringify(orders)
                assert.throws(() => calcOrdersRatio(ott, orders, bt), { message: msgOf('opt', m) })
                assert.throws(() => calcOrdersSummary(ott, 1000, orders, ts, te, bt), { message: msgOf('opt', m) })
                assert.throws(() => calcOrdersSummarySimple(ott, 1000, orders, ts, te, bt), { message: msgOf('opt', m) })
                await assert.rejects(calcSummary(ott, 1000, orders, ts, te, bt), { message: msgOf('opt', m) })
                assert.strictEqual(JSON.stringify(orders), snap)
            }
        })

        it('closeAndSummaryOrders(reject, 未建fdTest)、genReport(reject, 未寫報告)', async function() {
            let fd = path.resolve(fdTmp, 'side')
            let fdOhlc = path.resolve(fd, 'data-ohlc')
            let fdParam = path.resolve(fd, 'data-param')
            fs.mkdirSync(fdOhlc, { recursive: true })
            fs.mkdirSync(fdParam, { recursive: true })
            fs.writeFileSync(path.resolve(fdOhlc, 'ohlc.json'), JSON.stringify(cs.arrOhlc), 'utf8')
            let r = await runStrategy(ott, mkStrategy(cs), mkFgs(cs))
            let fpOrders = path.resolve(fd, 'orders.json')
            fs.writeFileSync(fpOrders, JSON.stringify(r.orders), 'utf8')
            let ts = cs.arrOhlc[0].time
            let te = cs.arrOhlc[cs.arrOhlc.length - 1].time
            let submit = r.orders.map((o) => ({ ...o, timeEnd: '', priceEnd: '', modeResult: '' }))
            for (let [bt, m] of bads) {
                let fdTest = path.resolve(fd, 'result')
                await assert.rejects(closeAndSummaryOrders(ott, fdOhlc, fdParam, 1000, ts, te, 'ohlc', submit, fdTest, bt), { message: msgOf('opt', m) })
                assert.strictEqual(fs.existsSync(fdTest), false)
                let fpOut = path.resolve(fd, 'report-bad.html')
                await assert.rejects(genReport(ott, fpOrders, { fpOut, ...bt }), { message: msgOf('opt', m) })
                assert.strictEqual(fs.existsSync(fpOut), false)
            }
        })

    })

    describe('R-BT-06: closeAndSummaryOrders之區間檢查', function() {

        let runCase = async (name, stepSec, nBars, tsI, teT, opt) => {
            let fd = path.resolve(fdTmp, `close-${name}`)
            let fdOhlc = path.resolve(fd, 'data-ohlc')
            let fdParam = path.resolve(fd, 'data-param')
            fs.mkdirSync(fdOhlc, { recursive: true })
            fs.mkdirSync(fdParam, { recursive: true })
            let times = buildTimes(nBars, { stepSec })
            let arrOhlc = times.map((t, i) => ({ time: t, Open: 100 + i, High: 103 + i * 1.1, Low: 97 + i * 0.9, Close: 101 + i * 1.05 }))
            fs.writeFileSync(path.resolve(fdOhlc, 'btc.json'), JSON.stringify(arrOhlc), 'utf8')
            let submit = [{ mode: 'long', timeStart: times[0], priceStart: 101, uTrade: 100, priceTakeProfit: 103.5, priceStopLoss: 90, timeEnd: '', priceEnd: '', modeResult: '', uFee: 0.05 }]
            let fdTest = path.resolve(fd, 'result')
            await closeAndSummaryOrders(ott, fdOhlc, fdParam, 1000, times[tsI], teT === null ? times[nBars - 1] : teT, 'btc', submit, fdTest, { writeReport: false, ...opt })
            return JSON.parse(fs.readFileSync(path.resolve(fdTest, 'summary.json'), 'utf8')).summary
        }

        it('給intervalSec: 1小時類(5小時之區間)與日線(2日之區間)通過; span之btDays計至末根收盤', async function() {
            let s1 = await runCase('h1', 3600, 6, 0, null, { intervalSec: 3600 })
            assert.strictEqual(s1.numTrade, 1)
            let s2 = await runCase('d1', 86400, 3, 0, null, { intervalSec: 86400, timeBasis: 'span' })
            assert.strictEqual(s2.btDays, 3)
            let s3 = await runCase('d1open', 86400, 3, 0, null, { intervalSec: 86400 })
            assert.strictEqual(s3.btDays, 2)
        })

        it('給intervalSec: 未對齊之區間(00:00至04:30, 14400)reject, 訊息不含輸入值', async function() {
            await assert.rejects(runCase('mis', 14400, 4, 0, '2020-01-01T04:30:00', { intervalSec: 14400 }), { message: 'invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of opt.intervalSec seconds' })
            await assert.rejects(runCase('mis2', 3600, 8, 0, '2020-01-01T06:00:00', { intervalSec: 14400 }), { message: 'invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of opt.intervalSec seconds' })
            //差1秒、差1分(極小之餘數)亦拒, 恰為每根時長之倍數者(8小時)通過
            await assert.rejects(runCase('mis3', 14400, 4, 0, '2020-01-01T04:00:01', { intervalSec: 14400 }), { message: 'invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of opt.intervalSec seconds' })
            await assert.rejects(runCase('mis4', 3600, 8, 0, '2020-01-01T03:01:00', { intervalSec: 3600 }), { message: 'invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of opt.intervalSec seconds' })
            await assert.rejects(runCase('mis5', 86400, 3, 0, '2020-01-02T23:59:59', { intervalSec: 86400 }), { message: 'invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of opt.intervalSec seconds' })
            let sOk = await runCase('mis6', 14400, 4, 0, '2020-01-01T08:00:00', { intervalSec: 14400 })
            assert.strictEqual(sOk.numTrade, 1)
        })

        it('未給intervalSec: 判準維持現行(截斷之時數為4之倍數), 訊息更正', async function() {
            await assert.rejects(runCase('h1def', 3600, 6, 0, null, {}), { message: 'invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of 4 hours' })
            let s = await runCase('trunc', 14400, 4, 0, '2020-01-01T04:30:00', {}) //截斷為4小時而通過(現行行為)
            assert.strictEqual(s.numTrade, 1)
            let sd = await runCase('ddef', 86400, 3, 0, null, {})
            assert.strictEqual(sd.btDays, 2)
        })

    })

})
