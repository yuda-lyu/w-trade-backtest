import flatten from 'lodash-es/flatten.js'
import get from 'lodash-es/get.js'
import isNumber from 'lodash-es/isNumber.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import sortBy from 'lodash-es/sortBy.js'
import isestr from 'wsemi/src/isestr.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import runStrategy from './runStrategy.mjs'
import calcSummary from './calcSummary.mjs'


/**
 * 執行多策略回測
 *
 * 逐策略呼叫runStrategy(withSummary:false)，各單附加策略sid後合併並依timeStart排序
 * 以各策略settings.uIni總和為初始資金呼叫calcSummary統計合併摘要
 * 個別策略執行失敗(如時間點無參數無法下單)時強制略過
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-tdbacktest/blob/master/test/unit-WDataTdbacktest.test.mjs Github}
 * @function
 * @param {Function} ott 輸入時區時間函數，傳入時間字串回傳dayjs時間物件(可用src/ott.mjs或自行以dayjs包裝)
 * @param {Array} strategies 輸入策略陣列，各元素需含sid與runStrategy之strategy欄位
 * @param {Function} funGetSeries 輸入序列查詢async函數，依key回傳時間序列陣列
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.withCalcOrderProfitOrLoss=true] 輸入是否經calcOrders結算訂單布林值，預設true
 * @param {Boolean} [opt.withSummary=true] 輸入是否計算統計摘要布林值，預設true
 * @returns {Promise} 回傳Promise，resolve為{orders,summary}物件
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
 * let funGetSeries = async (key) => {
 *     if (key === 'btc') {
 *         return arrOhlc
 *     }
 *     if (key === 'sig') {
 *         return arrSig
 *     }
 *     throw new Error(`invalid key[${key}]`)
 * }
 *
 * let settings = { uIni: 1000, uTrade: 100, rTakeProfit: 0.05, rStopLoss: 0.03, rFee: 0.0005 }
 * let strategies = [
 *     { sid: 's1', mode: 'long', keyOhlc: 'btc', conds: [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }], settings },
 *     { sid: 's2', mode: 'short', keyOhlc: 'btc', conds: [{ key: 'sig', sym: '<', th: 0.5, opr: 'and' }], settings },
 * ]
 *
 * let rr = await runStrategies(ott, strategies, funGetSeries)
 * console.log(rr.orders.map((o) => `${o.sid} ${o.timeStart} ${o.mode} ${o.modeResult || 'unsettled'}`))
 * // => [
 * //   's1 2020-01-01T00:00:00 long profit',
 * //   's2 2020-01-01T04:00:00 short profit',
 * //   's1 2020-01-01T08:00:00 long loss',
 * //   's2 2020-01-01T12:00:00 short loss',
 * //   's2 2020-01-01T16:00:00 short loss',
 * //   's2 2020-01-01T20:00:00 short unsettled'
 * // ]
 * console.log(rr.summary.uIni, rr.summary.numTrade, rr.summary.rWin)
 * // => 2000 6 40.00%
 *
 */
let runStrategies = async (ott, strategies, funGetSeries, opt = {}) => {

    //withCalcOrderProfitOrLoss
    let withCalcOrderProfitOrLoss = get(opt, 'withCalcOrderProfitOrLoss', true)

    //withSummary
    let withSummary = get(opt, 'withSummary', true)

    //uIniAll, ordersAll
    let uIniAll = 0
    let ordersAll = []
    let r = null
    await pmSeries(strategies, async(strategy, k) => {

        //有些策略因為時間點無參數故無法計算, 代表無法下單, 故強制略過
        try {

            //runStrategy
            r = await runStrategy(ott, strategy, funGetSeries, { withCalcOrderProfitOrLoss, withSummary: false })

            //uIni
            let uIni = get(strategy, 'settings.uIni', '')
            if (!isNumber(uIni)) {
                throw new Error(`uIni[${uIni}] is not a number`)
            }
            // console.log('      ', 'uIni =', uIni, 'numTrade =', strategy.summary.numTrade)

            //累加初始金額(本金)
            uIniAll += uIni

            //add sid, push
            if (size(r.orders) >= 1) {

                //各單額外儲存策略sid
                r.orders = map(r.orders, (o) => {
                    o.sid = strategy.sid
                    return o
                })

                //push
                ordersAll.push(r.orders)

            }

        }
        catch (err) {
            // console.log(err)
        }

    })
    ordersAll = flatten(ordersAll)
    // console.log('ordersAll', ordersAll)

    //sortBy
    if (size(ordersAll) >= 2) {
        ordersAll = sortBy(ordersAll, 'timeStart')
    }
    // console.log('size(ordersAll)', size(ordersAll))

    //timeOhlcStart, timeOhlcEnd
    let timeOhlcStart = get(r, 'summary.timeOhlcStart', '') //各策略ohlc起訖時間皆相同, 取最後r內的timeOhlcStart來使用
    let timeOhlcEnd = get(r, 'summary.timeOhlcEnd', '') //各策略ohlc起訖時間皆相同, 取最後r內的timeOhlcEnd來使用

    //check
    if (!isestr(timeOhlcStart)) {
        throw new Error(`invalid timeOhlcStart`)
    }
    if (!isestr(timeOhlcEnd)) {
        throw new Error(`invalid timeOhlcEnd`)
    }

    //summary
    let summary = {
        timeTest: ott().format('YYYY-MM-DDTHH:mm:ssZ'),
        timeOhlcStart,
        timeOhlcEnd,
    }

    //withSummary
    if (withSummary) {
        summary = await calcSummary(ott, uIniAll, ordersAll, timeOhlcStart, timeOhlcEnd)
    }

    //rr
    let rr = {
        orders: ordersAll,
        summary,
    }

    return rr
}

export default runStrategies

