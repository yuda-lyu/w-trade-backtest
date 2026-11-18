import assert from 'assert'
import fs from 'fs'
import path from 'path'
import isenum from 'wsemi/src/isenum.mjs'
import parseSettingsNum, { parseNum, isGiven } from '../src/parseSettings.mjs'
import runStrategy from '../src/runStrategy.mjs'
import runStrategies from '../src/runStrategies.mjs'
import runStrategiesAndBacktest from '../src/runStrategiesAndBacktest.mjs'
import buildStrategyFastSession from '../src/buildStrategyFastSession.mjs'
import ott from '../src/ott.mjs'
import { mulberry32, genRandomCase, t00, t20, buildArrOhlc, buildArrSig, buildStrategy, buildFdTmp } from './unit-setup.mjs'


//規格來源: 規則帳本R-NUM-01 ~ R-NUM-05(settings之數值欄收數字字串並轉型, 跨套件規格〈輸入參數之檢測機制〉K4、K7、§11「影響下單數量或金額之opt」、V19、V20)、src/parseSettings.mjs(內部用, 不入聚合入口)
//  R-NUM-01: settings數值欄uIni、uTrade、rTakeProfit、rStopLoss為正數, rFee為非負數; 給了(非undefined與null)須為有效數字(數字或數字字串), 通過即轉為Number且其後只用轉換值, 無效即throw/reject、不改用預設, 訊息`invalid <名稱>: must be a positive number`或`… a non-negative number`(不含輸入值); undefined與null為未給; 數字原樣(含-0)
//  R-NUM-02: runStrategy、runStrategies(各策略)、快速評估三入口一致(同一檢測函數), 先於任何進場與讀取數據; settings給unit時uTrade不使用故不檢
//  R-NUM-03: 快速評估之input.tp、input.sl與opt.tpsls之{tp,sl}同判準(正數, 數字字串轉為Number), 未給之settings取預設(null同undefined)
//  R-NUM-04: runStrategies之uIni(合併本金)以轉換值累加; 數字字串之uIni不再使該策略被靜默略過
//  R-NUM-05: runStrategiesAndBacktest經runStrategies預檢, 無效者於寫檔之前reject
//  合成資料: 隨機漫步K線(各棒價格相異)、因子逐棒隨機(unit-setup之genRandomCase), 各欄之數值取不同量級(uIni 1000、uTrade 100、rTakeProfit 與rStopLoss不等、rFee 0.0005)


let fdTmp = buildFdTmp('parseSettings')

//kinds, 欄位之種類與錯誤訊息之種類描述
let POS = 'a positive number'
let NON = 'a non-negative number'
let FIELDS = [['uIni', POS], ['uTrade', POS], ['rTakeProfit', POS], ['rStopLoss', POS], ['rFee', NON]]

//goodStrs, 有效數字字串與其轉換值(去頭尾空白後Number)
let GOOD_STRS = [
    ['1000', 1000], [' 1000 ', 1000], ['  0.0005', 0.0005], ['+5', 5], ['.5', 0.5], ['5.', 5], ['00012', 12], ['1e3', 1000], [' 1E3 ', 1000], ['1e-7', 1e-7], ['0.30000000000000004', 0.30000000000000004], ['123456789012345678901234567890', 1.2345678901234568e+29],
]

//badAny, 兩種種類皆無效之值(非有效數字): 空字串與空白、非數字字串、十六進位、含逗號或底線、Infinity與NaN(數字與字串)、布林、BigInt、包裝物件、物件、陣列(含單元素)、函數、Symbol
let BAD_ANY = ['', ' ', 'abc', '0x10', '1,000', '1_000', '１２', 'Infinity', '-Infinity', 'NaN', '1e999', NaN, Infinity, -Infinity, true, false, 10n, Object(5), Object('5'), {}, [], [5], () => 1, Symbol('x')]

//descOf, 值之簡述(測試訊息用, BigInt與Symbol不可直接轉字串)
let descOf = (v) => {
    if (typeof v === 'bigint') {
        return `${v}n`
    }
    if (typeof v === 'symbol') {
        return 'symbol'
    }
    if (typeof v === 'function') {
        return 'function'
    }
    return `${typeof v}:${Array.isArray(v) ? `[${v.join()}]` : String(v)}`
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

//mkSt, 策略之settings(數字)
let mkSt = (cs, extra = {}) => ({ uIni: 1000, uTrade: 100, rTakeProfit: cs.tp, rStopLoss: cs.sl, rFee: 0.0005, ...extra })

//mkStrategy
let mkStrategy = (cs, settings) => ({ mode: cs.mode, keyOhlc: 'ohlc', conds: cs.conds, settings })

//strOf, 數值欄改為數字字串(pad為前後空白), keys為要改之欄(預設全部數值欄)
let strOf = (st, pad = '', keys = ['uIni', 'uTrade', 'rTakeProfit', 'rStopLoss', 'rFee']) => {
    let o = { ...st }
    for (let k of keys) {
        if (o[k] !== undefined) {
            o[k] = `${pad}${o[k]}${pad}`
        }
    }
    return o
}

//genCases
let genCases = (n, seed0) => {
    let cases = []
    for (let i = 0; i < n; i++) {
        cases.push(genRandomCase(mulberry32(seed0 + i * 7919)))
    }
    return cases
}


describe('settings數值欄之檢測與轉型', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    describe('R-NUM-01: parseNum、parseSettingsNum', function() {

        it('未給(undefined、null)原樣回傳, 不拋', function() {
            //R-NUM-01: undefined與null為未給, 由呼叫端取預設或維持原行為
            for (let kind of ['p', 'n']) {
                assert.strictEqual(parseNum(undefined, kind, 'settings.x'), undefined)
                assert.strictEqual(parseNum(null, kind, 'settings.x'), null)
            }
            assert.strictEqual(isGiven(undefined), false)
            assert.strictEqual(isGiven(null), false)
            for (let v of [0, '', false, NaN, 'abc']) {
                assert.strictEqual(isGiven(v), true, descOf(v))
            }
        })

        it('有效值: 數字原樣(含-0), 數字字串去頭尾空白後轉為Number', function() {
            //R-NUM-01: 通過即轉型且其後只用轉換值; 數字原樣回傳(輸出逐位不變)
            for (let kind of ['p', 'n']) {
                for (let v of [1, 0.0005, 1e-300, 1e300, 123456.789, Number.MAX_VALUE, Number.MIN_VALUE]) {
                    assert.ok(Object.is(parseNum(v, kind, 'settings.x'), v), `${kind} ${v}`)
                }
                for (let [s, n] of GOOD_STRS) {
                    assert.ok(Object.is(parseNum(s, kind, 'settings.x'), n), `${kind} '${s}'`)
                }
            }
            //非負數: 0與-0有效(原樣), 字串'0'與'-0'亦然
            assert.ok(Object.is(parseNum(0, 'n', 'settings.rFee'), 0))
            assert.ok(Object.is(parseNum(-0, 'n', 'settings.rFee'), -0))
            assert.ok(Object.is(parseNum('0', 'n', 'settings.rFee'), 0))
            assert.ok(Object.is(parseNum(' -0 ', 'n', 'settings.rFee'), -0))
        })

        it('無效值(非有效數字、正數之0與負數、非負數之負數)throw, 訊息為invalid <名稱>: must be <種類>(不含輸入值)', function() {
            //R-NUM-01: 給了而無效即throw、不改用預設; V19、V20
            for (let v of BAD_ANY) {
                for (let [kind, desc] of [['p', POS], ['n', NON]]) {
                    assert.throws(() => parseNum(v, kind, 'settings.uIni'), (err) => err.message === `invalid settings.uIni: must be ${desc}`, `${kind} ${descOf(v)}`)
                }
            }
            for (let v of [0, -0, -1, -1e-300, -Number.MIN_VALUE, '0', '-0', '-1', ' -0.5 ', '-1e-300']) {
                assert.throws(() => parseNum(v, 'p', 'settings.uTrade'), { message: `invalid settings.uTrade: must be ${POS}` }, `p ${descOf(v)}`)
            }
            for (let v of [-1, -1e-300, -Number.MIN_VALUE, '-1', ' -0.5 ', '-1e-300']) {
                assert.throws(() => parseNum(v, 'n', 'settings.rFee'), { message: `invalid settings.rFee: must be ${NON}` }, `n ${descOf(v)}`)
            }
        })

        it('數字之判定與wsemi isenum相同(數字之直接比較快路徑不改判準): 邊界值與隨機值, 有效者原樣(Object.is)、無效者throw', function() {
            //R-NUM-01: 數字有效 ⇔ isenum通過(有限且依種類之範圍); 快路徑為熱路徑(快速評估)之成本考量
            let nums = [NaN, Infinity, -Infinity, 0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE, 1, -1, 0.1, -0.1, 1e-300, -1e-300, 1e300, 2 ** 53, -(2 ** 53), 2 ** 1023, 1 - Number.EPSILON, 1 + Number.EPSILON]
            let rng = mulberry32(777)
            for (let i = 0; i < 2000; i++) {
                nums.push((rng() < 0.5 ? -1 : 1) * Math.pow(10, Math.floor(rng() * 600 - 300)) * rng())
            }
            let nAcc = 0
            let nRej = 0
            for (let v of nums) {
                for (let [kind, opt, desc] of [['p', { gt: 0 }, POS], ['n', { min: 0 }, NON]]) {
                    let ok = isenum(v, opt)
                    if (ok) {
                        assert.ok(Object.is(parseNum(v, kind, 'settings.x'), v), `${kind} ${v}`)
                        nAcc++
                    }
                    else {
                        assert.throws(() => parseNum(v, kind, 'settings', 'x'), { message: `invalid settings.x: must be ${desc}` }, `${kind} ${v}`)
                        nRej++
                    }
                }
            }
            //鑑別前提: 有效與無效各有足量, 且兩種種類之判定結果於0與-0有差異
            assert.ok(nAcc >= 1000 && nRej >= 1000, `nAcc=${nAcc} nRej=${nRej}`)
            assert.notStrictEqual(isenum(0, { gt: 0 }), isenum(0, { min: 0 }))
        })

        it('parseSettingsNum: 五欄之種類、opt.keys、opt.skipUTrade、非物件視為皆未給、不改寫、各欄只讀一次', function() {
            //R-NUM-01
            let st = { uIni: ' 1000 ', uTrade: '100', rTakeProfit: '0.05', rStopLoss: ' 0.03', rFee: '0', other: 'abc' }
            let snap = JSON.stringify(st)
            assert.deepStrictEqual(parseSettingsNum(st), { uIni: 1000, uTrade: 100, rTakeProfit: 0.05, rStopLoss: 0.03, rFee: 0 })
            assert.strictEqual(JSON.stringify(st), snap)
            //opt.keys只檢測並回傳指定之欄
            assert.deepStrictEqual(parseSettingsNum({ uIni: '5', rTakeProfit: 'abc' }, 'settings', { keys: ['uIni', 'rFee'] }), { uIni: 5, rFee: undefined })
            //skipUTrade: uTrade不檢測而原樣回傳
            assert.deepStrictEqual(parseSettingsNum({ uTrade: 'abc', uIni: '5' }, 'settings', { keys: ['uIni', 'uTrade'], skipUTrade: true }), { uIni: 5, uTrade: 'abc' })
            assert.throws(() => parseSettingsNum({ uTrade: 'abc' }, 'settings', { keys: ['uTrade'] }), { message: `invalid settings.uTrade: must be ${POS}` })
            //未給原樣(undefined與null), 非物件視為皆未給
            assert.deepStrictEqual(parseSettingsNum({ uIni: null, uTrade: undefined }, 'settings', { keys: ['uIni', 'uTrade', 'rFee'] }), { uIni: null, uTrade: undefined, rFee: undefined })
            for (let bad of [undefined, null, 'abc', 5, true, []]) {
                assert.deepStrictEqual(parseSettingsNum(bad, 'settings', { keys: ['uIni', 'rFee'] }), { uIni: undefined, rFee: undefined }, descOf(bad))
            }
            //多欄無效時依欄序(uIni、uTrade、rTakeProfit、rStopLoss、rFee)報第一個
            assert.throws(() => parseSettingsNum({ uIni: 1, uTrade: 'x', rFee: 'y' }, 'strategies[3].settings'), { message: `invalid strategies[3].settings.uTrade: must be ${POS}` })
            //各欄只讀取一次
            let nRead = { uIni: 0, rFee: 0 }
            let g = {
                get uIni() {
                    nRead.uIni++
                    return '1000'
                },
                get rFee() {
                    nRead.rFee++
                    return '0.0005'
                },
            }
            assert.deepStrictEqual(parseSettingsNum(g, 'settings', { keys: ['uIni', 'rFee'] }), { uIni: 1000, rFee: 0.0005 })
            assert.deepStrictEqual(nRead, { uIni: 1, rFee: 1 })
        })

    })

    describe('R-NUM-02: runStrategy', function() {

        it('settings之數值欄為數字字串(各欄各自與全部同時, 含前後空白)時, 訂單與摘要逐位等於給數字者, 且訂單與摘要之數值欄皆為Number', async function() {
            this.timeout(60000)
            let nOrders = 0
            let nFin = 0
            for (let cs of genCases(12, 8100)) {
                let st = mkSt(cs)
                let r0 = await runStrategy(ott, mkStrategy(cs, st), mkFgs(cs))
                nOrders += r0.orders.length
                nFin += r0.orders.filter((o) => o.modeResult !== '').length
                for (let pad of ['', ' ']) {
                    for (let keys of [['uIni'], ['uTrade'], ['rTakeProfit'], ['rStopLoss'], ['rFee'], ['uIni', 'uTrade', 'rTakeProfit', 'rStopLoss', 'rFee']]) {
                        let stS = strOf(st, pad, keys)
                        assert.strictEqual(typeof stS[keys[0]], 'string') //輸入確為字串
                        let snap = JSON.stringify(stS)
                        let r1 = await runStrategy(ott, mkStrategy(cs, stS), mkFgs(cs))
                        assert.deepStrictEqual(r1.orders, r0.orders, `${keys.join('+')} pad=${pad.length}`)
                        assert.deepStrictEqual(omitTime(r1.summary), omitTime(r0.summary), `${keys.join('+')} pad=${pad.length}`)
                        assert.strictEqual(JSON.stringify(stS), snap) //不改寫呼叫端之settings
                    }
                }
                for (let o of r0.orders) {
                    for (let k of ['uTrade', 'rTakeProfit', 'rStopLoss', 'rFee', 'uFee', 'priceTakeProfit', 'priceStopLoss']) {
                        assert.strictEqual(typeof o[k], 'number', k)
                    }
                }
                assert.strictEqual(typeof r0.summary.uIni, 'number')
                assert.strictEqual(typeof r0.summary.uEquityFinal, 'number')
            }
            //鑑別前提: 有足量訂單與已平倉單
            assert.ok(nOrders >= 100 && nFin >= 40, `nOrders=${nOrders} nFin=${nFin}`)
        })

        it('數字字串之各欄未轉型時之失真(以原字串運算)已排除: uIni字串不再使權益變成字串串接、rTakeProfit字串不再使止盈價變成字串串接', async function() {
            //R-NUM-01、K4: 檢測之值即使用之值
            let rng = mulberry32(8200)
            let cs = genRandomCase(rng)
            let st = mkSt(cs)
            let r = await runStrategy(ott, mkStrategy(cs, strOf(st, ' ')), mkFgs(cs))
            let r0 = await runStrategy(ott, mkStrategy(cs, st), mkFgs(cs))
            assert.strictEqual(r.summary.uEquityFinal, r0.summary.uEquityFinal)
            assert.strictEqual(typeof r.summary.uEquityFinal, 'number')
            assert.ok(r.summary.rEquivalentCumuProfitOrLossFinalNormYear !== '%')
            assert.strictEqual(r.orders[0].priceTakeProfit, r0.orders[0].priceTakeProfit)
        })

        it('給了而無效之各欄reject(訊息不含輸入值), 且先於讀取數據(funGetSeries未被呼叫)', async function() {
            //R-NUM-01、R-NUM-02: 先於任何進場; V19、V20
            let rng = mulberry32(8300)
            let cs = genRandomCase(rng)
            let nBad = 0
            for (let [k, desc] of FIELDS) {
                let bads = [...BAD_ANY, -1, '-1', -1e-300]
                if (k !== 'rFee') {
                    bads.push(0, '0', -0)
                }
                for (let v of bads) {
                    let counter = { n: 0 }
                    await assert.rejects(runStrategy(ott, mkStrategy(cs, mkSt(cs, { [k]: v })), mkFgs(cs, counter)), (err) => err.message === `invalid settings.${k}: must be ${desc}`, `${k}=${descOf(v)}`)
                    assert.strictEqual(counter.n, 0, `${k}=${descOf(v)}`)
                    nBad++
                }
            }
            assert.ok(nBad >= 140, `nBad=${nBad}`)
            //rFee之0為有效(非負數)
            let r = await runStrategy(ott, mkStrategy(cs, mkSt(cs, { rFee: '0' })), mkFgs(cs))
            assert.deepStrictEqual(r.orders.map((o) => o.uFee), r.orders.map(() => 0))
        })

        it('未給(undefined、null)之uTrade、rTakeProfit、rStopLoss、rFee不視為無效(維持現行行為, 不因本檢測而reject)', async function() {
            //R-NUM-01: 只有「給了」才檢測; 未給者之現行行為(以未給之值運算)不變
            let rng = mulberry32(8400)
            let cs = genRandomCase(rng)
            for (let k of ['uTrade', 'rTakeProfit', 'rStopLoss', 'rFee']) {
                for (let v of [undefined, null]) {
                    let r = await runStrategy(ott, mkStrategy(cs, mkSt(cs, { [k]: v })), mkFgs(cs))
                    assert.ok(Array.isArray(r.orders), `${k}=${String(v)}`)
                }
            }
        })

        it('settings給unit時uTrade不使用故不檢(無效之uTrade不reject, 結果等於未給uTrade), 其餘數值欄仍檢測', async function() {
            //R-NUM-02: 給unit時各單名義依基礎單位, 不使用settings.uTrade
            let rng = mulberry32(8500)
            let cs = genRandomCase(rng)
            let unit = { rule: { stepSize: 0.001, minQty: 0.001, minNotional: 20 } }
            let { uTrade, ...stNo } = mkSt(cs, { unit })
            let r0 = await runStrategy(ott, mkStrategy(cs, stNo), mkFgs(cs))
            for (let v of ['abc', -5, 0, NaN, {}, '']) {
                let r = await runStrategy(ott, mkStrategy(cs, { ...stNo, uTrade: v }), mkFgs(cs))
                assert.deepStrictEqual(r.orders, r0.orders, descOf(v))
                assert.deepStrictEqual(omitTime(r.summary), omitTime(r0.summary), descOf(v))
            }
            await assert.rejects(runStrategy(ott, mkStrategy(cs, { ...stNo, uIni: 'abc' }), mkFgs(cs)), { message: `invalid settings.uIni: must be ${POS}` })
            await assert.rejects(runStrategy(ott, mkStrategy(cs, { ...stNo, rFee: -1 }), mkFgs(cs)), { message: `invalid settings.rFee: must be ${NON}` })
            //unit為null(未給)時uTrade仍檢測
            await assert.rejects(runStrategy(ott, mkStrategy(cs, { ...stNo, unit: null, uTrade: 'abc' }), mkFgs(cs)), { message: `invalid settings.uTrade: must be ${POS}` })
        })

    })

    describe('R-NUM-02、R-NUM-03: 快速評估', function() {

        let mkInput = (cs, settings = { uIni: 1000, uTrade: 100, rFee: 0.0005 }) => ({ conds: cs.conds, tp: cs.tp, sl: cs.sl, settings })

        it('settings之uIni、uTrade、rFee與input之tp、sl為數字字串時, 摘要與withOrders逐位等於給數字者', function() {
            let nOrders = 0
            for (let cs of genCases(12, 8600)) {
                let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
                let input = mkInput(cs)
                let f0 = sess.evaluate(input)
                let w0 = sess.evaluate(input, { withOrders: true })
                nOrders += w0.orders.length
                for (let pad of ['', ' ']) {
                    let toS = (v) => `${pad}${v}${pad}`
                    for (let keys of [['uIni'], ['uTrade'], ['rFee'], ['tp'], ['sl'], ['uIni', 'uTrade', 'rFee', 'tp', 'sl']]) {
                        let inS = { ...input, settings: { ...input.settings } }
                        for (let k of keys) {
                            if (k === 'tp' || k === 'sl') {
                                inS[k] = toS(input[k])
                            }
                            else {
                                inS.settings[k] = toS(input.settings[k])
                            }
                        }
                        let snap = JSON.stringify(inS)
                        assert.deepStrictEqual(sess.evaluate(inS), f0, `${keys.join('+')} pad=${pad.length}`)
                        assert.deepStrictEqual(sess.evaluate(inS, { withOrders: true }), w0, `${keys.join('+')} pad=${pad.length} withOrders`)
                        assert.strictEqual(JSON.stringify(inS), snap)
                    }
                }
                assert.ok(f0.numTradeFin === 0 || typeof f0.uEquityFinal === 'number')
            }
            assert.ok(nOrders >= 100, `nOrders=${nOrders}`)
        })

        it('數字字串之tp不再使止盈價變成字串串接(給字串之結果等於給數字)', function() {
            //K4: 檢測之值即使用之值
            let cs = genRandomCase(mulberry32(8650))
            let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
            let w0 = sess.evaluate(mkInput(cs), { withOrders: true })
            let w1 = sess.evaluate({ ...mkInput(cs), tp: String(cs.tp) }, { withOrders: true })
            assert.deepStrictEqual(w1, w0)
            for (let o of w1.orders) {
                assert.strictEqual(typeof o.rTakeProfit, 'number')
                assert.strictEqual(typeof o.priceTakeProfit, 'number')
            }
        })

        it('給了而無效之settings數值欄與tp、sl throw(訊息不含輸入值); 數值欄為未給之rTakeProfit與rStopLoss於settings內不讀取', function() {
            //R-NUM-02、R-NUM-03: 與runStrategy同判準; evaluate以input.tp、input.sl代settings.rTakeProfit、settings.rStopLoss
            let cs = genRandomCase(mulberry32(8700))
            let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
            let nBad = 0
            for (let [k, desc] of [['uIni', POS], ['uTrade', POS], ['rFee', NON]]) {
                let bads = [...BAD_ANY, -1, '-1']
                if (k !== 'rFee') {
                    bads.push(0, '0')
                }
                for (let v of bads) {
                    assert.throws(() => sess.evaluate(mkInput(cs, { uIni: 1000, uTrade: 100, rFee: 0.0005, [k]: v })), (err) => err.message === `invalid settings.${k}: must be ${desc}`, `${k}=${descOf(v)}`)
                    nBad++
                }
            }
            for (let k of ['tp', 'sl']) {
                for (let v of [...BAD_ANY, 0, '0', -1, '-1']) {
                    assert.throws(() => sess.evaluate({ ...mkInput(cs), [k]: v }), (err) => err.message === `invalid ${k}: must be ${POS}`, `${k}=${descOf(v)}`)
                    nBad++
                }
            }
            assert.ok(nBad >= 100, `nBad=${nBad}`)
            //settings內之rTakeProfit與rStopLoss於evaluate不使用(以input.tp、input.sl為準), 不檢測
            let f0 = sess.evaluate(mkInput(cs))
            assert.deepStrictEqual(sess.evaluate(mkInput(cs, { uIni: 1000, uTrade: 100, rFee: 0.0005, rTakeProfit: 'abc', rStopLoss: -1 })), f0)
        })

        it('未給(undefined、null)之settings數值欄取預設(uIni 1000、uTrade 1、rFee 0.0005), null同undefined; 未給之tp、sl仍由genKLinesTpSl throw', function() {
            //R-NUM-03: K3, null為未給
            let cs = genRandomCase(mulberry32(8800))
            let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
            let fDef = sess.evaluate({ conds: cs.conds, tp: cs.tp, sl: cs.sl })
            let fExp = sess.evaluate(mkInput(cs, { uIni: 1000, uTrade: 1, rFee: 0.0005 }))
            assert.deepStrictEqual(fDef, fExp)
            for (let v of [undefined, null]) {
                assert.deepStrictEqual(sess.evaluate(mkInput(cs, { uIni: v, uTrade: v, rFee: v })), fDef, `v=${String(v)}`)
            }
            for (let k of ['tp', 'sl']) {
                for (let v of [undefined, null]) {
                    assert.throws(() => sess.evaluate({ ...mkInput(cs), [k]: v }), /genKLinesTpSl: invalid tp/, `${k}=${String(v)}`)
                }
            }
        })

        it('settings給unit時uTrade不檢(無效之uTrade不throw, 結果等於未給uTrade), 其餘數值欄仍檢測', function() {
            let cs = genRandomCase(mulberry32(8900))
            let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
            let unit = { rule: { stepSize: 0.001, minQty: 0.001, minNotional: 20 } }
            let f0 = sess.evaluate(mkInput(cs, { uIni: 100000, rFee: 0.0005, unit }), { withOrders: true })
            for (let v of ['abc', -5, 0, NaN, {}, '']) {
                assert.deepStrictEqual(sess.evaluate(mkInput(cs, { uIni: 100000, rFee: 0.0005, unit, uTrade: v }), { withOrders: true }), f0, descOf(v))
            }
            assert.throws(() => sess.evaluate(mkInput(cs, { uIni: 'abc', unit })), { message: `invalid settings.uIni: must be ${POS}` })
        })

        it('opt.tpsls之{tp,sl}同判準: 數字字串轉為Number後才建表與作快取鍵(結果等於給數字), 無效者於建立session時throw', function() {
            //R-NUM-03: '0.05'與0.05之快取鍵相同, 若表依字串建置則其後給數字者亦取到失真之表
            let cs = genRandomCase(mulberry32(9000))
            let mk = (tpsls) => buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses, tpsls })
            let input = mkInput(cs)
            let ref = mk([]).evaluate(input, { withOrders: true })
            let sessS = mk([{ tp: String(cs.tp), sl: String(cs.sl) }]) //無空白: 快取鍵與給數字者相同
            assert.deepStrictEqual(sessS.evaluate(input, { withOrders: true }), ref)
            assert.deepStrictEqual(sessS.evaluate({ ...input, tp: ` ${cs.tp} `, sl: String(cs.sl) }, { withOrders: true }), ref)
            let sessP = mk([{ tp: ` ${cs.tp} `, sl: ` ${cs.sl}` }]) //含空白: 轉換後之快取鍵與給數字者相同
            assert.deepStrictEqual(sessP.evaluate(input, { withOrders: true }), ref)
            assert.throws(() => mk([{ tp: 0.05, sl: 0.03 }, { tp: 'abc', sl: 0.03 }]), { message: `invalid opt.tpsls[1].tp: must be ${POS}` })
            assert.throws(() => mk([{ tp: 0.05, sl: -1 }]), { message: `invalid opt.tpsls[0].sl: must be ${POS}` })
            assert.throws(() => mk([{ tp: Infinity, sl: 0.03 }]), { message: `invalid opt.tpsls[0].tp: must be ${POS}` })
        })

    })

    describe('R-NUM-02、R-NUM-04: runStrategies', function() {

        let mkSts = (cs, st0, st1) => [
            { sid: 'a', ...mkStrategy(cs, st0) },
            { sid: 'b', ...mkStrategy(cs, st1), mode: cs.mode === 'long' ? 'short' : 'long' },
        ]

        it('各策略settings之數值欄為數字字串時, 訂單與合併摘要逐位等於給數字者(含uIni為數字字串者不再被靜默略過, 本金以轉換值累加)', async function() {
            this.timeout(60000)
            let nOrders = 0
            let nBoth = 0
            for (let cs of genCases(8, 9100)) {
                let st = mkSt(cs)
                let st1 = mkSt(cs, { uIni: 2500, uTrade: 50 })
                let r0 = await runStrategies(ott, mkSts(cs, st, st1), mkFgs(cs))
                nOrders += r0.orders.length
                assert.strictEqual(r0.summary.uIni, 3500)
                if (new Set(r0.orders.map((o) => o.sid)).size === 2) {
                    nBoth++
                }
                for (let pad of ['', ' ']) {
                    //全部字串、僅uIni字串、其一策略字串其一數字
                    for (let [a, b] of [
                        [strOf(st, pad), strOf(st1, pad)],
                        [strOf(st, pad, ['uIni']), strOf(st1, pad, ['uIni'])],
                        [strOf(st, pad), st1],
                        [st, strOf(st1, pad)],
                    ]) {
                        let r1 = await runStrategies(ott, mkSts(cs, a, b), mkFgs(cs))
                        assert.deepStrictEqual(r1.orders, r0.orders)
                        assert.deepStrictEqual(omitTime(r1.summary), omitTime(r0.summary))
                        assert.strictEqual(r1.summary.uIni, 3500)
                        assert.ok(r1.summary.numTradeFin === 0 || typeof r1.summary.uEquityFinal === 'number')
                    }
                }
            }
            //鑑別前提: 有足量訂單, 且多數案兩策略皆有單(使各策略之uIni皆影響合併本金與權益)
            assert.ok(nOrders >= 100 && nBoth >= 4, `nOrders=${nOrders} nBoth=${nBoth}`)
        })

        it('任一策略之數值欄給了而無效時, 先於任何策略之執行即reject(funGetSeries未被呼叫), 訊息帶策略索引', async function() {
            //R-NUM-02: 逐策略之try/catch會吞下runStrategy內之錯誤, 故於預檢先擋
            let cs = genRandomCase(mulberry32(9200))
            let nBad = 0
            for (let [k, desc] of FIELDS) {
                let bads = ['abc', '', NaN, Infinity, -1, true, {}, []]
                if (k !== 'rFee') {
                    bads.push(0, '0')
                }
                for (let v of bads) {
                    for (let idx of [0, 1]) {
                        let st = [mkSt(cs), mkSt(cs)]
                        st[idx] = mkSt(cs, { [k]: v })
                        let counter = { n: 0 }
                        await assert.rejects(runStrategies(ott, mkSts(cs, st[0], st[1]), mkFgs(cs, counter)), (err) => err.message === `invalid strategies[${idx}].settings.${k}: must be ${desc}`, `${k}=${descOf(v)} idx=${idx}`)
                        assert.strictEqual(counter.n, 0, `${k}=${descOf(v)} idx=${idx}`)
                        nBad++
                    }
                }
            }
            assert.ok(nBad >= 90, `nBad=${nBad}`)
        })

        it('各策略settings給unit時uTrade不檢(同runStrategy)', async function() {
            let cs = genRandomCase(mulberry32(9300))
            let unit = { rule: { stepSize: 0.001, minQty: 0.001, minNotional: 20 } }
            let { uTrade, ...stNo } = mkSt(cs, { unit })
            let r0 = await runStrategies(ott, mkSts(cs, stNo, stNo), mkFgs(cs))
            let r1 = await runStrategies(ott, mkSts(cs, { ...stNo, uTrade: 'abc' }, { ...stNo, uTrade: -1 }), mkFgs(cs))
            assert.deepStrictEqual(r1.orders, r0.orders)
            assert.deepStrictEqual(omitTime(r1.summary), omitTime(r0.summary))
        })

    })

    describe('R-NUM-02: 各入口對同一欄同一值之判定一致', function() {

        it('uIni、uTrade、rFee: runStrategy、快速評估、runStrategies對有效與無效值皆同判(去除名稱前綴後訊息相同)', async function() {
            //R-NUM-02: 同一檢測函數, 不各自解讀
            let cs = genRandomCase(mulberry32(9400))
            let sess = buildStrategyFastSession(ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
            let norm = (msg) => String(msg).replace(/^invalid (strategies\[\d+\]\.)?settings\./, 'invalid #.')
            let vals = [...BAD_ANY, 0, '0', -1, '-1', 1, '1', ' 2.5 ', 1e-9, '1e3']
            let nSame = 0
            let nOk = 0
            let nErr = 0
            for (let k of ['uIni', 'uTrade', 'rFee']) {
                for (let v of vals) {
                    let outs = []
                    let st = mkSt(cs, { [k]: v })
                    outs.push(await runStrategy(ott, mkStrategy(cs, st), mkFgs(cs)).then(() => 'ok', (err) => norm(err.message)))
                    outs.push(await runStrategies(ott, [{ sid: 'a', ...mkStrategy(cs, st) }], mkFgs(cs)).then(() => 'ok', (err) => norm(err.message)))
                    try {
                        sess.evaluate({ conds: cs.conds, tp: cs.tp, sl: cs.sl, settings: { uIni: 1000, uTrade: 100, rFee: 0.0005, [k]: v } })
                        outs.push('ok')
                    }
                    catch (err) {
                        outs.push(norm(err.message))
                    }
                    assert.ok(outs.every((o) => o === outs[0]), `${k}=${descOf(v)} ${JSON.stringify(outs)}`)
                    nSame++
                    if (outs[0] === 'ok') {
                        nOk++
                    }
                    else {
                        nErr++
                    }
                }
            }
            //鑑別前提: 兩種結果(接受、拒絕)皆有足量案例
            assert.ok(nOk >= 15 && nErr >= 60, `nOk=${nOk} nErr=${nErr}`)
            assert.strictEqual(nSame, nOk + nErr)
        })

    })

    describe('R-NUM-05: runStrategiesAndBacktest', function() {

        let buildFdData = (fd) => {
            let fdOhlc = path.resolve(fdTmp, fd, 'data-ohlc')
            let fdParam = path.resolve(fdTmp, fd, 'data-param')
            fs.mkdirSync(fdOhlc, { recursive: true })
            fs.mkdirSync(fdParam, { recursive: true })
            fs.writeFileSync(path.resolve(fdOhlc, 'btc.json'), JSON.stringify(buildArrOhlc()), 'utf8')
            fs.writeFileSync(path.resolve(fdParam, 'sig.json'), JSON.stringify(buildArrSig()), 'utf8')
            return { fdOhlc, fdParam }
        }
        let mkStrategies = (fnSt) => [
            { sid: 's1', ...buildStrategy('long', '>', 0.5), settings: fnSt(buildStrategy('long', '>', 0.5).settings) },
            { sid: 's2', ...buildStrategy('short', '<', 0.5), settings: fnSt(buildStrategy('short', '<', 0.5).settings) },
        ]

        it('各策略settings為數字字串時, 輸出(回傳值與orders.json、summary.json)等於給數字者', async function() {
            let { fdOhlc, fdParam } = buildFdData('rsab-str')
            let fd0 = path.resolve(fdTmp, 'rsab-str', 'result0')
            let fd1 = path.resolve(fdTmp, 'rsab-str', 'result1')
            let r0 = await runStrategiesAndBacktest(ott, fdOhlc, fdParam, mkStrategies((st) => st), t00, t20, fd0, { writeReport: false })
            let r1 = await runStrategiesAndBacktest(ott, fdOhlc, fdParam, mkStrategies((st) => strOf(st, ' ')), t00, t20, fd1, { writeReport: false })
            assert.deepStrictEqual(r1.orders, r0.orders)
            assert.deepStrictEqual(omitTime(r1.summary), omitTime(r0.summary))
            assert.strictEqual(r1.summary.uIni, 2000)
            assert.strictEqual(r1.orders.length, 6)
            let rd = (fd, fn) => JSON.parse(fs.readFileSync(path.resolve(fd, fn), 'utf8'))
            assert.deepStrictEqual(rd(fd1, 'orders.json'), rd(fd0, 'orders.json'))
            assert.deepStrictEqual(omitTime(rd(fd1, 'summary.json').summary), omitTime(rd(fd0, 'summary.json').summary))
        })

        it('任一策略之數值欄給了而無效時reject, 且未寫任何輸出檔(fdTest未建立)', async function() {
            let { fdOhlc, fdParam } = buildFdData('rsab-bad')
            let n = 0
            for (let [k, desc] of FIELDS) {
                let fdTest = path.resolve(fdTmp, 'rsab-bad', `result-${k}`)
                let sts = mkStrategies((st) => st)
                sts[1].settings = { ...sts[1].settings, [k]: 'abc' }
                await assert.rejects(runStrategiesAndBacktest(ott, fdOhlc, fdParam, sts, t00, t20, fdTest), { message: `invalid strategies[1].settings.${k}: must be ${desc}` })
                assert.strictEqual(fs.existsSync(fdTest), false, k)
                n++
            }
            assert.strictEqual(n, 5)
        })

    })

})
