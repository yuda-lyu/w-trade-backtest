import map from 'lodash-es/map.js'
import isestr from 'wsemi/src/isestr.mjs'


/**
 * 計算各已平倉訂單之持倉天數與等效日盈虧比例
 *
 * dayHold以timeStart與timeEnd之日期差+1計算，rProfitOrLossDay為(1+rProfitOrLoss)^(1/dayHold)-1
 * modeResult非有效字串(未平倉)之訂單不計算
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-tdbacktest/blob/master/test/unit-WDataTdbacktest.test.mjs Github}
 * @function
 * @param {Function} ott 輸入時區時間函數，傳入時間字串回傳dayjs時間物件(可用src/ott.mjs或自行以dayjs包裝)
 * @param {Array} orders 輸入已結算訂單陣列，各元素需含modeResult、timeStart、timeEnd、rProfitOrLoss欄位
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
 */
let calcOrdersRatio = (ott, orders) => {

    //計算各單持倉天數, 盈虧比例, 等效日盈虧比例
    orders = map(orders, (o) => {

        //未平倉訂單不計算
        if (!isestr(o.modeResult)) {
            return o
        }

        //dayHold, 持倉天數
        let ts = ott(o.timeStart)
        let te = ott(o.timeEnd)
        let ds = ts.format('YYYY-MM-DD')
        let de = te.format('YYYY-MM-DD')
        let tcs = ott(ds, 'YYYY-MM-DD')
        let tce = ott(de, 'YYYY-MM-DD')
        let dayHold = tce.diff(tcs, 'day') + 1
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
