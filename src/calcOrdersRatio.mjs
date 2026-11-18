import map from 'lodash-es/map.js'
import isestr from 'wsemi/src/isestr.mjs'
import { parseBarTime, calcDayHoldSpan } from './barTime.mjs'


/**
 * 計算各已平倉訂單之持倉天數與等效日盈虧比例
 *
 * dayHold以timeStart與timeEnd之日期差+1計算，rProfitOrLossDay為(1+rProfitOrLoss)^(1/dayHold)-1
 * opt.timeBasis為'span'(須同時給opt.intervalSec)時dayHold改為進場棒收盤至出場棒收盤之時長(以日計、無條件進位、至少1日；為經過之時長而非根數，日線無缺根時持k根即k日，有缺根時為經過之日數)；未給或'open'時不變，只給opt.intervalSec亦不變
 * opt.intervalSec非60之倍數之正整數或大於31536000(數字或整數字串)、opt.timeBasis非'open'或'span'、或為'span'而未給opt.intervalSec時throw，且先於改寫任何訂單
 * modeResult非有效字串(未平倉)之訂單不計算
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {Function} ott 輸入時區時間函數，傳入時間字串回傳dayjs時間物件(可用src/ott.mjs或自行以dayjs包裝)
 * @param {Array} orders 輸入已結算訂單陣列，各元素需含modeResult、timeStart、timeEnd、rProfitOrLoss欄位
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number|String} [opt.intervalSec=null] 輸入每根K線之秒數，60之倍數之正整數且不大於31536000(如4hr為14400、1day為86400)，預設null(未給)
 * @param {String} [opt.timeBasis='open'] 輸入時間口徑字串，'open'為以K線開盤時刻標籤計，'span'為計入每根K線之時距(須給opt.intervalSec)，預設'open'
 * @returns {Array} 回傳附加dayHold與rProfitOrLossDay之訂單陣列
 * @example
 *
 * let orders = calcOrdersRatio(ott, [{
 *     modeResult: 'profit',
 *     timeStart: '2020-01-01T20:00:00',
 *     timeEnd: '2020-01-03T04:00:00',
 *     rProfitOrLoss: 0.331,
 * }])
 * console.log(orders[0])
 * // => {
 * //   modeResult: 'profit',
 * //   timeStart: '2020-01-01T20:00:00',
 * //   timeEnd: '2020-01-03T04:00:00',
 * //   rProfitOrLoss: 0.331,
 * //   dayHold: 3,
 * //   rProfitOrLossDay: 0.10000000000000009
 * // }
 *
 * //日線(每根86400秒)以timeBasis為'span'計: 次根出場持倉1日(未給時為日期差+1之2日)
 * let ordersDay = calcOrdersRatio(ott, [{
 *     modeResult: 'profit',
 *     timeStart: '2020-01-01T00:00:00',
 *     timeEnd: '2020-01-02T00:00:00',
 *     rProfitOrLoss: 0.05,
 * }], { intervalSec: 86400, timeBasis: 'span' })
 * console.log(ordersDay[0].dayHold, ordersDay[0].rProfitOrLossDay)
 * // => 1 0.050000000000000044
 *
 */
let calcOrdersRatio = (ott, orders, opt = {}) => {

    //bt, 每根時長與時間口徑, 給了而無效於此throw(先於改寫任何訂單)
    let bt = parseBarTime(opt, 'opt')

    //計算各單持倉天數, 盈虧比例, 等效日盈虧比例
    orders = map(orders, (o) => {

        //未平倉訂單不計算
        if (!isestr(o.modeResult)) {
            return o
        }

        //dayHold, 持倉天數; timeBasis為'span'時為進場棒收盤至出場棒收盤之時長(日, 無條件進位, 至少1日)
        let dayHold
        if (bt.timeBasis === 'span') {
            dayHold = calcDayHoldSpan(ott, o.timeStart, o.timeEnd)
        }
        else {
            let ts = ott(o.timeStart)
            let te = ott(o.timeEnd)
            let ds = ts.format('YYYY-MM-DD')
            let de = te.format('YYYY-MM-DD')
            let tcs = ott(ds, 'YYYY-MM-DD')
            let tce = ott(de, 'YYYY-MM-DD')
            dayHold = tce.diff(tcs, 'day') + 1
        }
        o.dayHold = dayHold
        // console.log('ds', ds, 'de', de, dayHold)

        //rProfitOrLossDay, 等效日盈虧比例(none)
        let rProfitOrLossDay = 0
        if ((1 + o.rProfitOrLoss) >= 0) {
            rProfitOrLossDay = Math.pow((1 + o.rProfitOrLoss), 1 / o.dayHold) - 1
        }
        // let rProfitOrLossDay = Math.pow((1 + o.rProfitOrLoss), 1 / o.dayHold) - 1

        o.rProfitOrLossDay = rProfitOrLossDay
        // console.log('rProfitOrLossDay', rProfitOrLossDay)

        return o
    })
    // console.log('orders', orders[size(orders) - 1], size(orders))

    return orders
}


export default calcOrdersRatio
