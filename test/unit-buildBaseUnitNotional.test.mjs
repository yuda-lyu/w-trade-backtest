import assert from 'assert'
import fs from 'fs'
import path from 'path'
import buildBaseUnitNotional from '../src/buildBaseUnitNotional.mjs'
import calcBaseUnitQuantity from '../src/calcBaseUnitQuantity.mjs'
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
import ott from '../src/ott.mjs'
import { approx, mulberry32, buildTimes, genRandomCase, buildFdTmp } from './unit-setup.mjs'


//規格來源: src/buildBaseUnitNotional.mjs、src/runStrategy.mjs(settings.unit)、src/buildStrategyFastSession.mjs(settings.unit)、src/loadKLinesTpSl.mjs(ordersFromBars之opt.unit)
//  草擬規則(由套件端定): R-BU-02 給unit時每單uTrade = units×q0(進場價)×進場價、uFee = rFee×該單uTrade, 其餘算式不變; 未給時行為逐位不變
//  R-BU-03 摘要於各單uTrade不同時: 最大持倉 = 未出場各單進場名義之和之最大值, 等效年化 = 損益和 ÷ 最大持倉 ÷ 年數; 每單報酬率rProfitOrLoss與選項無關
//  R-BU-04 套件不檢最大持倉名義是否超過uIni(不拋), 摘要之uTradeAllMax為實際名義, 由呼叫端與自己之uIni比較


let fdTmp = buildFdTmp('buildBaseUnitNotional')

//交易規則之例: 甲(門檻22)、乙(門檻55)、丙(最小數量主導)
const RA = { stepSize: 0.001, minQty: 0.001, minNotional: 20 }
const RB = { stepSize: 0.001, minQty: 0.001, minNotional: 50 }
const RC = { stepSize: 0.1, minQty: 1, minNotional: 5 }
const rFee = 0.0005

//keysSummary, calcOrdersSummarySimple之全欄位
let keysSummary = ['numTrade', 'numTradeFin', 'rWin', 'uTradeAllMax', 'rTradeAllMax', 'uEquityFinal', 'btDays', 'btYears', 'rEquivalentCumuProfitOrLossFinalNormYear', 'timeOhlcStart', 'timeOhlcEnd']

//keysOrder, 各路徑訂單共有之欄位
let keysOrder = [
    'mode', 'timeStart', 'priceStart', 'uTrade', 'rTakeProfit', 'priceTakeProfit',
    'rStopLoss', 'priceStopLoss', 'timeEnd', 'priceEnd', 'modeResult', 'rFee', 'uFee',
    'uProfitOrLoss', 'rProfitOrLoss', 'uCumuProfitOrLoss', 'rCumuProfitOrLoss', 'uEquity',
]

let assertSummaryEqual = (a, b, tag) => {
    for (let k of keysSummary) {
        assert.strictEqual(a[k], b[k], `${tag} summary.${k}: ${a[k]} vs ${b[k]}`)
    }
}
let assertOrdersEqual = (a, b, tag) => {
    assert.strictEqual(a.length, b.length, `${tag} orders.length`)
    for (let i = 0; i < a.length; i++) {
        for (let k of keysOrder) {
            assert.strictEqual(a[i][k], b[i][k], `${tag} orders[${i}].${k}: ${a[i][k]} vs ${b[i][k]}`)
        }
    }
}

//rel, 相對誤差比較
let rel = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

//runOff, 官方全鏈runStrategy
let runOff = (cs, settings) => {
    let funGetSeries = async (key) => {
        if (key === 'ohlc') {
            return cs.arrOhlc
        }
        if (cs.serieses[key]) {
            return cs.serieses[key]
        }
        throw new Error(`invalid key[${key}]`)
    }
    let strategy = { mode: cs.mode, keyOhlc: 'ohlc', conds: cs.conds, settings: { ...settings, rTakeProfit: cs.tp, rStopLoss: cs.sl } }
    return runStrategy(ott, strategy, funGetSeries)
}

//buildCache, 寫出K線並建止盈止損快取, 回傳loadKLinesTpSl之結果
let nCache = 0
let buildCache = async (cs, tpsl) => {
    nCache++
    let fd = path.resolve(fdTmp, `c${nCache}`)
    let fdOhlc = path.resolve(fd, 'data-ohlc')
    let fdParam = path.resolve(fd, 'data-param')
    fs.mkdirSync(fdOhlc, { recursive: true })
    fs.mkdirSync(fdParam, { recursive: true })
    fs.writeFileSync(path.resolve(fdOhlc, 'ohlc.json'), JSON.stringify(cs.arrOhlc), 'utf8')
    let fpJson = path.resolve(fd, 'kltpsl.json')
    let ts = cs.arrOhlc[0].time
    let te = cs.arrOhlc[cs.arrOhlc.length - 1].time
    await buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'ohlc', ts, te, tps: [tpsl], modes: [cs.mode] })
    return loadKLinesTpSl(fpJson)
}

//rOf, 每單報酬率之定義(每1u名義之損益, 含進出兩次手續費) = 方向×(出場價÷進場價-1)-2×rFee
let rOf = (o) => (o.mode === 'long' ? 1 : -1) * (o.priceEnd / o.priceStart - 1) - 2 * o.rFee

//assertOrderUnit, 每單之名義與損益(R-BU-02)
let assertOrderUnit = (o, unit, tag) => {
    let bq = calcBaseUnitQuantity(o.priceStart, unit.rule, { buffer: unit.buffer, units: unit.units })
    assert.strictEqual(o.uTrade, bq.notional, `${tag} uTrade應為units×q0×進場價`)
    assert.strictEqual(o.uFee, o.rFee * o.uTrade, `${tag} uFee應為rFee×該單uTrade`)
    if (o.modeResult !== '') {
        let r = rOf(o)
        assert.ok(rel(o.uProfitOrLoss, o.uTrade * r), `${tag} uProfitOrLoss=${o.uProfitOrLoss}應為名義×r=${o.uTrade * r}`)
        assert.ok(rel(o.rProfitOrLoss, r), `${tag} rProfitOrLoss=${o.rProfitOrLoss}應為r=${r}`)
    }
}

//bruteR5, 以定義獨立計算: 最大持倉 = 各進場時刻未出場各單之進場名義和之最大值; 等效年化 = 損益和 ÷ 最大持倉 ÷ 年數
let bruteR5 = (orders, ts, te) => {
    let maxHold = 0
    for (let o of orders) {
        let t = o.timeStart
        let h = 0
        for (let q of orders) {
            if (q.timeStart <= t && (q.timeEnd === '' || q.timeEnd > t)) {
                h += q.uTrade
            }
        }
        maxHold = Math.max(maxHold, h)
    }
    let pnl = 0
    for (let o of orders) {
        if (o.modeResult !== '') {
            pnl += o.uProfitOrLoss
        }
    }
    let years = ott(te).diff(ott(ts), 'day') / 365
    return { maxHold, pnl, eqYr: maxHold === 0 || years === 0 ? 0 : pnl / maxHold / years }
}

//scenarios, 價格尺度與選項(各規則之兩種約束皆有起作用之情形)
let scenarios = [
    { c0: 1800, unit: { rule: RA } },
    { c0: 3000, unit: { rule: RA, units: 3 } },
    { c0: 4500, unit: { rule: RA, buffer: 0.25 } },
    { c0: 60000, unit: { rule: RB } },
    { c0: 20000, unit: { rule: RB, units: 2 } },
    { c0: 8, unit: { rule: RC } },
]


describe('buildBaseUnitNotional', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('getNotional為calcBaseUnitQuantity之名義; 預設buffer 0.1、units 1; key區分選項; 事後修改rule不影響', function() {
        let rule = { ...RA }
        let bu = buildBaseUnitNotional({ rule })
        assert.strictEqual(bu.key, '0.001|0.001|20|0.1|1')
        assert.strictEqual(bu.getNotional(1999), 23.988)
        assert.strictEqual(bu.getNotional(2000), calcBaseUnitQuantity(2000, RA).notional)
        let bu3 = buildBaseUnitNotional({ rule: RA, buffer: 0.25, units: 3 })
        assert.strictEqual(bu3.key, '0.001|0.001|20|0.25|3')
        assert.strictEqual(bu3.getNotional(2000), 78) //13格×0.001×2000×3
        //同價重算與快取一致, 不同價各自計算
        assert.strictEqual(bu.getNotional(1999), 23.988)
        assert.strictEqual(bu.getNotional(4399), 26.394)
        rule.minNotional = 50
        assert.strictEqual(bu.getNotional(2001), 22.011)
    })

    it('選項無效時throw, 訊息為`invalid <選項名>[.欄位]: must be <種類>`且不含輸入值(跨套件規格V19、V20)', function() {
        //unit本身須為物件(undefined與null亦無效: 呼叫端以undefined或null表示未給而不呼叫本函數)
        for (let v of [undefined, null, 'x', 1, true, [], () => 1, new Date(0)]) {
            assert.throws(() => buildBaseUnitNotional(v, 'settings.unit'), { message: 'invalid settings.unit: must be an object' })
        }
        assert.throws(() => buildBaseUnitNotional(undefined), { message: 'invalid unit: must be an object' })
        //rule
        assert.throws(() => buildBaseUnitNotional({}, 'settings.unit'), { message: 'invalid settings.unit.rule: must be an object' })
        assert.throws(() => buildBaseUnitNotional({ rule: 'x' }, 'settings.unit'), { message: 'invalid settings.unit.rule: must be an object' })
        assert.throws(() => buildBaseUnitNotional({ rule: { ...RA, minNotional: 0 } }, 'settings.unit'), { message: 'invalid settings.unit.rule.minNotional: must be a positive number' })
        assert.throws(() => buildBaseUnitNotional({ rule: { stepSize: 0.001, minNotional: 20 } }, 'opt.unit'), { message: 'invalid opt.unit.rule.minQty: must be a positive number' })
        for (let k of ['stepSize', 'minQty', 'minNotional']) {
            for (let v of [-1, NaN, Infinity, '', '-', 'NP', '0x10', 'Infinity', null, true, Object(1), [1], {}]) {
                assert.throws(() => buildBaseUnitNotional({ rule: { ...RA, [k]: v } }, 'opt.unit'), { message: `invalid opt.unit.rule.${k}: must be a positive number` }, `rule.${k}=${String(v)}`)
            }
        }
        //buffer與units給了而無效即throw, 不改用預設; undefined與null取預設
        for (let v of [-0.1, NaN, Infinity, '', 'x', true, Object(0.1), [0.1]]) {
            assert.throws(() => buildBaseUnitNotional({ rule: RA, buffer: v }, 'opt.unit'), { message: 'invalid opt.unit.buffer: must be a non-negative number' }, `buffer=${String(v)}`)
        }
        for (let v of [0, -1, 1.5, '1.5', NaN, Infinity, '', 'x', true, Object(1), [1], 2 ** 53]) {
            assert.throws(() => buildBaseUnitNotional({ rule: RA, units: v }, 'opt.unit'), { message: 'invalid opt.unit.units: must be a positive integer' }, `units=${String(v)}`)
        }
        assert.strictEqual(buildBaseUnitNotional({ rule: RA, buffer: null, units: null }).key, '0.001|0.001|20|0.1|1')
        assert.strictEqual(buildBaseUnitNotional({ rule: RA, buffer: undefined, units: undefined }).key, '0.001|0.001|20|0.1|1')
        //步長格數於價格1即超過安全整數者建立時throw
        assert.throws(() => buildBaseUnitNotional({ rule: { stepSize: 1e-20, minQty: 1, minNotional: 5 } }, 'opt.unit'), { message: 'invalid opt.unit: step count k must not exceed Number.MAX_SAFE_INTEGER' })
        //價格1之數量或名義即超出雙精度範圍者建立時throw; 價格較大才超出者於getNotional throw
        assert.throws(() => buildBaseUnitNotional({ rule: { stepSize: 1e308, minQty: 1.5e308, minNotional: 1 }, buffer: 0 }, 'opt.unit'), { message: 'invalid opt.unit: quantity and notional must be finite numbers' })
        let buBig = buildBaseUnitNotional({ rule: { stepSize: 1, minQty: 100, minNotional: 1 } }, 'opt.unit')
        assert.strictEqual(buBig.getNotional(2000), 200000)
        assert.throws(() => buBig.getNotional(1e308), { message: 'invalid price or rule: quantity and notional must be finite numbers' })
        //getNotional之價格無效時throw(訊息不含價格)
        let bu = buildBaseUnitNotional({ rule: RA })
        for (let p of [0, -1, NaN, Infinity, null, undefined, '', 'x']) {
            assert.throws(() => bu.getNotional(p), { message: 'invalid price: must be a positive number' }, `price=${String(p)}`)
        }
    })

    it('數字字串: 選項各欄收數字字串, 通過即轉型; 與數字輸入之key與名義逐位相同', function() {
        let bn = buildBaseUnitNotional({ rule: RA, buffer: 0.25, units: 3 })
        let bs = buildBaseUnitNotional({ rule: { stepSize: '0.001', minQty: ' 1e-3 ', minNotional: '20.0' }, buffer: '.25', units: ' 3 ' })
        assert.strictEqual(bs.key, bn.key)
        assert.strictEqual(bs.key, '0.001|0.001|20|0.25|3')
        for (let p of [1999, 2000, 4399, 55000, 0.5, 123456.789]) {
            assert.strictEqual(bs.getNotional(p), bn.getNotional(p), `price ${p}`)
            assert.strictEqual(bs.getNotional(String(p)), bn.getNotional(p), `price字串 ${p}`)
        }
        //呼叫端之unit與其rule不被改寫(凍結物件於ESM嚴格模式下改寫會throw)
        let rule = Object.freeze({ stepSize: '0.001', minQty: '0.001', minNotional: '20' })
        let unit = Object.freeze({ rule, buffer: '0.1', units: '2' })
        let bf = buildBaseUnitNotional(unit)
        assert.strictEqual(bf.getNotional(2000), 44)
        assert.deepStrictEqual({ ...rule }, { stepSize: '0.001', minQty: '0.001', minNotional: '20' })
        assert.deepStrictEqual({ ...unit }, { rule, buffer: '0.1', units: '2' })
    })

    it('R-BU-06: 回傳轉型後之unit({rule:{stepSize,minQty,minNotional},buffer,units}, 皆為Number, 未給之buffer與units為預設), 數字字串與數字輸入之unit相同, 可再傳入得同一key', function() {
        //R-BU-06: 下游(如求解與策略檔)可直接取用轉型後之選項, 不必自行轉型
        let bn = buildBaseUnitNotional({ rule: RA, buffer: 0.25, units: 3 })
        assert.deepStrictEqual(bn.unit, { rule: { stepSize: 0.001, minQty: 0.001, minNotional: 20 }, buffer: 0.25, units: 3 })
        let bs = buildBaseUnitNotional({ rule: { stepSize: '0.001', minQty: ' 1e-3 ', minNotional: '20.0' }, buffer: '.25', units: ' 3 ' })
        assert.deepStrictEqual(bs.unit, bn.unit)
        assert.deepStrictEqual(Object.keys(bs.unit), ['rule', 'buffer', 'units'])
        assert.deepStrictEqual(Object.keys(bs.unit.rule), ['stepSize', 'minQty', 'minNotional'])
        for (let v of [bs.unit.buffer, bs.unit.units, bs.unit.rule.stepSize, bs.unit.rule.minQty, bs.unit.rule.minNotional]) {
            assert.strictEqual(typeof v, 'number')
        }
        //未給(undefined、null、整個省略)之buffer與units以預設0.1與1填入
        for (let u of [{ rule: RA }, { rule: RA, buffer: null, units: null }, { rule: RA, buffer: undefined, units: undefined }]) {
            assert.deepStrictEqual(buildBaseUnitNotional(u).unit, { rule: { ...RA }, buffer: 0.1, units: 1 })
        }
        //再傳入: 同一key, 同一名義(10個價格)
        for (let b of [bn, bs, buildBaseUnitNotional({ rule: RA })]) {
            let b2 = buildBaseUnitNotional(b.unit)
            assert.strictEqual(b2.key, b.key)
            assert.deepStrictEqual(b2.unit, b.unit)
            for (let p of [1999, 2000, 4399, 55000, 0.5, 123456.789, 1, 3, 77, 1234.5]) {
                assert.strictEqual(b2.getNotional(p), b.getNotional(p), `price ${p}`)
            }
        }
        //JSDoc之例
        assert.deepStrictEqual(buildBaseUnitNotional({ rule: { stepSize: '0.001', minQty: ' 0.001 ', minNotional: '20' }, units: '2' }).unit, { rule: { stepSize: 0.001, minQty: 0.001, minNotional: 20 }, buffer: 0.1, units: 2 })
    })

    it('R-BU-06: 每次呼叫回傳新物件且與呼叫端之unit、與getNotional內部使用者互不共用(事後修改回傳之unit不影響getNotional, 凍結之輸入不被改寫)', function() {
        let rule = Object.freeze({ stepSize: 0.001, minQty: 0.001, minNotional: 20 })
        let input = Object.freeze({ rule, buffer: 0.25, units: 3 })
        let bu = buildBaseUnitNotional(input)
        let bu2 = buildBaseUnitNotional(input)
        assert.notStrictEqual(bu.unit, input)
        assert.notStrictEqual(bu.unit.rule, rule)
        assert.notStrictEqual(bu.unit, bu2.unit)
        assert.notStrictEqual(bu.unit.rule, bu2.unit.rule)
        bu.getNotional(1999) //先算一個價格(快取)
        bu.unit.rule.minNotional = 99999
        bu.unit.rule.stepSize = 1
        bu.unit.buffer = 5
        bu.unit.units = 50
        bu.unit.extra = 1
        //修改後才首次計算之價格(未被快取)仍依建立時之選項: 與另建之同選項者相同
        let ref = buildBaseUnitNotional(input)
        for (let p of [2001, 3777.7, 5.5, 1999, 123456]) {
            assert.strictEqual(bu.getNotional(p), ref.getNotional(p), `price ${p}`)
        }
        assert.strictEqual(bu.key, '0.001|0.001|20|0.25|3')
        assert.deepStrictEqual(bu2.unit, { rule: { stepSize: 0.001, minQty: 0.001, minNotional: 20 }, buffer: 0.25, units: 3 }) //另一次呼叫之unit不受影響
        assert.deepStrictEqual({ ...rule }, { stepSize: 0.001, minQty: 0.001, minNotional: 20 })
    })

    it('R-BU-06: 建立時之可計算性檢測為以價格1試算(通過者仍回傳unit, 價格較大才超出雙精度範圍者於getNotional throw)', function() {
        //價格1之數量與名義可計算, 價格1e308時名義超出雙精度範圍
        let bu = buildBaseUnitNotional({ rule: { stepSize: 1, minQty: 100, minNotional: 1 } }, 'opt.unit')
        assert.deepStrictEqual(bu.unit, { rule: { stepSize: 1, minQty: 100, minNotional: 1 }, buffer: 0.1, units: 1 })
        assert.strictEqual(bu.getNotional(2000), 200000)
        assert.throws(() => bu.getNotional(1e308), { message: 'invalid price or rule: quantity and notional must be finite numbers' })
    })

    describe('三路徑(runStrategy、快速評估、ordersFromBars)給選項: 36組隨機案', function() {

        let res = []
        before(async function() {
            this.timeout(120000)
            for (let i = 0; i < 36; i++) {
                let seed = 777 + i * 104729
                let rng = mulberry32(seed)
                let sc = scenarios[i % scenarios.length]
                let cs = genRandomCase(rng, { c0: sc.c0 })
                let tpsl = [2, 3, 5][Math.floor(rng() * 3)]
                cs.tp = tpsl / 100
                cs.sl = tpsl / 100
                let stU = { uIni: 10000, uTrade: 100, rFee, unit: sc.unit }
                let st1 = { uIni: 10000, uTrade: 1, rFee }
                let rU = await runOff(cs, stU)
                let r1 = await runOff(cs, st1)
                let session = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
                let smFast = session.evaluate({ conds: cs.conds, tp: cs.tp, sl: cs.sl, settings: stU })
                let wo = session.evaluate({ conds: cs.conds, tp: cs.tp, sl: cs.sl, settings: stU }, { withOrders: true })
                let tbl = await buildCache(cs, tpsl)
                let oFb = tbl.ordersFromBars(cs.mode, tpsl, rU.orders.map((o) => o.timeStart), { uIni: 10000, uTrade: 100, rFee, unit: sc.unit })
                res.push({ tag: `seed[${seed}]`, sc, cs, rU, r1, smFast, wo, oFb })
            }
        })

        it('鑑別前提: 各案之每單名義不全相同, 且有已平倉與未平倉之單', function() {
            let nVary = 0
            let nFin = 0
            let nOpen = 0
            for (let { rU } of res) {
                let set = new Set(rU.orders.map((o) => o.uTrade))
                if (set.size >= 2) {
                    nVary++
                }
                nFin += rU.summary.numTradeFin
                nOpen += rU.summary.numTrade - rU.summary.numTradeFin
            }
            assert.ok(nVary >= 30, `每單名義相異之案數=${nVary}`)
            assert.ok(nFin >= 200, `已平倉單數=${nFin}`)
            assert.ok(nOpen >= 10, `未平倉單數=${nOpen}`)
        })

        it('runStrategy: 每單uTrade = units×q0(進場價)×進場價、uFee = rFee×uTrade、損益 = 名義×r', function() {
            for (let { tag, sc, rU } of res) {
                rU.orders.forEach((o, i) => assertOrderUnit(o, sc.unit, `${tag} orders[${i}]`))
            }
        })

        it('進場、筆數、勝率與每單報酬率r與是否給選項無關(識別不變)', function() {
            for (let { tag, rU, r1 } of res) {
                assert.deepStrictEqual(rU.orders.map((o) => o.timeStart), r1.orders.map((o) => o.timeStart), `${tag} 進場`)
                assert.strictEqual(rU.summary.numTrade, r1.summary.numTrade)
                assert.strictEqual(rU.summary.numTradeFin, r1.summary.numTradeFin)
                assert.strictEqual(rU.summary.rWin, r1.summary.rWin)
                rU.orders.forEach((o, i) => {
                    assert.strictEqual(o.modeResult, r1.orders[i].modeResult, `${tag} orders[${i}].modeResult`)
                    if (o.modeResult !== '') {
                        assert.ok(rel(o.rProfitOrLoss, r1.orders[i].rProfitOrLoss), `${tag} orders[${i}].rProfitOrLoss ${o.rProfitOrLoss} vs ${r1.orders[i].rProfitOrLoss}`)
                    }
                })
            }
        })

        it('摘要: 最大持倉與等效年化等於以定義獨立計算之值(各單名義不同)', function() {
            for (let { tag, rU } of res) {
                let sm = rU.summary
                let b = bruteR5(rU.orders, sm.timeOhlcStart, sm.timeOhlcEnd)
                assert.ok(rel(sm.uTradeAllMax, b.maxHold, 1e-9), `${tag} uTradeAllMax=${sm.uTradeAllMax} 應為${b.maxHold}`)
                if (sm.numTradeFin > 0) {
                    assert.ok(rel(sm.uEquityFinal - 10000, b.pnl, 1e-9), `${tag} 損益和`)
                    let v = sm.uTradeAllMax === 0 || sm.btDays === 0 ? 0 : (sm.uEquityFinal - 10000) / sm.uTradeAllMax / (sm.btDays / 365)
                    assert.ok(Math.abs(v - b.eqYr) < 1e-9, `${tag} 等效年化=${v} 應為${b.eqYr}`)
                }
            }
        })

        it('摘要: 精簡版與完整版於各單名義不同時對應欄位逐位相同', function() {
            for (let { tag, rU } of res) {
                let sm = calcOrdersSummarySimple(ott, 10000, rU.orders, rU.summary.timeOhlcStart, rU.summary.timeOhlcEnd)
                assertSummaryEqual(sm, rU.summary, `${tag}(simple-vs-full)`)
            }
        })

        it('快速評估: 摘要與withOrders訂單與runStrategy逐位相同', function() {
            for (let { tag, rU, smFast, wo } of res) {
                assertSummaryEqual(smFast, rU.summary, `${tag}(fast)`)
                assertSummaryEqual(wo.summary, rU.summary, `${tag}(fast withOrders)`)
                assertOrdersEqual(wo.orders, rU.orders, `${tag}(fast withOrders)`)
            }
        })

        it('ordersFromBars: 同一組進場下訂單與runStrategy逐位相同, 其精簡摘要與runStrategy之摘要逐位相同', function() {
            for (let { tag, rU, oFb } of res) {
                assertOrdersEqual(oFb, rU.orders, `${tag}(ordersFromBars)`)
                let sm = calcOrdersSummarySimple(ott, 10000, oFb, rU.summary.timeOhlcStart, rU.summary.timeOhlcEnd, { skipSort: true })
                assertSummaryEqual(sm, rU.summary, `${tag}(ordersFromBars summary)`)
            }
        })

    })

    it('各單名義皆為同一常數時, 三路徑與未給選項且uTrade為該常數之結果逐位相同', async function() {
        //規則甲(緩衝0.1)下以下各價之基礎單位名義恰為22(門檻22 ÷ (價格×0.001)為整數)
        let ps = [2000, 4400, 1000, 2200, 2750, 1375, 5500, 11000, 1100, 880]
        for (let p of ps) {
            assert.strictEqual(calcBaseUnitQuantity(p, RA).n0, 22)
        }
        let rng = mulberry32(9091)
        let nBars = 48
        let times = buildTimes(nBars)
        let arrOhlc = []
        let c = 2000
        for (let i = 0; i < nBars; i++) {
            let c2 = ps[Math.floor(rng() * ps.length)]
            let hi = Math.max(c, c2) * (1 + rng() * 0.03)
            let lo = Math.min(c, c2) * (1 - rng() * 0.03)
            arrOhlc.push({ time: times[i], Open: c, High: hi, Low: lo, Close: c2 })
            c = c2
        }
        let serieses = { sig: times.map((t) => ({ time: t, param: rng() })) }
        let conds = [{ key: 'sig', sym: '>', th: 0.4, opr: 'and' }]
        for (let mode of ['long', 'short']) {
            let cs = { arrOhlc, serieses, conds, tp: 0.05, sl: 0.05, mode }
            let stU = { uIni: 10000, uTrade: 100, rFee, unit: { rule: RA } }
            let stC = { uIni: 10000, uTrade: 22, rFee }
            let rU = await runOff(cs, stU)
            let rC = await runOff(cs, stC)
            //鑑別前提: 進場價相異且皆名義22, 有已平倉單
            assert.ok(rU.orders.length >= 10, `orders=${rU.orders.length}`)
            assert.ok(new Set(rU.orders.map((o) => o.priceStart)).size >= 5)
            assert.ok(rU.orders.every((o) => o.uTrade === 22))
            assert.ok(rU.summary.numTradeFin >= 5)
            assert.deepStrictEqual(rU.orders, rC.orders, `${mode} runStrategy orders`)
            let omitTime = (s) => {
                let o = { ...s }
                delete o.timeTest //執行當下時間
                return o
            }
            assert.deepStrictEqual(omitTime(rU.summary), omitTime(rC.summary), `${mode} runStrategy summary`)
            let session = buildStrategyFastSession(ott, { arrOhlc, mode, serieses })
            let input = { conds, tp: 0.05, sl: 0.05 }
            assert.deepStrictEqual(session.evaluate({ ...input, settings: stU }), session.evaluate({ ...input, settings: stC }), `${mode} fast`)
            assert.deepStrictEqual(session.evaluate({ ...input, settings: stU }, { withOrders: true }), session.evaluate({ ...input, settings: stC }, { withOrders: true }), `${mode} fast withOrders`)
            let tbl = await buildCache(cs, 5)
            let ets = rU.orders.map((o) => o.timeStart)
            assert.deepStrictEqual(tbl.ordersFromBars(mode, 5, ets, { uIni: 10000, uTrade: 100, rFee, unit: { rule: RA } }), tbl.ordersFromBars(mode, 5, ets, { uIni: 10000, uTrade: 22, rFee }), `${mode} ordersFromBars`)
        }
    })

    it('績效之例: 兩張同時持倉之單(名義22與26.394)等效年化0.273%, 每單等額為0.5%', async function() {
        //A: 做多2000(名義22), 止盈2060(r=+0.03); B: 做空4399(名義26.394), 止損4486.98(r=-0.02); 手續費0; 期間1年
        let t0 = '2021-01-01T00:00:00'
        let t1 = '2021-01-01T04:00:00'
        let t2 = '2021-06-01T00:00:00'
        let te = '2022-01-01T00:00:00'
        let arrOhlc = [
            { time: t0, Open: 2001, High: 2010, Low: 1995, Close: 2000 },
            { time: t1, Open: 2000, High: 2050, Low: 1990, Close: 2030 }, //A未觸線
            { time: t2, Open: 2030, High: 4500, Low: 1500, Close: 3000 }, //A觸止盈、B觸止損
        ]
        let build = (uA, uB) => [
            { mode: 'long', timeStart: t0, priceStart: 2000, uTrade: uA, priceTakeProfit: 2060, priceStopLoss: 1000, timeEnd: '', priceEnd: '', modeResult: '', rFee: 0, uFee: 0 },
            { mode: 'short', timeStart: t1, priceStart: 4399, uTrade: uB, priceTakeProfit: 4000, priceStopLoss: 4399 * 1.02, timeEnd: '', priceEnd: '', modeResult: '', rFee: 0, uFee: 0 },
        ]
        let nA = calcBaseUnitQuantity(2000, RA).notional
        let nB = calcBaseUnitQuantity(4399, RA).notional
        assert.strictEqual(nA, 22)
        assert.strictEqual(nB, 26.394)
        for (let [uA, uB, eqStr, eqRaw, maxHold] of [[nA, nB, '0.27%', 0.13212 / 48.394, 48.394], [1, 1, '0.50%', 0.005, 2]]) {
            let orders = await calcOrders(arrOhlc, build(uA, uB), { uIni: 10000 })
            assert.ok(approx(orders[0].rProfitOrLoss, 0.03, 1e-12), `A r=${orders[0].rProfitOrLoss}`)
            assert.ok(approx(orders[1].rProfitOrLoss, -0.02, 1e-12), `B r=${orders[1].rProfitOrLoss}`)
            assert.ok(approx(orders[0].uProfitOrLoss, uA * 0.03, 1e-12))
            assert.ok(approx(orders[1].uProfitOrLoss, uB * -0.02, 1e-12))
            orders = calcOrdersRatio(ott, orders)
            let full = calcOrdersSummary(ott, 10000, orders, t0, te)
            let simple = calcOrdersSummarySimple(ott, 10000, orders, t0, te)
            let viaSummary = await calcSummary(ott, 10000, orders, t0, te)
            for (let [nm, sm] of [['full', full], ['simple', simple], ['calcSummary', viaSummary]]) {
                assert.ok(approx(sm.uTradeAllMax, maxHold, 1e-9), `${nm} uTradeAllMax=${sm.uTradeAllMax}`)
                assert.strictEqual(sm.btDays, 365)
                let raw = (sm.uEquityFinal - 10000) / sm.uTradeAllMax / (sm.btDays / 365)
                assert.ok(approx(raw, eqRaw, 1e-12), `${nm} 等效年化=${raw} 應為${eqRaw}`)
                assert.strictEqual(sm.rEquivalentCumuProfitOrLossFinalNormYear, eqStr, `${nm}`)
            }
        }
        //0.13212 / 48.394 = 0.273%(四捨五入至0.001%)
        assert.strictEqual((0.13212 / 48.394 * 100).toFixed(3), '0.273')
    })

    it('套件不檢持倉是否超過uIni: 給選項且最大持倉名義大於uIni時三路徑皆不拋, 摘要之uTradeAllMax為實際名義(由呼叫端比較)', async function() {
        let times = buildTimes(6)
        let arrOhlc = [2000, 2100, 2060, 1900, 1860, 1940].map((c, i) => ({ time: times[i], Open: c + 3, High: c * 1.01, Low: c * 0.99, Close: c }))
        let serieses = { sig: times.map((t, i) => ({ time: t, param: [1, 1, 1, 0, 0, 0][i] })) }
        let cs = { arrOhlc, serieses, conds: [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }], tp: 0.5, sl: 0.5, mode: 'long' }
        let unit = { rule: RA }
        let r = await runOff(cs, { uIni: 10000, uTrade: 1, rFee, unit })
        let M = r.summary.uTradeAllMax
        assert.strictEqual(r.summary.numTrade, 3)
        assert.ok(approx(M, 22 + 23.1 + 22.66, 1e-9), `M=${M}`) //三單同時在倉
        let session = buildStrategyFastSession(ott, { arrOhlc, mode: 'long', serieses })
        let input = { conds: cs.conds, tp: 0.5, sl: 0.5 }
        let tbl = await buildCache(cs, 50)
        let ets = r.orders.map((o) => o.timeStart)
        //uIni小於最大持倉名義(遠小於與差0.001兩種): 不拋; uTradeAllMax為實際名義且大於uIni; 對uIni之持倉比例不低於100%(差0.001時捨入為100.00%)
        for (let uIni of [50, M - 0.001]) {
            let rS = await runOff(cs, { uIni, uTrade: 1, rFee, unit })
            let smF = session.evaluate({ ...input, settings: { uIni, rFee, unit } })
            let smW = session.evaluate({ ...input, settings: { uIni, rFee, unit } }, { withOrders: true }).summary
            let smO = calcOrdersSummarySimple(ott, uIni, tbl.ordersFromBars('long', 50, ets, { uIni, rFee, unit }), rS.summary.timeOhlcStart, rS.summary.timeOhlcEnd)
            for (let [nm, sm] of [['runStrategy', rS.summary], ['fast', smF], ['fast withOrders', smW], ['ordersFromBars', smO]]) {
                assert.strictEqual(sm.uTradeAllMax, M, `${nm} uIni=${uIni} uTradeAllMax`)
                assert.ok(sm.uTradeAllMax > uIni, `${nm} uIni=${uIni}`)
                assert.ok(parseFloat(sm.rTradeAllMax) >= 100, `${nm} uIni=${uIni} rTradeAllMax=${sm.rTradeAllMax}`)
            }
        }
        //未給選項: 持倉300大於uIni 50亦不檢(現行行為)
        let r0 = await runOff(cs, { uIni: 50, uTrade: 100, rFee })
        assert.strictEqual(r0.summary.uTradeAllMax, 300)
        assert.strictEqual(session.evaluate({ ...input, settings: { uIni: 50, uTrade: 100, rFee } }).uTradeAllMax, 300)
    })

    it('選項無效時三路徑皆throw(含無進場); unit為null視同未給', async function() {
        let times = buildTimes(6)
        let arrOhlc = [2000, 2100, 2060, 1900, 1860, 1940].map((c, i) => ({ time: times[i], Open: c + 3, High: c * 1.01, Low: c * 0.99, Close: c }))
        let serieses = { sig: times.map((t) => ({ time: t, param: 0 })) } //無進場
        let cs = { arrOhlc, serieses, conds: [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }], tp: 0.05, sl: 0.05, mode: 'long' }
        let bad = { rule: { ...RA, stepSize: -1 } }
        let msgBad = 'invalid settings.unit.rule.stepSize: must be a positive number'
        await assert.rejects(runOff(cs, { uIni: 10000, uTrade: 1, rFee, unit: bad }), { message: msgBad })
        let session = buildStrategyFastSession(ott, { arrOhlc, mode: 'long', serieses })
        let input = { conds: cs.conds, tp: 0.05, sl: 0.05 }
        assert.throws(() => session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: bad } }), { message: msgBad })
        assert.throws(() => session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: 'x' } }), { message: 'invalid settings.unit: must be an object' })
        let tbl = await buildCache(cs, 5)
        assert.throws(() => tbl.ordersFromBars('long', 5, [], { unit: bad }), { message: 'invalid opt.unit.rule.stepSize: must be a positive number' })
        //buffer與units給了而無效亦於任何進場之前throw(三路徑), 不改用預設
        for (let [k, v, msg] of [['buffer', -0.1, 'must be a non-negative number'], ['units', 0, 'must be a positive integer'], ['units', '1.5', 'must be a positive integer'], ['buffer', 'x', 'must be a non-negative number']]) {
            let u = { rule: RA, [k]: v }
            await assert.rejects(runOff(cs, { uIni: 10000, uTrade: 1, rFee, unit: u }), { message: `invalid settings.unit.${k}: ${msg}` })
            assert.throws(() => session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: u } }), { message: `invalid settings.unit.${k}: ${msg}` })
            assert.throws(() => tbl.ordersFromBars('long', 5, [], { unit: u }), { message: `invalid opt.unit.${k}: ${msg}` })
        }
        //false、0、空字串等非物件之unit亦為給了而無效(只有undefined與null視為未給)
        for (let u of [false, 0, '']) {
            await assert.rejects(runOff(cs, { uIni: 10000, uTrade: 1, rFee, unit: u }), { message: 'invalid settings.unit: must be an object' })
            assert.throws(() => session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: u } }), { message: 'invalid settings.unit: must be an object' })
            assert.throws(() => tbl.ordersFromBars('long', 5, [], { unit: u }), { message: 'invalid opt.unit: must be an object' })
        }
        //類別實例非一般物件(跨套件規格O1): unit與其rule為類別實例時亦無效
        class Holder {}
        let inst = new Holder()
        await assert.rejects(runOff(cs, { uIni: 10000, uTrade: 1, rFee, unit: inst }), { message: 'invalid settings.unit: must be an object' })
        await assert.rejects(runOff(cs, { uIni: 10000, uTrade: 1, rFee, unit: { rule: Object.assign(new Holder(), RA) } }), { message: 'invalid settings.unit.rule: must be an object' })
        //null與undefined皆視同未給(三路徑之輸出與未給選項逐位相同; runStrategy含摘要)
        let serieses2 = { sig: times.map((t, i) => ({ time: t, param: [1, 0, 1, 0, 1, 0][i] })) }
        let cs2 = { ...cs, serieses: serieses2 }
        let omitTime = (s) => {
            let o = { ...s }
            delete o.timeTest //執行當下時間
            return o
        }
        let b = await runOff(cs2, { uIni: 1000, uTrade: 7, rFee })
        assert.ok(b.orders.length >= 2, `orders=${b.orders.length}`)
        let s2 = buildStrategyFastSession(ott, { arrOhlc, mode: 'long', serieses: serieses2 })
        let w0 = s2.evaluate({ ...input, settings: { uIni: 1000, uTrade: 7, rFee } }, { withOrders: true })
        let o0 = tbl.ordersFromBars('long', 5, [times[0], times[2]], { uTrade: 7 })
        for (let u of [null, undefined]) {
            let a = await runOff(cs2, { uIni: 1000, uTrade: 7, rFee, unit: u })
            assert.deepStrictEqual(a.orders, b.orders, `runStrategy unit=${String(u)}`)
            assert.deepStrictEqual(omitTime(a.summary), omitTime(b.summary), `runStrategy summary unit=${String(u)}`)
            assert.deepStrictEqual(s2.evaluate({ ...input, settings: { uIni: 1000, uTrade: 7, rFee, unit: u } }, { withOrders: true }), w0, `fast unit=${String(u)}`)
            assert.deepStrictEqual(tbl.ordersFromBars('long', 5, [times[0], times[2]], { uTrade: 7, unit: u }), o0, `ordersFromBars unit=${String(u)}`)
        }
    })

    it('給選項時不使用uTrade; 同一快速評估或載入器內不同選項各自正確(快取不混用)', async function() {
        let rng = mulberry32(4242)
        let cs = genRandomCase(rng, { c0: 2500 })
        cs.tp = 0.03
        cs.sl = 0.03
        let u1 = { rule: RA }
        let u3 = { rule: RA, units: 3 }
        let ra = await runOff(cs, { uIni: 10000, uTrade: 1, rFee, unit: u1 })
        let rb = await runOff(cs, { uIni: 10000, uTrade: 100, rFee, unit: u1 })
        assert.ok(ra.orders.length >= 3, `orders=${ra.orders.length}`)
        assert.deepStrictEqual(ra.orders, rb.orders)
        let session = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
        let input = { conds: cs.conds, tp: cs.tp, sl: cs.sl }
        let w1 = session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: u1 } }, { withOrders: true })
        let w3 = session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: u3 } }, { withOrders: true })
        let w1b = session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: u1 } }, { withOrders: true })
        w3.orders.forEach((o, i) => assertOrderUnit(o, u3, `fast units3 orders[${i}]`))
        w1.orders.forEach((o, i) => assertOrderUnit(o, u1, `fast units1 orders[${i}]`))
        assert.deepStrictEqual(w1b, w1)
        assert.ok(rel(w3.summary.uTradeAllMax, 3 * w1.summary.uTradeAllMax, 1e-12))
        let tbl = await buildCache(cs, 3)
        let ets = ra.orders.map((o) => o.timeStart)
        let o1 = tbl.ordersFromBars(cs.mode, 3, ets, { uIni: 10000, rFee, unit: u1 })
        let o3 = tbl.ordersFromBars(cs.mode, 3, ets, { uIni: 10000, rFee, unit: u3 })
        let o1b = tbl.ordersFromBars(cs.mode, 3, ets, { uIni: 10000, rFee, unit: u1, uTrade: 55 })
        o3.forEach((o, i) => assertOrderUnit(o, u3, `ordersFromBars units3 orders[${i}]`))
        o1.forEach((o, i) => assertOrderUnit(o, u1, `ordersFromBars units1 orders[${i}]`))
        assert.deepStrictEqual(o1b, o1)
    })

    it('runStrategies: 各策略settings.unit依基礎單位; 本金為各策略uIni之和; unit給了而無效時reject(不被個別策略失敗之略過吞掉)', async function() {
        let omitTime = (s) => {
            let o = { ...s }
            delete o.timeTest //執行當下時間
            return o
        }
        let rng = mulberry32(7733)
        let cs = genRandomCase(rng, { c0: 2800 })
        let funGetSeries = async (key) => {
            if (key === 'ohlc') {
                return cs.arrOhlc
            }
            if (cs.serieses[key]) {
                return cs.serieses[key]
            }
            throw new Error(`invalid key[${key}]`)
        }
        let mk = (sid, mode, settings) => ({ sid, mode, keyOhlc: 'ohlc', conds: cs.conds, settings: { rTakeProfit: 0.03, rStopLoss: 0.03, rFee, ...settings } })
        let uA = { rule: RA }
        let uB = { rule: RB, units: 2, buffer: 0.2 }
        let sA = mk('sA', 'long', { uIni: 6000, uTrade: 1, unit: uA })
        let sB = mk('sB', 'short', { uIni: 4000, uTrade: 1, unit: uB })
        let rr = await runStrategies(ott, [sA, sB], funGetSeries)
        let rA = await runStrategy(ott, sA, funGetSeries)
        let rB = await runStrategy(ott, sB, funGetSeries)
        assert.ok(rA.orders.length >= 2 && rB.orders.length >= 2, `orders=${rA.orders.length},${rB.orders.length}`)
        //各策略之單依各自之unit定名義
        rr.orders.filter((o) => o.sid === 'sA').forEach((o, i) => assertOrderUnit(o, uA, `sA orders[${i}]`))
        rr.orders.filter((o) => o.sid === 'sB').forEach((o, i) => assertOrderUnit(o, uB, `sB orders[${i}]`))
        assert.strictEqual(rr.orders.length, rA.orders.length + rB.orders.length)
        //合併摘要之本金為各策略uIni之和(照現行, 不因unit改變), 最大持倉名義為實際名義(不檢是否超過本金)
        assert.strictEqual(rr.summary.uTradeAllMax > 0, true)
        let sm = calcOrdersSummarySimple(ott, 10000, rr.orders, rr.summary.timeOhlcStart, rr.summary.timeOhlcEnd)
        assert.strictEqual(sm.uTradeAllMax, rr.summary.uTradeAllMax)
        //unit給了而無效: 於任何策略之執行前reject, 訊息指名策略索引; 不被略過(其餘有效之策略亦不執行)
        let bad = { rule: { ...RA, minQty: -1 } }
        await assert.rejects(runStrategies(ott, [sA, mk('sC', 'long', { uIni: 1000, unit: bad })], funGetSeries), { message: 'invalid strategies[1].settings.unit.rule.minQty: must be a positive number' })
        await assert.rejects(runStrategies(ott, [mk('sC', 'long', { uIni: 1000, unit: 'x' })], funGetSeries), { message: 'invalid strategies[0].settings.unit: must be an object' })
        //false、0、空字串等非物件之unit亦為給了而無效(只有undefined與null視為未給)
        for (let u of [false, 0, '']) {
            await assert.rejects(runStrategies(ott, [sA, mk('sC', 'long', { uIni: 1000, unit: u })], funGetSeries), { message: 'invalid strategies[1].settings.unit: must be an object' }, `unit=${String(u)}`)
        }
        await assert.rejects(runStrategies(ott, [sA, mk('sC', 'long', { uIni: 1000, unit: { rule: RA, units: 0 } })], funGetSeries), { message: 'invalid strategies[1].settings.unit.units: must be a positive integer' })
        //unit為undefined或null: 視同未給, 與未給選項之結果相同
        let rN = await runStrategies(ott, [mk('s1', 'long', { uIni: 1000, uTrade: 7, unit: null }), mk('s2', 'short', { uIni: 1000, uTrade: 7, unit: undefined })], funGetSeries)
        let r0 = await runStrategies(ott, [mk('s1', 'long', { uIni: 1000, uTrade: 7 }), mk('s2', 'short', { uIni: 1000, uTrade: 7 })], funGetSeries)
        assert.ok(r0.orders.length >= 2)
        assert.deepStrictEqual(rN.orders, r0.orders)
        assert.deepStrictEqual(omitTime(rN.summary), omitTime(r0.summary))
    })

    it('unit之各欄為數字字串(交易所API之型態)時, 三路徑之訂單與摘要與數字輸入逐位相同', async function() {
        let omitTime = (s) => {
            let o = { ...s }
            delete o.timeTest //執行當下時間
            return o
        }
        let rng = mulberry32(5150)
        let cs = genRandomCase(rng, { c0: 3000 })
        cs.tp = 0.03
        cs.sl = 0.03
        let uNum = { rule: RA, buffer: 0.25, units: 3 }
        let uStr = { rule: { stepSize: '0.00100000', minQty: '1e-3', minNotional: ' 20 ' }, buffer: '0.25', units: '3' }
        let rN = await runOff(cs, { uIni: 10000, rFee, unit: uNum })
        let rS = await runOff(cs, { uIni: 10000, rFee, unit: uStr })
        assert.ok(rN.orders.length >= 3, `orders=${rN.orders.length}`)
        //鑑別前提: 各單名義相異, 且為依基礎單位之名義(不是未給選項時之uTrade預設), 使「字串與數字相同」不會因兩者皆忽略選項而成立
        assert.ok(new Set(rN.orders.map((o) => o.uTrade)).size >= 3, '各單名義須相異')
        rN.orders.forEach((o, i) => assertOrderUnit(o, uNum, `runStrategy數字 orders[${i}]`))
        rS.orders.forEach((o, i) => assertOrderUnit(o, uNum, `runStrategy字串 orders[${i}]`))
        assert.deepStrictEqual(rS.orders, rN.orders)
        assert.deepStrictEqual(omitTime(rS.summary), omitTime(rN.summary))
        let session = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
        let input = { conds: cs.conds, tp: cs.tp, sl: cs.sl }
        let wS = session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: uStr } }, { withOrders: true })
        wS.orders.forEach((o, i) => assertOrderUnit(o, uNum, `fast字串 orders[${i}]`))
        assert.deepStrictEqual(wS, session.evaluate({ ...input, settings: { uIni: 10000, rFee, unit: uNum } }, { withOrders: true }))
        let tbl = await buildCache(cs, 3)
        let ets = rN.orders.map((o) => o.timeStart)
        let oS = tbl.ordersFromBars(cs.mode, 3, ets, { uIni: 10000, rFee, unit: uStr })
        oS.forEach((o, i) => assertOrderUnit(o, uNum, `ordersFromBars字串 orders[${i}]`))
        assert.deepStrictEqual(oS, tbl.ordersFromBars(cs.mode, 3, ets, { uIni: 10000, rFee, unit: uNum }))
    })

})
