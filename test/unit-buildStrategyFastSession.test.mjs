import assert from 'assert'
import buildStrategyFastSession from '../src/buildStrategyFastSession.mjs'
import runStrategy from '../src/runStrategy.mjs'
import calcOrdersSummarySimple from '../src/calcOrdersSummarySimple.mjs'
import ott from '../src/ott.mjs'
import { t00, t04, t08, t12, t16, t20, buildArrOhlc, buildArrSig } from './unit-setup.mjs'


//規格來源: src/buildStrategyFastSession.mjs
//  buildStrategyFastSession: 策略快速評估session, 觸發/結算/摘要語義與官方全鏈(runStrategy→calcOrders→calcOrdersSummary)等值
//  等值性以property test鎖定: 隨機K線/因子序列(含缺值)/conds(含'or'分組)/tp≠sl/long與short,
//  對應欄位須與官方summary嚴格相等(含dig捨入後之%字串), uEquityFinal等浮點欄位為bit-exact(===)


//mulberry32, 種子化PRNG(測試可重現, 不用Math.random)
let mulberry32 = (seed) => {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

//buildTimes, 自2020-01-01T00:00:00起每4小時一根
let buildTimes = (nBars) => {
    let base = ott('2020-01-01T00:00:00')
    let times = []
    for (let i = 0; i < nBars; i++) {
        times.push(base.add(i * 4, 'hour').format('YYYY-MM-DDTHH:mm:ss'))
    }
    return times
}

//genRandomCase, 隨機產生一組(K線, 因子序列含缺值, conds含or分組, tp/sl非對稱, mode)
let genRandomCase = (rng) => {

    //arrOhlc, 隨機walk且價格恆正
    let nBars = 30 + Math.floor(rng() * 31)
    let times = buildTimes(nBars)
    let arrOhlc = []
    let c = 100
    for (let i = 0; i < nBars; i++) {
        let c2 = c * (1 + (rng() - 0.5) * 0.08)
        let hi = Math.max(c, c2) * (1 + rng() * 0.03)
        let lo = Math.min(c, c2) * (1 - rng() * 0.03)
        arrOhlc.push({ time: times[i], Open: c, High: hi, Low: lo, Close: c2 })
        c = c2
    }

    //serieses, 每時間點以0.85機率存在(缺值=該時間點不存在), param為[0,1]
    let keys = ['sigA', 'sigB', 'sigC'].slice(0, 1 + Math.floor(rng() * 3))
    let serieses = {}
    for (let key of keys) {
        let arr = []
        for (let i = 0; i < nBars; i++) {
            if (rng() < 0.85) {
                arr.push({ time: times[i], param: rng() })
            }
        }
        serieses[key] = arr
    }

    //conds, 1~3條, 允許同key多條件, and/or混用
    let nConds = 1 + Math.floor(rng() * 3)
    let conds = []
    for (let i = 0; i < nConds; i++) {
        conds.push({
            key: keys[Math.floor(rng() * keys.length)],
            sym: rng() < 0.5 ? '>' : '<',
            th: 0.2 + rng() * 0.6,
            opr: rng() < 0.5 ? 'and' : 'or',
        })
    }

    //tp/sl非對稱, 含淨虧止盈參數(tp=0.0008時tp*uTrade=0.08 < 2*uFee=0.1)
    let tps = [0.0008, 0.02, 0.05]
    let sls = [0.01, 0.03, 0.06]
    let tp = tps[Math.floor(rng() * tps.length)]
    let sl = sls[Math.floor(rng() * sls.length)]

    let mode = rng() < 0.5 ? 'long' : 'short'

    return { arrOhlc, serieses, conds, tp, sl, mode }
}

//st, 熱路徑常用設定
let st = { uIni: 1000, uTrade: 100, rFee: 0.0005 }

//runOfficial, 官方全鏈: runStrategy(內含calcOrders+calcOrdersRatio+calcOrdersSummary)
let runOfficial = async ({ arrOhlc, serieses, conds, tp, sl, mode }) => {
    let funGetSeries = async (key) => {
        if (key === 'ohlc') {
            return arrOhlc
        }
        if (serieses[key]) {
            return serieses[key]
        }
        throw new Error(`invalid key[${key}]`)
    }
    let strategy = {
        mode,
        keyOhlc: 'ohlc',
        conds,
        settings: { ...st, rTakeProfit: tp, rStopLoss: sl },
    }
    return runStrategy(ott, strategy, funGetSeries)
}

//keysSummary, 兩路須嚴格相等之摘要欄位(calcOrdersSummarySimple全欄位)
let keysSummary = [
    'numTrade',
    'numTradeFin',
    'rWin',
    'uTradeAllMax',
    'rTradeAllMax',
    'uEquityFinal',
    'btDays',
    'btYears',
    'rEquivalentCumuProfitOrLossFinalNormYear',
    'timeOhlcStart',
    'timeOhlcEnd',
]

//assertSummaryEqual, 逐欄嚴格相等(===, 浮點欄位即bit-exact)
let assertSummaryEqual = (smFast, smOfficial, tag) => {
    for (let k of keysSummary) {
        assert.strictEqual(smFast[k], smOfficial[k], `${tag} summary.${k}: fast=${smFast[k]} official=${smOfficial[k]}`)
    }
}

//keysOrder, withOrders慢速路徑須與官方訂單嚴格相等之欄位
let keysOrder = [
    'mode', 'timeStart', 'priceStart', 'uTrade', 'rTakeProfit', 'priceTakeProfit',
    'rStopLoss', 'priceStopLoss', 'timeEnd', 'priceEnd', 'modeResult', 'rFee', 'uFee',
    'uProfitOrLoss', 'rProfitOrLoss', 'uCumuProfitOrLoss', 'rCumuProfitOrLoss', 'uEquity',
]

//assertCase, 單一case之等值斷言(summary + withOrders訂單 + simple↔full固化)
let assertCase = async (cs, tag) => {

    //official
    let r = await runOfficial(cs)

    //fast session
    let session = buildStrategyFastSession(ott, {
        arrOhlc: cs.arrOhlc,
        mode: cs.mode,
        serieses: cs.serieses,
    })
    let smFast = session.evaluate({ conds: cs.conds, tp: cs.tp, sl: cs.sl, settings: st })
    assertSummaryEqual(smFast, r.summary, tag)

    //withOrders慢速路徑, 訂單逐欄對齊官方calcOrders結果
    let { orders, summary } = session.evaluate({ conds: cs.conds, tp: cs.tp, sl: cs.sl, settings: st }, { withOrders: true })
    assertSummaryEqual(summary, r.summary, `${tag}(withOrders)`)
    assert.strictEqual(orders.length, r.orders.length, `${tag} orders.length`)
    for (let i = 0; i < orders.length; i++) {
        for (let k of keysOrder) {
            assert.strictEqual(orders[i][k], r.orders[i][k], `${tag} orders[${i}].${k}: fast=${orders[i][k]} official=${r.orders[i][k]}`)
        }
    }

    //同場加映: calcOrdersSummarySimple對官方訂單之輸出須與完整版calcOrdersSummary對應欄位嚴格相等(固化bit-exact宣稱)
    let smSimple = calcOrdersSummarySimple(ott, st.uIni, r.orders, r.summary.timeOhlcStart, r.summary.timeOhlcEnd)
    assertSummaryEqual(smSimple, r.summary, `${tag}(simple-vs-full)`)

    return { r, smFast }
}


describe('buildStrategyFastSession', function() {

    it('property test: 隨機K線/因子(含缺值)/conds(含or分組)/tp≠sl/long與short, 與官方全鏈嚴格相等(60組)', async function() {
        this.timeout(60000)
        for (let i = 0; i < 60; i++) {
            let rng = mulberry32(12345 + i * 7919)
            let cs = genRandomCase(rng)
            await assertCase(cs, `seed[${12345 + i * 7919}]`)
        }
    })

    it('邊角1: 同棒TP/SL同觸先判止損', async function() {
        //t04單棒High=120/Low=80, tp=0.05與sl=0.03同棒同觸 → 先判止損
        let arrOhlc = [
            { time: t00, Open: 100, High: 101, Low: 99, Close: 100 },
            { time: t04, Open: 100, High: 120, Low: 80, Close: 100 },
            { time: t08, Open: 100, High: 101, Low: 99, Close: 100 },
        ]
        let serieses = { sig: [{ time: t00, param: 1 }, { time: t04, param: 0 }, { time: t08, param: 0 }] }
        let conds = [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }]
        let cs = { arrOhlc, serieses, conds, tp: 0.05, sl: 0.03, mode: 'long' }
        let { r } = await assertCase(cs, '邊角1')
        assert.strictEqual(r.orders[0].modeResult, 'loss') //先判止損故為虧
        assert.strictEqual(r.orders[0].priceEnd, 97) //出場為精確止損線
    })

    it('邊角2+4: 未結尾單計入numTrade不計入PnL, rWin分母為numTradeFin', async function() {
        //t00觸發可結(t04觸TP), t16觸發後無K棒觸線 → 未結
        let serieses = { sig: buildArrSig().map((v) => (v.time === t16 ? { ...v, param: 1 } : v)) }
        let conds = [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }]
        let cs = { arrOhlc: buildArrOhlc(), serieses, conds, tp: 0.05, sl: 0.5, mode: 'long' }
        let { smFast } = await assertCase(cs, '邊角2')
        assert.strictEqual(smFast.numTrade, 3) //t00, t08, t16
        assert.ok(smFast.numTradeFin < smFast.numTrade, `numTradeFin=${smFast.numTradeFin}應小於numTrade=${smFast.numTrade}`)
    })

    it('邊角3: tp×uTrade≤2×uFee之淨虧止盈單, modeResult為loss', async function() {
        //tp=0.0008 → tp*uTrade=0.08 < 2*uFee=0.1, 觸TP仍淨虧
        let serieses = { sig: buildArrSig() }
        let conds = [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }]
        let cs = { arrOhlc: buildArrOhlc(), serieses, conds, tp: 0.0008, sl: 0.03, mode: 'long' }
        let { r } = await assertCase(cs, '邊角3')
        let oTp = r.orders.find((o) => o.priceEnd === o.priceTakeProfit)
        assert.ok(oTp, '須有觸TP之單')
        assert.strictEqual(oTp.modeResult, 'loss') //以淨盈虧判定而非以觸TP判定
    })

    it('邊角5: 末棒進場必為未結', async function() {
        let serieses = { sig: buildArrSig().map((v) => (v.time === t20 ? { ...v, param: 1 } : { ...v, param: 0 })) }
        let conds = [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }]
        let cs = { arrOhlc: buildArrOhlc(), serieses, conds, tp: 0.05, sl: 0.03, mode: 'long' }
        let { smFast } = await assertCase(cs, '邊角5')
        assert.strictEqual(smFast.numTrade, 1)
        assert.strictEqual(smFast.numTradeFin, 0)
        assert.strictEqual(smFast.uEquityFinal, '') //無已平倉單, 對齊原版預設''
    })

    it('邊角6: 因子全缺值之空進場集, numTrade=0', async function() {
        let serieses = { sig: [] } //全缺值
        let conds = [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }]
        let cs = { arrOhlc: buildArrOhlc(), serieses, conds, tp: 0.05, sl: 0.03, mode: 'long' }
        let { smFast } = await assertCase(cs, '邊角6')
        assert.strictEqual(smFast.numTrade, 0)
    })

    it('邊角7a: or分組之缺值棒整棒跳過(不得因另一or條件為真而進場)', async function() {
        //sigA於t08缺值但sigB於t08為1: runStrategy因t08不在共同時間交集不進場, session須同步跳過
        let serieses = {
            sigA: [{ time: t00, param: 1 }, { time: t04, param: 0 }, { time: t12, param: 0 }, { time: t16, param: 0 }, { time: t20, param: 0 }], //t08缺值
            sigB: [{ time: t00, param: 0 }, { time: t04, param: 0 }, { time: t08, param: 1 }, { time: t12, param: 0 }, { time: t16, param: 0 }, { time: t20, param: 0 }],
        }
        let conds = [
            { key: 'sigA', sym: '>', th: 0.5, opr: 'or' },
            { key: 'sigB', sym: '>', th: 0.5, opr: 'or' },
        ]
        let cs = { arrOhlc: buildArrOhlc(), serieses, conds, tp: 0.05, sl: 0.03, mode: 'long' }
        let { smFast } = await assertCase(cs, '邊角7a')
        assert.strictEqual(smFast.numTrade, 1) //僅t00(sigA=1), t08因sigA缺值整棒跳過
    })

    it('邊角7b: 同key多條件(band)與or分組混用', async function() {
        let serieses = { sig: buildArrSig().map((v, i) => ({ ...v, param: [0.5, 0.9, 0.6, 0.1, 0.4, 0.2][i] })) }
        let conds = [
            { key: 'sig', sym: '>', th: 0.3, opr: 'and' },
            { key: 'sig', sym: '<', th: 0.7, opr: 'and' },
            { key: 'sig', sym: '>', th: 0.45, opr: 'or' },
        ]
        let cs = { arrOhlc: buildArrOhlc(), serieses, conds, tp: 0.02, sl: 0.03, mode: 'short' }
        await assertCase(cs, '邊角7b')
    })

    it('邊角8: uTradeAllMax峰值發生於中途進場點(僅於timeStart取樣)', async function() {
        //t00/t04/t08連續進場且持單重疊(tp/sl大到窗內不觸線之前先重疊) → 峰值300於t08
        let serieses = { sig: buildArrSig().map((v, i) => ({ ...v, param: i <= 2 ? 1 : 0 })) }
        let conds = [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }]
        let cs = { arrOhlc: buildArrOhlc(), serieses, conds, tp: 0.5, sl: 0.5, mode: 'long' }
        let { smFast } = await assertCase(cs, '邊角8')
        assert.strictEqual(smFast.numTrade, 3)
        assert.strictEqual(smFast.uTradeAllMax, 300) //三單同時在倉, 峰值於第三單timeStart
    })

    it('conds空陣列或cond.key不在serieses時throw(同runStrategy)', function() {
        let session = buildStrategyFastSession(ott, {
            arrOhlc: buildArrOhlc(),
            mode: 'long',
            serieses: { sig: buildArrSig() },
        })
        assert.throws(() => session.evaluate({ conds: [], tp: 0.05, sl: 0.03, settings: st }), /invalid conds/)
        assert.throws(() => session.evaluate({ conds: [{ key: 'nope', sym: '>', th: 0.5 }], tp: 0.05, sl: 0.03, settings: st }), /not in opt\.serieses/)
    })

    it('opt.tpsls預建與惰性建置結果一致', function() {
        let build = (tpsls) => buildStrategyFastSession(ott, {
            arrOhlc: buildArrOhlc(),
            mode: 'long',
            serieses: { sig: buildArrSig() },
            tpsls,
        })
        let input = { conds: [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }], tp: 0.05, sl: 0.03, settings: st }
        let smPre = build([{ tp: 0.05, sl: 0.03 }]).evaluate(input)
        let smLazy = build([]).evaluate(input)
        assert.deepStrictEqual(smPre, smLazy)
    })

})
