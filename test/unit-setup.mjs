import path from 'path'
import ott from '../src/ott.mjs'


//共用fixtures與工具, 各unit-*.test.mjs引用
//  本檔不帶.test.中綴, 不會被mocha當測試檔抓取


//approx, 浮點容差比較
let approx = (a, b, tol = 1e-9) => Math.abs(a - b) < tol


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
//  opt.stepSec: 每根秒數(給時改為每stepSec秒一根), opt.timeStart: 首根時刻(預設'2020-01-01T00:00:00'); 皆未給時同原式
let buildTimes = (nBars, opt = {}) => {
    let { stepSec = null, timeStart = '2020-01-01T00:00:00' } = opt
    let base = ott(timeStart)
    let times = []
    for (let i = 0; i < nBars; i++) {
        let t = stepSec === null ? base.add(i * 4, 'hour') : base.add(i * stepSec, 'second')
        times.push(t.format('YYYY-MM-DDTHH:mm:ss'))
    }
    return times
}

//genRandomCase, 隨機產生一組(K線, 因子序列含缺值, conds含or分組, tp/sl非對稱, mode)
//  opt.c0: K線起始價(預設100), 只改價格尺度, 不改亂數之取用次序
//  opt.stepSec、opt.timeStart: 每根秒數與首根時刻(見buildTimes), 只改時間標籤, 不改亂數之取用次序
let genRandomCase = (rng, opt = {}) => {
    let { c0 = 100, stepSec = null, timeStart = '2020-01-01T00:00:00' } = opt

    //arrOhlc, 隨機walk且價格恆正
    let nBars = 30 + Math.floor(rng() * 31)
    let times = buildTimes(nBars, { stepSec, timeStart })
    let arrOhlc = []
    let c = c0
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


//fixtures: 6根4hr K線(同一日內, 2020-01-01T00:00至20:00)
let t00 = '2020-01-01T00:00:00'
let t04 = '2020-01-01T04:00:00'
let t08 = '2020-01-01T08:00:00'
let t12 = '2020-01-01T12:00:00'
let t16 = '2020-01-01T16:00:00'
let t20 = '2020-01-01T20:00:00'
let buildArrOhlc = () => {
    return [
        { time: t00, Open: 100, High: 101, Low: 99, Close: 100 },
        { time: t04, Open: 100, High: 106, Low: 100, Close: 105 },
        { time: t08, Open: 105, High: 107, Low: 102, Close: 103 },
        { time: t12, Open: 103, High: 104, Low: 94, Close: 95 },
        { time: t16, Open: 95, High: 98, Low: 92, Close: 93 },
        { time: t20, Open: 93, High: 99, Low: 95, Close: 97 },
    ]
}

//buildOrders: 4張手工下單(calcOrders會就地修改訂單, 故每次重建)
//  A: long@t00, priceStart=100, TP=105(t04之High=106觸發止盈), SL=97
//  B: long@t04, priceStart=105, TP=110.25, SL=101.85(t12之Low=94觸發止損)
//  C: short@t08, priceStart=103, TP=97.85(t12之Low=94觸發止盈), SL=106.09
//  D: long@t16, priceStart=93, TP=105, SL=85(其後K棒皆未觸發, 未平倉)
let buildOrder = (mode, timeStart, priceStart, priceTakeProfit, priceStopLoss) => {
    return {
        mode,
        timeStart,
        priceStart,
        uTrade: 100,
        priceTakeProfit,
        priceStopLoss,
        timeEnd: '',
        priceEnd: '',
        modeResult: '',
        uFee: 0.05, //rFee=0.0005, uFee=0.0005*100
    }
}
let buildOrders = () => {
    return [
        buildOrder('long', t00, 100, 105, 97),
        buildOrder('long', t04, 105, 110.25, 101.85),
        buildOrder('short', t08, 103, 97.85, 106.09),
        buildOrder('long', t16, 93, 105, 85),
    ]
}

//buildArrSig: sig訊號, t00與t08為1(>th觸發), 其餘為0
let buildArrSig = () => {
    return [
        { time: t00, param: 1 },
        { time: t04, param: 0 },
        { time: t08, param: 1 },
        { time: t12, param: 0 },
        { time: t16, param: 0 },
        { time: t20, param: 0 },
    ]
}

//buildStrategy: 單一策略, keyOhlc為btc, 條件序列為sig
let buildStrategy = (mode, sym, th) => {
    return {
        mode,
        keyOhlc: 'btc',
        conds: [{ key: 'sig', sym, th, opr: 'and' }],
        settings: {
            uIni: 1000,
            uTrade: 100,
            rTakeProfit: 0.05,
            rStopLoss: 0.03,
            rFee: 0.0005,
        },
    }
}

//buildFunGetSeries: 序列查詢函數, btc回傳K線, sig回傳訊號
let buildFunGetSeries = () => {
    let arrSig = buildArrSig()
    return async (key) => {
        if (key === 'btc') {
            return buildArrOhlc()
        }
        if (key === 'sig') {
            return arrSig
        }
        throw new Error(`invalid key[${key}]`)
    }
}

//buildFdTmp: 暫存根資料夾, 各測試檔獨立使用./test/tmp-unit-{函數名}, 結束時整夾刪除,
//  各檔不共用父層, 故平行測試(mocha --parallel)時互不干擾
let buildFdTmp = (name) => path.resolve(`./test/tmp-unit-${name}`)


export {
    approx,
    mulberry32,
    buildTimes,
    genRandomCase,
    t00,
    t04,
    t08,
    t12,
    t16,
    t20,
    buildArrOhlc,
    buildOrder,
    buildOrders,
    buildArrSig,
    buildStrategy,
    buildFunGetSeries,
    buildFdTmp,
}
