import get from 'lodash-es/get.js'
import dig from 'wsemi/src/dig.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import genKLinesTpSl from './genKLinesTpSl.mjs'
import calcOrdersSummarySimple from './calcOrdersSummarySimple.mjs'
import settleOrderPnl from './settleOrderPnl.mjs'


/**
 * 建立策略快速評估session，供求解熱路徑(如RGA/PSO目標函數)重複評估同一K線窗之不同條件組合
 *
 * 建置期一次攤提runStrategy每次呼叫都要重建的不變量: 各因子{time,param}序列轉為K棒對位Float64Array(缺值填NaN)、各(tp,sl)組合之first-touch預算表(genKLinesTpSl，惰性建置+Map快取)
 * 評估期單迴圈逐棒判斷conds觸發並沿calcOrders同式結算(settleOrderPnl)，摘要直接以calcOrdersSummarySimple計算，與官方全鏈(runStrategy→calcOrders→calcOrdersSummary)對應欄位嚴格相等
 * 觸發語義與runStrategy等價: 任一cond序列於該棒缺值(NaN)即整棒跳過(等同僅於全部cond序列皆有值之共同時間點判斷)、'and'組須全真且'or'組至少一真、sym為'>'比大於否則比小於
 * 序列param須為有限數值，缺值以該時間點不存在表示; opt.mode非'long'或'short'、arrOhlc或serieses無效時throw; evaluate之conds非有效陣列(含空陣列, 同runStrategy)或cond.key不在serieses時throw
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {Function} ott 輸入時區時間函數，傳入時間字串回傳dayjs時間物件(可用src/ott.mjs或自行以dayjs包裝)
 * @param {Object} opt 輸入設定物件
 * @param {Array} opt.arrOhlc 輸入K線陣列，各元素需含time(秒時間字串)、Close、High、Low欄位，且依時間由小至大排序，與runStrategy之funGetSeries(keyOhlc)同一份
 * @param {String} opt.mode 輸入交易方向字串，'long'或'short'
 * @param {Object} opt.serieses 輸入因子序列物件，key為因子名稱，value為{time,param}陣列，param須為有限數值
 * @param {Array} [opt.tpsls=[]] 輸入預建first-touch表之{tp,sl}陣列，未列組合於evaluate時惰性建置，預設[]
 * @returns {Object} 回傳session物件，內含evaluate({conds,tp,sl,settings},opt)評估函數，conds各元素為{key,sym,th,opr}(與runStrategy同構)，settings可給uIni(預設1000)、uTrade(預設1)、rFee(預設0.0005)，evaluate預設回傳calcOrdersSummarySimple同構摘要物件，evaluate之opt.withOrders為true時回傳{orders,summary}(orders與loadKLinesTpSl之ordersFromBars同構，供除錯對照之慢速路徑)
 * @example
 *
 * let arrOhlc = [
 *     { time: '2020-01-01T00:00:00', Open: 100, High: 101, Low: 99, Close: 100 },
 *     { time: '2020-01-01T04:00:00', Open: 100, High: 106, Low: 100, Close: 105 },
 *     { time: '2020-01-01T08:00:00', Open: 105, High: 107, Low: 102, Close: 103 },
 *     { time: '2020-01-01T12:00:00', Open: 103, High: 104, Low: 94, Close: 95 },
 *     { time: '2020-01-01T16:00:00', Open: 95, High: 98, Low: 92, Close: 93 },
 *     { time: '2020-01-01T20:00:00', Open: 93, High: 99, Low: 95, Close: 97 },
 * ]
 *
 * let arrSig = [
 *     { time: '2020-01-01T00:00:00', param: 1 },
 *     { time: '2020-01-01T04:00:00', param: 0 },
 *     { time: '2020-01-01T08:00:00', param: 1 },
 *     { time: '2020-01-01T12:00:00', param: 0 },
 *     { time: '2020-01-01T16:00:00', param: 0 },
 *     { time: '2020-01-01T20:00:00', param: 0 },
 * ]
 *
 * let session = buildStrategyFastSession(ott, {
 *     arrOhlc,
 *     mode: 'long',
 *     serieses: { sig: arrSig },
 * })
 *
 * let sm = session.evaluate({
 *     conds: [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }],
 *     tp: 0.05,
 *     sl: 0.03,
 *     settings: { uIni: 1000, uTrade: 100, rFee: 0.0005 },
 * })
 * console.log(sm.numTrade, sm.rWin, sm.uEquityFinal)
 * // => 2 50.00% 1001.8
 *
 */
let buildStrategyFastSession = (ott, opt = {}) => {

    //mode
    let mode = get(opt, 'mode', '')
    if (mode !== 'long' && mode !== 'short') {
        throw new Error(`invalid opt.mode[${mode}] not 'long' or 'short'`)
    }

    //arrOhlc
    let arrOhlc = get(opt, 'arrOhlc', null)
    if (!isearr(arrOhlc)) {
        throw new Error(`invalid opt.arrOhlc`)
    }

    //serieses
    let serieses = get(opt, 'serieses', null)
    if (!iseobj(serieses)) {
        throw new Error(`invalid opt.serieses`)
    }

    //n, time, C
    let n = arrOhlc.length
    let time = new Array(n)
    let C = new Float64Array(n)
    let kpTimeInd = new Map() //K棒時間→index
    for (let i = 0; i < n; i++) {
        let r = arrOhlc[i]
        time[i] = r.time
        C[i] = r.Close
        kpTimeInd.set(r.time, i)
    }

    //timeOhlcStart, timeOhlcEnd
    let timeOhlcStart = n > 0 ? time[0] : ''
    let timeOhlcEnd = n > 0 ? time[n - 1] : ''

    //kpAligned, 各因子序列轉K棒對位Float64Array(缺值填NaN), 序列中不屬K棒之時間點不影響觸發(runStrategy亦僅於K棒時間判斷)
    let kpAligned = {}
    for (let key of Object.keys(serieses)) {
        let arr = new Float64Array(n).fill(NaN)
        for (let v of serieses[key]) {
            let ind = kpTimeInd.get(v.time)
            if (ind !== undefined) {
                arr[ind] = v.param
            }
        }
        kpAligned[key] = arr
    }

    //kpFirstTouch, 各(tp,sl)組合之first-touch表快取(惰性建置)
    let kpFirstTouch = new Map()
    let getFirstTouch = (tp, sl) => {
        let k = `${tp}_${sl}`
        let ft = kpFirstTouch.get(k)
        if (!ft) {
            ft = genKLinesTpSl(arrOhlc, { tp, sl, mode }) //tp/sl無效時由genKLinesTpSl throw
            kpFirstTouch.set(k, ft)
        }
        return ft
    }

    //預建
    let tpsls = get(opt, 'tpsls', [])
    if (isearr(tpsls)) {
        for (let v of tpsls) {
            getFirstTouch(v.tp, v.sl)
        }
    }

    //evaluate
    let evaluate = (input = {}, optEv = {}) => {

        //conds, 空陣列同runStrategy一律throw(isearr對空陣列回false)
        let conds = get(input, 'conds', [])
        if (!isearr(conds)) {
            throw new Error(`invalid conds`)
        }

        //tp, sl
        let tp = get(input, 'tp', null)
        let sl = get(input, 'sl', null)

        //settings
        let st = get(input, 'settings', {})
        let uIni = get(st, 'uIni', 1000)
        let uTrade = get(st, 'uTrade', 1)
        let rFee = get(st, 'rFee', 0.0005)
        let uFee = rFee * uTrade

        //withOrders
        let withOrders = get(optEv, 'withOrders', false)

        //ft
        let ft = getFirstTouch(tp, sl)
        let win = ft.win
        let hold = ft.hold

        //cs, 條件預解析(sym預設'>'、th預設0、opr非'and'/'or'一律'and', 與runStrategy同)
        let cs = conds.map((cond) => {
            let key = get(cond, 'key', '')
            let arr = kpAligned[key]
            if (!arr) {
                throw new Error(`invalid cond.key[${key}] not in opt.serieses`)
            }
            let sym = get(cond, 'sym', '>')
            let th = get(cond, 'th', 0)
            let opr = get(cond, 'opr', null)
            if (opr !== 'and' && opr !== 'or') {
                opr = 'and'
            }
            return { arr, gt: sym === '>', th, isOr: opr === 'or' }
        })
        //orders, 逐棒判斷觸發與結算(依timeStart升序產生, 累計順序與calcOrders一致)
        let orders = []
        let uEquity = uIni
        let uCumu = 0
        for (let i = 0; i < n; i++) {

            //bTrigger, 任一cond於該棒缺值(NaN)即整棒跳過(等同runStrategy僅於全部cond序列皆有值之共同時間點判斷)
            //  'and'組須全真(空組無約束), 'or'組至少一真(無or組不約束), 與runStrategy合成邏輯同構
            let bSkip = false
            let okAnd = true
            let hasOr = false
            let okOr = false
            for (let c of cs) {
                let y = c.arr[i]
                if (Number.isNaN(y)) {
                    bSkip = true
                    break
                }
                let b = c.gt ? y > c.th : y < c.th
                if (c.isOr) {
                    hasOr = true
                    okOr = okOr || b
                }
                else {
                    okAnd = okAnd && b
                }
            }
            if (bSkip || !okAnd || (hasOr && !okOr)) {
                continue
            }

            //進場, 該棒Close
            let c0 = C[i]
            let w = win[i]

            //o, 訂單紀錄(預設精簡欄位供calcOrdersSummarySimple使用; withOrders時與ordersFromBars同構)
            let o
            if (withOrders) {
                o = {
                    mode,
                    timeStart: time[i],
                    priceStart: c0,
                    uTrade,
                    rTakeProfit: tp,
                    priceTakeProfit: mode === 'long' ? (1 + tp) * c0 : (1 - tp) * c0,
                    rStopLoss: sl,
                    priceStopLoss: mode === 'long' ? (1 - sl) * c0 : (1 + sl) * c0,
                    timeEnd: '',
                    priceEnd: '',
                    modeResult: '',
                    rFee,
                    uFee,
                    uProfitOrLoss: '',
                    rProfitOrLoss: '',
                    uCumuProfitOrLoss: '',
                    rCumuProfitOrLoss: '',
                    uEquity: '',
                    uTradeAll: '',
                    rTradeAll: '',
                }
            }
            else {
                o = {
                    timeStart: time[i],
                    timeEnd: '',
                    uTrade,
                    uProfitOrLoss: '',
                    uEquity: '',
                    modeResult: '',
                }
            }

            //結算(win>=0為已觸發, 未觸發者留空=未平倉, 計入numTrade不計入已結績效)
            if (w >= 0) {
                let priceEnd
                if (w === 1) {
                    priceEnd = mode === 'long' ? (1 + tp) * c0 : (1 - tp) * c0 //止盈線
                }
                else {
                    priceEnd = mode === 'long' ? (1 - sl) * c0 : (1 + sl) * c0 //止損線
                }
                let u = settleOrderPnl(mode, uTrade, c0, priceEnd, uFee)
                uCumu += u
                uEquity += u
                o.timeEnd = time[i + hold[i]]
                o.uProfitOrLoss = u
                o.uEquity = uEquity
                o.modeResult = u < 0 ? 'loss' : 'profit'
                if (withOrders) {
                    o.priceEnd = priceEnd
                    o.rProfitOrLoss = u / uTrade
                    o.uCumuProfitOrLoss = uCumu
                    o.rCumuProfitOrLoss = dig((uCumu / uIni) * 100, 2) + '%'
                }
            }

            //push
            orders.push(o)

        }

        //summary, 直接調用官方calcOrdersSummarySimple(orders已依timeStart升序故skipSort)
        let summary = calcOrdersSummarySimple(ott, uIni, orders, timeOhlcStart, timeOhlcEnd, { skipSort: true })

        //withOrders時回傳訂單陣列供除錯對照
        if (withOrders) {
            return { orders, summary }
        }

        return summary
    }

    return {
        evaluate,
    }
}


export default buildStrategyFastSession
