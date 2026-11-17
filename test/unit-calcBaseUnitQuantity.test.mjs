import assert from 'assert'
import calcBaseUnitQuantity from '../src/calcBaseUnitQuantity.mjs'
import { mulberry32 } from './unit-setup.mjs'


//規格來源: src/calcBaseUnitQuantity.mjs(草擬規則R-BU-01, 由套件端定)
//  k = max(⌈minQty/stepSize⌉, ⌈minNotional×(1+buffer)/(price×stepSize)⌉), q0 = k×stepSize, n0 = q0×price
//  數量為步長之整數倍、不小於最小數量、名義不低於門檻且為滿足三者之最小值(k-1必違反其一)
//  以十進位定點計算, 名義恰等於門檻之邊界不得多取或少取一格; 負向輸入throw且訊息指明欄位


//規則甲(步長0.001, 最小數量0.001, 最小名義價值20; 門檻22)、規則乙(0.001, 0.001, 50; 門檻55)、規則丙(0.1, 1, 5)
const RA = { stepSize: 0.001, minQty: 0.001, minNotional: 20 }
const RB = { stepSize: 0.001, minQty: 0.001, minNotional: 50 }
const RC = { stepSize: 0.1, minQty: 1, minNotional: 5 }


//frac, 測試端獨立之精確分數(由String(v)之十進位表示轉{n,d}, 不共用src之轉換)
let frac = (v) => {
    let [mant, ex] = String(v).split('e')
    let [ip, fp = ''] = mant.split('.')
    let n = BigInt(ip + fp)
    let d = 10n ** BigInt(fp.length)
    let e = ex === undefined ? 0 : Number(ex)
    if (e > 0) {
        n = n * 10n ** BigInt(e)
    }
    else if (e < 0) {
        d = d * 10n ** BigInt(-e)
    }
    return { n, d }
}
let fmul = (a, b) => ({ n: a.n * b.n, d: a.d * b.d })
let fadd1 = (a) => ({ n: a.n + a.d, d: a.d })
let fint = (k) => ({ n: BigInt(k), d: 1n })
let fge = (a, b) => a.n * b.d >= b.n * a.d //a>=b
let feq = (a, b) => a.n * b.d === b.n * a.d
//fdec, 分母為10的次方之分數轉十進位字串(供Number解析)
let fdec = (a) => {
    let s = a.d.toString().length - 1
    let str = a.n.toString().padStart(s + 1, '0')
    return s === 0 ? str : `${str.slice(0, str.length - s)}.${str.slice(str.length - s)}`
}

//f64位元操作: 相鄰浮點數
let f64 = new Float64Array(1)
let u64 = new BigUint64Array(f64.buffer)
let nextUp = (x) => {
    f64[0] = x
    u64[0] += 1n
    return f64[0]
}
let nextDown = (x) => {
    f64[0] = x
    u64[0] -= 1n
    return f64[0]
}

//assertMinimal, R-BU-01之性質: 數量為步長之整數倍、>=最小數量、名義>=門檻, 且k-1違反其一; 回傳值與精確十進位一致
let assertMinimal = (p, rule, buffer, units, r, tag) => {
    let step = frac(rule.stepSize)
    let mq = frac(rule.minQty)
    let th = fmul(frac(rule.minNotional), fadd1(frac(buffer))) //門檻 = minNotional×(1+buffer)
    let pp = frac(p)
    let k = r.k
    assert.ok(Number.isSafeInteger(k) && k >= 1, `${tag} k=${k}`)
    let q = fmul(fint(k), step)
    let q1 = fmul(fint(k - 1), step)
    //步長之整數倍且>=最小數量(R-BU-01)
    assert.ok(feq(frac(r.quantityStr), fmul(fint(units), q)), `${tag} quantityStr=${r.quantityStr} 非 units×k×stepSize`)
    assert.ok(fge(q, mq), `${tag} q0<minQty`)
    //名義>=門檻(R-BU-01)
    assert.ok(fge(fmul(q, pp), th), `${tag} n0<門檻`)
    //k-1必違反其一(R1之最小性)
    assert.ok(!fge(q1, mq) || !fge(fmul(q1, pp), th), `${tag} k-1=${k - 1}仍合法, 非最小`)
    //回傳之Number為精確十進位值之最近浮點數
    assert.strictEqual(r.q0, Number(fdec(q)), `${tag} q0`)
    assert.strictEqual(r.n0, Number(fdec(fmul(q, pp))), `${tag} n0`)
    assert.strictEqual(r.quantity, Number(fdec(fmul(fint(units), q))), `${tag} quantity`)
    assert.strictEqual(r.notional, Number(fdec(fmul(fint(units), fmul(q, pp)))), `${tag} notional`)
    assert.strictEqual(r.units, units, `${tag} units`)
}


describe('calcBaseUnitQuantity', function() {

    it('對照表十列: k、q0、n0逐列相符', function() {
        //對照表: [規則, 進場價, k, q0, n0]
        let rows = [
            [RA, 2000, 11, 0.011, 22], //恰等於門檻, 不多取一格
            [RA, 2001, 11, 0.011, 22.011],
            [RA, 1999, 12, 0.012, 23.988], //11格為21.989<22
            [RA, 4400, 5, 0.005, 22], //邊界
            [RA, 4399, 6, 0.006, 26.394], //5格為21.995<22
            [RB, 100000, 1, 0.001, 100], //受最小數量與步長限制
            [RB, 55000, 1, 0.001, 55], //邊界
            [RB, 54999, 2, 0.002, 109.998], //1格為54.999<55
            [RB, 16000, 4, 0.004, 64],
            [RC, 10, 10, 1, 10], //名義只需6格, 受最小數量限制取10格
        ]
        for (let [rule, p, k, q0, n0] of rows) {
            let r = calcBaseUnitQuantity(p, rule)
            assert.strictEqual(r.k, k, `price ${p} k`)
            assert.strictEqual(r.q0, q0, `price ${p} q0`)
            assert.strictEqual(r.n0, n0, `price ${p} n0`)
            //units預設1: 數量與名義即q0與n0
            assert.strictEqual(r.units, 1)
            assert.strictEqual(r.quantity, q0, `price ${p} quantity`)
            assert.strictEqual(r.notional, n0, `price ${p} notional`)
        }
        //quantityStr為定點字串, 小數位數同stepSize
        assert.strictEqual(calcBaseUnitQuantity(2000, RA).quantityStr, '0.011')
        assert.strictEqual(calcBaseUnitQuantity(16000, RB).quantityStr, '0.004')
        assert.strictEqual(calcBaseUnitQuantity(10, RC).quantityStr, '1.0')
    })

    it('units為單位數: 數量與名義為units倍, k為每單位之格數', function() {
        let r = calcBaseUnitQuantity(2001, RA, { units: 3 })
        assert.strictEqual(r.k, 11)
        assert.strictEqual(r.q0, 0.011)
        assert.strictEqual(r.n0, 22.011)
        assert.strictEqual(r.units, 3)
        assert.strictEqual(r.quantity, 0.033)
        assert.strictEqual(r.notional, 66.033)
        assert.strictEqual(r.quantityStr, '0.033')
        let r7 = calcBaseUnitQuantity(4399, RA, { units: 7 })
        assert.strictEqual(r7.quantity, 0.042)
        assert.strictEqual(r7.notional, 184.758)
    })

    it('buffer預設0.1, 可給0或其他非負數(門檻=minNotional×(1+buffer))', function() {
        assert.strictEqual(calcBaseUnitQuantity(2000, RA).k, 11) //門檻22
        assert.strictEqual(calcBaseUnitQuantity(2000, RA, { buffer: 0.1 }).k, 11)
        assert.strictEqual(calcBaseUnitQuantity(2000, RA, { buffer: 0 }).k, 10) //門檻20, 恰等於
        assert.strictEqual(calcBaseUnitQuantity(2000, RA, { buffer: 0.25 }).k, 13) //門檻25, 12.5格取13
        assert.strictEqual(calcBaseUnitQuantity(2100, RA, { buffer: 0.05 }).k, 10) //門檻21, 恰等於
    })

    //badNums, 非有效數字(含負向與零)之輸入矩陣(跨套件規格V24: 標記字串、'Infinity'、'0x10'、null、undefined、布林、NaN、Infinity、BigInt、包裝物件、物件、陣列)
    let badNums = () => [
        NaN, Infinity, -Infinity, '', ' ', '-', 'NP', 'N/A', 'Infinity', 'NaN', '0x10', '0b11', '1,234', '1e400', '1e-400',
        null, undefined, true, false, 'true', 10n, Object(2000), Object('2000'), [2000], {}, () => 2000,
    ]

    it('負向(price): 非正數、非有效數字時throw, 訊息為固定詞彙且不含輸入值(跨套件規格V19、V20)', function() {
        for (let p of [0, -0, -1, -0.001, '0', '-0.001', '-5', ...badNums()]) {
            assert.throws(() => calcBaseUnitQuantity(p, RA), { message: 'invalid price: must be a positive number' }, `price ${String(typeof p === 'bigint' ? p + 'n' : p)}`)
        }
        //輸入值不回顯: 以特徵字串為值時訊息仍為固定詞彙
        assert.throws(() => calcBaseUnitQuantity('SECRET-9', RA), (err) => err.message === 'invalid price: must be a positive number' && !/SECRET/.test(err.message))
    })

    it('負向(rule): 非物件、缺任一欄或非正數、非有效數字時throw, 訊息指名欄位且不含輸入值', function() {
        for (let rule of [undefined, null, 'rule', 1, true, [], () => 1, new Date(0), new Map()]) {
            assert.throws(() => calcBaseUnitQuantity(2000, rule), { message: 'invalid rule: must be an object' }, `rule ${String(rule)}`)
        }
        //類別實例非一般物件(跨套件規格O1)即使欄位齊全亦無效; 原型為null之物件為一般物件, 有效
        class Holder {}
        assert.throws(() => calcBaseUnitQuantity(2000, Object.assign(new Holder(), RA)), { message: 'invalid rule: must be an object' })
        assert.deepStrictEqual(calcBaseUnitQuantity(2000, Object.assign(Object.create(null), RA)), calcBaseUnitQuantity(2000, RA))
        //缺全部欄位: 依stepSize、minQty、minNotional之序報第一個
        assert.throws(() => calcBaseUnitQuantity(2000, {}), { message: 'invalid rule.stepSize: must be a positive number' })
        for (let k of ['stepSize', 'minQty', 'minNotional']) {
            let rule = { ...RA }
            delete rule[k]
            assert.throws(() => calcBaseUnitQuantity(2000, rule), { message: `invalid rule.${k}: must be a positive number` }, `rule缺${k}`)
            for (let v of [0, -0.001, '0', '-0.001', ...badNums()]) {
                assert.throws(() => calcBaseUnitQuantity(2000, { ...RA, [k]: v }), { message: `invalid rule.${k}: must be a positive number` }, `rule.${k}=${String(typeof v === 'bigint' ? v + 'n' : v)}`)
            }
        }
        //多欄無效時依欄位順序報第一個(stepSize、minQty、minNotional)
        assert.throws(() => calcBaseUnitQuantity(2000, { stepSize: 1, minQty: 0, minNotional: 0 }), { message: 'invalid rule.minQty: must be a positive number' })
        //參數由左至右: price與rule皆無效時先報price
        assert.throws(() => calcBaseUnitQuantity(0, null), { message: 'invalid price: must be a positive number' })
    })

    it('負向(opt): opt非物件時throw; opt為undefined或null視為未給; buffer與units給了而無效即throw(不改用預設)', function() {
        //opt本身: undefined與null視為未給, 其他非物件無效
        let def = calcBaseUnitQuantity(2000, RA)
        assert.deepStrictEqual(calcBaseUnitQuantity(2000, RA, undefined), def)
        assert.deepStrictEqual(calcBaseUnitQuantity(2000, RA, null), def)
        for (let o of [1, 'x', true, [], () => 1, new Date(0)]) {
            assert.throws(() => calcBaseUnitQuantity(2000, RA, o), { message: 'invalid opt: must be an object' }, `opt ${String(o)}`)
        }
        class Holder {}
        assert.throws(() => calcBaseUnitQuantity(2000, RA, Object.assign(new Holder(), { units: 3 })), { message: 'invalid opt: must be an object' })
        assert.strictEqual(calcBaseUnitQuantity(2000, RA, Object.assign(Object.create(null), { units: 3 })).units, 3)
        //buffer為undefined或null取預設0.1
        assert.deepStrictEqual(calcBaseUnitQuantity(2000, RA, { buffer: undefined }), def)
        assert.deepStrictEqual(calcBaseUnitQuantity(2000, RA, { buffer: null }), def)
        //units為undefined或null取預設1
        assert.deepStrictEqual(calcBaseUnitQuantity(2000, RA, { units: undefined }), def)
        assert.deepStrictEqual(calcBaseUnitQuantity(2000, RA, { units: null }), def)
        //buffer給了而無效: throw, 不回預設值之結果(影響下單數量, 不靜默改值)
        for (let v of [-0.1, -1e-12, '-0.1', ...badNums().filter((x) => x !== null && x !== undefined)]) {
            assert.throws(() => calcBaseUnitQuantity(2000, RA, { buffer: v }), { message: 'invalid opt.buffer: must be a non-negative number' }, `buffer ${String(typeof v === 'bigint' ? v + 'n' : v)}`)
        }
        //units給了而無效: 非整數、小於1、超出安全整數、非有效數字
        for (let v of [0, -1, 1.5, '1.5', '0', '-1', 2 ** 53, '9007199254740993', '1e21', ...badNums().filter((x) => x !== null && x !== undefined)]) {
            assert.throws(() => calcBaseUnitQuantity(2000, RA, { units: v }), { message: 'invalid opt.units: must be a positive integer' }, `units ${String(typeof v === 'bigint' ? v + 'n' : v)}`)
        }
        //buffer與units皆無效時先報buffer(依鍵順序)
        assert.throws(() => calcBaseUnitQuantity(2000, RA, { buffer: -1, units: 0 }), { message: 'invalid opt.buffer: must be a non-negative number' })
        //buffer為0與'0'有效(門檻即minNotional)
        assert.strictEqual(calcBaseUnitQuantity(2000, RA, { buffer: '0' }).k, 10)
    })

    it('負向: 格數超過安全整數時throw(價格相對步長過小), 訊息為固定詞彙', function() {
        assert.throws(() => calcBaseUnitQuantity(1e-10, { stepSize: 1e-8, minQty: 1e-8, minNotional: 5 }), { message: 'invalid price or rule: step count k must not exceed Number.MAX_SAFE_INTEGER' })
        //最小數量除以步長過大(與價格無關)亦同
        assert.throws(() => calcBaseUnitQuantity(2000, { stepSize: 1e-20, minQty: 1, minNotional: 5 }), { message: 'invalid price or rule: step count k must not exceed Number.MAX_SAFE_INTEGER' })
    })

    it('負向: 數量或名義超出雙精度範圍(轉回Number為Infinity)時throw, 不回傳Infinity', function() {
        //格數k為2(在安全整數內), 但q0 = 2 × 1e308超過Number.MAX_VALUE
        assert.throws(() => calcBaseUnitQuantity(1, { stepSize: 1e308, minQty: 1.5e308, minNotional: 1 }, { buffer: 0 }), { message: 'invalid price or rule: quantity and notional must be finite numbers' })
        //價格極大使名義(n0 = q0 × price)超出
        assert.throws(() => calcBaseUnitQuantity(1e308, { stepSize: 1, minQty: 100, minNotional: 1 }), { message: 'invalid price or rule: quantity and notional must be finite numbers' })
        //單位數使名義超出(n0有限而units × n0為Infinity)
        assert.throws(() => calcBaseUnitQuantity(1e300, { stepSize: 1e5, minQty: 1e5, minNotional: 1 }, { units: 9007199254740991 }), { message: 'invalid price or rule: quantity and notional must be finite numbers' })
        //鄰近之有限情形不誤擋
        let r = calcBaseUnitQuantity(1e300, { stepSize: 1e5, minQty: 1e5, minNotional: 1 }, { units: 1 })
        assert.ok(Number.isFinite(r.q0) && Number.isFinite(r.n0) && Number.isFinite(r.quantity) && Number.isFinite(r.notional))
    })

    it('數字字串: 交易所API之stepSize等常為字串, price、rule各欄、buffer、units收數字字串, 通過即轉型, 結果與數字輸入逐位相同', function() {
        //(數字輸入, 字串輸入)逐欄對照: 含頭尾空白、正號、小數點結尾、科學記號、前導零
        let rows = [
            { p: 2000, rule: RA, opt: {}, ps: '2000', rs: { stepSize: '0.001', minQty: '0.001', minNotional: '20' }, os: {} },
            { p: 2001, rule: RA, opt: { units: 3 }, ps: ' 2001 ', rs: { stepSize: ' 0.001 ', minQty: '1e-3', minNotional: '2e1' }, os: { units: '3' } },
            { p: 1999, rule: RA, opt: { buffer: 0.25, units: 7 }, ps: '+1999.', rs: { stepSize: '.001', minQty: '0.0010', minNotional: '+20.0' }, os: { buffer: '.25', units: ' 7 ' } },
            { p: 4399, rule: RA, opt: { buffer: 0, units: 2 }, ps: '4.399e3', rs: { stepSize: '0.001', minQty: '0.001', minNotional: '020' }, os: { buffer: '0e0', units: '2.0' } },
            { p: 55000, rule: RB, opt: { buffer: 0.1 }, ps: '55000', rs: { stepSize: '1e-3', minQty: '1e-3', minNotional: '50' }, os: { buffer: '1e-1' } },
            { p: 10, rule: RC, opt: { units: 30 }, ps: '1e1', rs: { stepSize: '0.1', minQty: '1', minNotional: '5' }, os: { units: '3e1' } },
        ]
        for (let [i, { p, rule, opt, ps, rs, os }] of rows.entries()) {
            let rn = calcBaseUnitQuantity(p, rule, opt)
            let rsStr = calcBaseUnitQuantity(ps, rs, os)
            assert.deepStrictEqual(rsStr, rn, `row${i}: 字串輸入與數字輸入之結果須逐位相同`)
            //K4: 通過即轉型, 回傳之units為Number(不是原字串)
            assert.strictEqual(typeof rsStr.units, 'number', `row${i} units型別`)
        }
        //交易所API之典型回應(stepSize等為字串)
        let r = calcBaseUnitQuantity(2000, { stepSize: '0.00100000', minQty: '0.00100000', minNotional: '20' })
        assert.strictEqual(r.k, 11)
        assert.strictEqual(r.notional, 22)
        assert.strictEqual(r.quantityStr, '0.011')
        //呼叫端之rule與opt不被改寫(凍結物件於ESM嚴格模式下改寫會throw)
        let rule = Object.freeze({ stepSize: '0.001', minQty: '0.001', minNotional: '20' })
        let opt = Object.freeze({ buffer: '0.1', units: '2' })
        assert.strictEqual(calcBaseUnitQuantity('2000', rule, opt).notional, 44)
        assert.deepStrictEqual({ ...rule }, { stepSize: '0.001', minQty: '0.001', minNotional: '20' })
        assert.deepStrictEqual({ ...opt }, { buffer: '0.1', units: '2' })
    })

    it('數字字串之性質: 隨機1000組之各欄改以字串(多種寫法)輸入, 結果與數字輸入逐位相同', function() {
        let rng = mulberry32(61117)
        let ri = (a, b) => a + Math.floor(rng() * (b - a + 1))
        let pick = (arr) => arr[Math.floor(rng() * arr.length)]
        //styles, 同一數值之字串寫法: 最短表示、頭尾空白、科學記號(toExponential)、正號
        let styles = [
            (v) => String(v),
            (v) => ` ${String(v)} `,
            (v) => v.toExponential(),
            (v) => `+${String(v)}`,
        ]
        let nStyle = [0, 0, 0, 0]
        let n = 0
        while (n < 1000) {
            let dS = ri(0, 8)
            let rule = {
                stepSize: Number(`${pick([1, 2, 5, 25])}e-${dS}`),
                minQty: Number(`${ri(1, 60)}e-${ri(Math.max(0, dS - 2), dS + 1)}`),
                minNotional: pick([1, 5, 7.5, 10, 20, 50, 100, 0.5]),
            }
            let buffer = pick([0, 0.05, 0.1, 0.15, 0.25, 0.333])
            let units = pick([1, 2, 3, 7, 30])
            let p = rng() < 0.5 ? Number(`${ri(1, 9999999)}e-${ri(0, 8)}`) : (rng() * 10 ** ri(-3, 6))
            if (!(p > 0) || rule.minNotional * 1.4 / (p * rule.stepSize) > 1e14 || rule.minQty / rule.stepSize > 1e14) {
                continue
            }
            let si = ri(0, 3)
            let sx = styles[si]
            nStyle[si]++
            let rn = calcBaseUnitQuantity(p, rule, { buffer, units })
            let rs = calcBaseUnitQuantity(sx(p), { stepSize: sx(rule.stepSize), minQty: sx(rule.minQty), minNotional: sx(rule.minNotional) }, { buffer: sx(buffer), units: sx(units) })
            assert.deepStrictEqual(rs, rn, `#${n} style${si} p=${p}`)
            n++
        }
        //鑑別前提: 四種寫法皆被抽到
        assert.ok(nStyle.every((v) => v >= 100), `寫法分布=${nStyle}`)
    })

    it('邊界: 各k之邊界價格(名義恰等於門檻)取k格, 其下一個浮點數取k+1格, 其上一個浮點數仍取k格', function() {
        //鑑別前提: 以浮點直接計算之公式於對照表第7列之邊界多取一格(50×1.1=55.00000000000001), 本測試之邊界集涵蓋此列
        assert.strictEqual(Math.ceil(50 * 1.1 / (55000 * 0.001)), 2)
        assert.strictEqual(calcBaseUnitQuantity(55000, RB).k, 1)
        let nTested = 0
        let cases = [
            [RA, 0.1], [RB, 0.1], [RC, 0.1],
            [{ stepSize: 0.01, minQty: 0.01, minNotional: 5 }, 0.1],
            [{ stepSize: 0.00001, minQty: 0.00002, minNotional: 100 }, 0.15],
            [{ stepSize: 1, minQty: 1, minNotional: 5 }, 0.3],
        ]
        for (let [rule, buffer] of cases) {
            let step = frac(rule.stepSize)
            let th = fmul(frac(rule.minNotional), fadd1(frac(buffer)))
            let k1 = Number((frac(rule.minQty).n * step.d + frac(rule.minQty).d * step.n - 1n) / (frac(rule.minQty).d * step.n))
            let nRule = 0
            for (let k = 1; k <= 400; k++) {
                //p = 門檻 / (k × stepSize), 只取有限小數且以Number可精確表示者
                let num = th.n * step.d
                let den = th.d * step.n * BigInt(k)
                let g = (a, b) => (b === 0n ? a : g(b, a % b))
                let gg = g(num, den)
                let dn = den / gg
                let nn = num / gg
                let t = dn
                while (t % 2n === 0n) t /= 2n
                while (t % 5n === 0n) t /= 5n
                if (t !== 1n) {
                    continue
                }
                let d10 = 1n
                while (d10 % dn !== 0n) {
                    d10 *= 10n
                }
                let pstr = fdec({ n: nn * (d10 / dn), d: d10 })
                let p = Number(pstr)
                if (String(p) !== pstr) {
                    continue
                }
                let kExp = Math.max(k, k1)
                assert.strictEqual(calcBaseUnitQuantity(p, rule, { buffer }).k, kExp, `rule ${JSON.stringify(rule)} buffer ${buffer} 邊界價 ${pstr} 應取${kExp}格`)
                if (k > k1) {
                    assert.strictEqual(calcBaseUnitQuantity(nextDown(p), rule, { buffer }).k, k + 1, `邊界價 ${pstr} 之下一個浮點數應取${k + 1}格`)
                    assert.strictEqual(calcBaseUnitQuantity(nextUp(p), rule, { buffer }).k, k, `邊界價 ${pstr} 之上一個浮點數應取${k}格`)
                    nRule++
                }
                nTested++
            }
            assert.ok(nRule >= 5, `rule ${JSON.stringify(rule)} 之邊界數=${nRule}過少, 不足以鑑別`)
        }
        assert.ok(nTested >= 60, `邊界總數=${nTested}`)
    })

    it('性質測試: 隨機規則與價格(2000組)下為步長整數倍、>=最小數量、名義>=門檻且最小', function() {
        let rng = mulberry32(20261117)
        let ri = (a, b) => a + Math.floor(rng() * (b - a + 1))
        let pick = (arr) => arr[Math.floor(rng() * arr.length)]
        let n = 0
        let nK1 = 0
        let nK2 = 0
        while (n < 2000) {
            let dS = ri(0, 8)
            let rule = {
                stepSize: Number(`${pick([1, 2, 5, 25])}e-${dS}`),
                minQty: Number(`${ri(1, 60)}e-${ri(Math.max(0, dS - 2), dS + 1)}`),
                minNotional: pick([1, 5, 7.5, 10, 20, 50, 100, 0.5]),
            }
            let buffer = pick([0, 0.05, 0.1, 0.15, 0.25, 0.333])
            let units = pick([1, 1, 1, 2, 3, 30])
            //價格: 有限小數或任意浮點數, 量級1e-4~1e6
            let p = rng() < 0.5 ? Number(`${ri(1, 9999999)}e-${ri(0, 8)}`) : (rng() * 10 ** ri(-4, 6))
            if (!(p > 0)) {
                continue
            }
            //格數過大者不在本測試(另有throw之案)
            if (rule.minNotional * 1.4 / (p * rule.stepSize) > 1e14 || rule.minQty / rule.stepSize > 1e14) {
                continue
            }
            let r = calcBaseUnitQuantity(p, rule, { buffer, units })
            assertMinimal(p, rule, buffer, units, r, `#${n} p=${p} rule=${JSON.stringify(rule)} buffer=${buffer} units=${units}`)
            //鑑別前提計數: 兩個約束各自起作用之組數
            let kq = Number((frac(rule.minQty).n * frac(rule.stepSize).d + frac(rule.minQty).d * frac(rule.stepSize).n - 1n) / (frac(rule.minQty).d * frac(rule.stepSize).n))
            if (r.k === kq) {
                nK1++
            }
            else {
                nK2++
            }
            n++
        }
        assert.ok(nK1 >= 100 && nK2 >= 100, `最小數量主導${nK1}組、名義門檻主導${nK2}組, 須兩者皆足`)
    })

})
