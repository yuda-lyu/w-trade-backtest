import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { mulberry32, genRandomCase } from '../unit-setup.mjs'

//對拍工具: 未給unit選項時, 現行src與基準版src之全部輸出須逐位相同(規則帳本R-OPT-01)
//  用法: node test/tools/cmpOutputs.mjs <基準版src資料夾> [<待測src資料夾, 預設./src>]
//  基準版src之取得: 前一發布版以`npm pack w-trade-backtest@<版本>`解出之package/src, 或`git archive <commit> src`解出者
//  比對範圍: runStrategy(含unit為null與undefined)、runStrategies、快速評估(摘要、withOrders、預設設定、unit為null與undefined)、
//    loadKLinesTpSl之ordersFromBars(數種選項組合, 含unit為null與undefined)與其精簡摘要、calcOrders與calcOrdersRatio與calcOrdersSummary與calcOrdersSummarySimple與calcSummary(各單uTrade相異之手工訂單)
//  浮點以最短十進位字串序列化並區分-0, timeTest(執行當下時間)不比; 離開碼0代表0處不同
let dirBase = path.resolve(process.argv[2] || '')
let dirNew = path.resolve(process.argv[3] || './src')
if (!process.argv[2] || !fs.existsSync(path.join(dirBase, 'runStrategy.mjs'))) {
    console.log('用法: node test/tools/cmpOutputs.mjs <基準版src資料夾> [<待測src資料夾>]')
    process.exit(2)
}
let fdWork = path.resolve('./test/_tmp/cmpOutputs')

let names = ['runStrategy', 'runStrategies', 'buildStrategyFastSession', 'buildKLinesTpSl', 'loadKLinesTpSl', 'calcOrders', 'calcOrdersRatio', 'calcOrdersSummary', 'calcOrdersSummarySimple', 'calcSummary', 'ott']
let load = async (dir) => {
    let m = {}
    for (let n of names) {
        m[n] = (await import(pathToFileURL(path.join(dir, `${n}.mjs`)).href)).default
    }
    return m
}
let H = await load(dirBase)
let N = await load(dirNew)

//ser, 序列化(浮點以最短十進位字串, 區分-0, 保留undefined)
let ser = (v) => JSON.stringify(v, (k, x) => {
    if (typeof x === 'number') {
        return Object.is(x, -0) ? 'n-0' : `n${String(x)}`
    }
    if (x === undefined) {
        return 'u'
    }
    return x
})
let omitTime = (s) => {
    let o = { ...s }
    delete o.timeTest
    return o
}

let nCmp = 0
let nDiff = 0
let nBytes = 0
let diffs = []
let cmp = (tag, a, b) => {
    let sa = ser(a)
    let sb = ser(b)
    nCmp++
    nBytes += sa.length
    if (sa !== sb) {
        nDiff++
        if (diffs.length < 10) {
            diffs.push(tag)
        }
    }
}

fs.rmSync(fdWork, { recursive: true, force: true })
fs.mkdirSync(fdWork, { recursive: true })

let nCase = 150
let rngMeta = mulberry32(20261118)
let nOrdersTotal = 0
try {
    for (let i = 0; i < nCase; i++) {
        let seed = 1000 + i * 7919
        let rng = mulberry32(seed)
        let c0 = [100, 2000, 60000][i % 3]
        let cs = genRandomCase(rng, { c0 })
        let uTrade = [1, 22, 100, 7.5][Math.floor(rngMeta() * 4)]
        let uIni = [1000, 10000][Math.floor(rngMeta() * 2)]
        let rFee = [0.0005, 0.001][Math.floor(rngMeta() * 2)]
        let funGetSeries = async (key) => {
            if (key === 'ohlc') {
                return cs.arrOhlc
            }
            if (cs.serieses[key]) {
                return cs.serieses[key]
            }
            throw new Error(`invalid key[${key}]`)
        }
        let st = { uIni, uTrade, rTakeProfit: cs.tp, rStopLoss: cs.sl, rFee }
        let strategy = { mode: cs.mode, keyOhlc: 'ohlc', conds: cs.conds, settings: st }

        //runStrategy: 三種寫法(不給unit、unit為null、unit為undefined)之待測版皆須等於基準版
        let rH = await H.runStrategy(H.ott, strategy, funGetSeries)
        nOrdersTotal += rH.orders.length
        for (let [nm, extra] of [['plain', {}], ['unitNull', { unit: null }], ['unitUndef', { unit: undefined }]]) {
            let rN = await N.runStrategy(N.ott, { ...strategy, settings: { ...st, ...extra } }, funGetSeries)
            cmp(`#${i} runStrategy ${nm} orders`, rH.orders, rN.orders)
            cmp(`#${i} runStrategy ${nm} summary`, omitTime(rH.summary), omitTime(rN.summary))
        }
        for (let o of [{ withSummary: false }, { withCalcOrderProfitOrLoss: false }]) {
            let a = await H.runStrategy(H.ott, strategy, funGetSeries, o)
            let b = await N.runStrategy(N.ott, strategy, funGetSeries, o)
            cmp(`#${i} runStrategy opt ${ser(o)} orders`, a.orders, b.orders)
            cmp(`#${i} runStrategy opt ${ser(o)} summary`, omitTime(a.summary), omitTime(b.summary))
        }

        //runStrategies: 兩策略
        let sts = [
            { sid: 'a', mode: 'long', keyOhlc: 'ohlc', conds: cs.conds, settings: { ...st } },
            { sid: 'b', mode: 'short', keyOhlc: 'ohlc', conds: cs.conds, settings: { ...st, uTrade: uTrade * 2 } },
        ]
        let ssH = await H.runStrategies(H.ott, JSON.parse(JSON.stringify(sts)), funGetSeries)
        let ssN = await N.runStrategies(N.ott, JSON.parse(JSON.stringify(sts)), funGetSeries)
        cmp(`#${i} runStrategies orders`, ssH.orders, ssN.orders)
        cmp(`#${i} runStrategies summary`, omitTime(ssH.summary), omitTime(ssN.summary))

        //快速評估: 摘要、withOrders、預設設定、unit為null與undefined
        let sessH = H.buildStrategyFastSession(H.ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
        let sessN = N.buildStrategyFastSession(N.ott, { arrOhlc: cs.arrOhlc, mode: cs.mode, serieses: cs.serieses })
        let input = { conds: cs.conds, tp: cs.tp, sl: cs.sl }
        let stF = { uIni, uTrade, rFee }
        cmp(`#${i} fast summary`, sessH.evaluate({ ...input, settings: stF }), sessN.evaluate({ ...input, settings: stF }))
        cmp(`#${i} fast summary unitNull`, sessH.evaluate({ ...input, settings: stF }), sessN.evaluate({ ...input, settings: { ...stF, unit: null } }))
        cmp(`#${i} fast summary unitUndef`, sessH.evaluate({ ...input, settings: stF }), sessN.evaluate({ ...input, settings: { ...stF, unit: undefined } }))
        cmp(`#${i} fast withOrders`, sessH.evaluate({ ...input, settings: stF }, { withOrders: true }), sessN.evaluate({ ...input, settings: stF }, { withOrders: true }))
        cmp(`#${i} fast default settings`, sessH.evaluate(input), sessN.evaluate(input))
        cmp(`#${i} fast default settings withOrders`, sessH.evaluate(input, { withOrders: true }), sessN.evaluate(input, { withOrders: true }))

        //ordersFromBars: 以基準版之buildKLinesTpSl建快取, 兩邊各自載入
        let tpsl = [2, 3, 5][Math.floor(rngMeta() * 3)]
        let fd = path.join(fdWork, `c${i}`)
        let fdOhlc = path.join(fd, 'data-ohlc')
        let fdParam = path.join(fd, 'data-param')
        fs.mkdirSync(fdOhlc, { recursive: true })
        fs.mkdirSync(fdParam, { recursive: true })
        fs.writeFileSync(path.join(fdOhlc, 'ohlc.json'), JSON.stringify(cs.arrOhlc), 'utf8')
        let fpJson = path.join(fd, 'kltpsl.json')
        let ts = cs.arrOhlc[0].time
        let te = cs.arrOhlc[cs.arrOhlc.length - 1].time
        await H.buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'ohlc', ts, te, tps: [tpsl], modes: [cs.mode] })
        let tH = H.loadKLinesTpSl(fpJson)
        let tN = N.loadKLinesTpSl(fpJson)
        cmp(`#${i} load meta`, tH.meta, tN.meta)
        cmp(`#${i} load bars`, tH.bars, tN.bars)
        let ets = rH.orders.map((o) => o.timeStart)
        let allTimes = cs.arrOhlc.map((v) => v.time)
        let tMid = allTimes[Math.floor(allTimes.length / 2)]
        for (let [nm, ev, o, oN] of [
            ['opt', ets, { uTrade, uIni, rFee }, {}],
            ['optUnitNull', ets, { uTrade, uIni, rFee }, { unit: null }],
            ['optUnitUndef', ets, { uTrade, uIni, rFee }, { unit: undefined }],
            ['default', ets, {}, {}],
            ['maxExit+skipSort', ets, { uTrade, uIni, rFee, maxExitTime: tMid, skipSort: true }, {}],
            ['allTimes', allTimes, { uTrade, uIni, rFee }, {}],
        ]) {
            let a = tH.ordersFromBars(cs.mode, tpsl, ev, o)
            let b = tN.ordersFromBars(cs.mode, tpsl, ev, { ...o, ...oN })
            cmp(`#${i} ordersFromBars ${nm}`, a, b)
            cmp(`#${i} ordersFromBars ${nm} summarySimple`, H.calcOrdersSummarySimple(H.ott, uIni, a, ts, te), N.calcOrdersSummarySimple(N.ott, uIni, b, ts, te))
        }

        //calcOrders等: 各單uTrade相異之手工訂單
        let mkOrders = () => rH.orders.map((o, k) => {
            let u = 10 + k * 3.7
            return {
                mode: o.mode,
                timeStart: o.timeStart,
                priceStart: o.priceStart,
                uTrade: u,
                rTakeProfit: o.rTakeProfit,
                priceTakeProfit: o.priceTakeProfit,
                rStopLoss: o.rStopLoss,
                priceStopLoss: o.priceStopLoss,
                timeEnd: '',
                priceEnd: '',
                modeResult: '',
                rFee: o.rFee,
                uFee: o.rFee * u,
            }
        })
        let oH = H.calcOrdersRatio(H.ott, await H.calcOrders(cs.arrOhlc, mkOrders(), { uIni }))
        let oN = N.calcOrdersRatio(N.ott, await N.calcOrders(cs.arrOhlc, mkOrders(), { uIni }))
        cmp(`#${i} calcOrders+ratio`, oH, oN)
        cmp(`#${i} calcOrdersSummary`, H.calcOrdersSummary(H.ott, uIni, oH, ts, te), N.calcOrdersSummary(N.ott, uIni, oN, ts, te))
        cmp(`#${i} calcOrdersSummarySimple(manual)`, H.calcOrdersSummarySimple(H.ott, uIni, oH, ts, te), N.calcOrdersSummarySimple(N.ott, uIni, oN, ts, te))
        cmp(`#${i} calcSummary`, omitTime(await H.calcSummary(H.ott, uIni, oH, ts, te)), omitTime(await N.calcSummary(N.ott, uIni, oN, ts, te)))
    }
}
finally {
    fs.rmSync(fdWork, { recursive: true, force: true })
    try {
        fs.rmdirSync(path.dirname(fdWork)) //test/_tmp為空時一併移除(非空則保留, 不影響他測試)
    }
    catch (err) {
        //非空或不存在, 略過
    }
}
console.log(`對拍: ${nCase}案(訂單總數${nOrdersTotal}), 比對${nCmp}項, 序列化${nBytes}位元組, 不同${nDiff}項`)
if (diffs.length > 0) {
    console.log('不同之項(至多10):', diffs)
}
process.exit(nDiff === 0 ? 0 : 1)
