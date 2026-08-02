import each from 'lodash-es/each.js'
import get from 'lodash-es/get.js'
import sortBy from 'lodash-es/sortBy.js'
import dig from 'wsemi/src/dig.mjs'
import haskey from 'wsemi/src/haskey.mjs'


/**
 * 結算訂單，依K線序列判斷各下單之止盈止損觸發並計算盈虧
 *
 * 各單僅檢查time大於timeStart之K棒，long以Low<=priceStopLoss先判止損、High>=priceTakeProfit判止盈，short以High>=priceStopLoss先判止損、Low<=priceTakeProfit判止盈
 * long盈虧為uTrade*(priceEnd/priceStart)-uTrade-2*uFee，short盈虧為(priceStart-priceEnd)*(uTrade/priceStart)-2*uFee
 * 依timeStart排序逐單累計uCumuProfitOrLoss與uEquity(自uIni起算)，modeResult為盈虧<0時'loss'否則'profit'，未觸發止盈止損者維持原單(未平倉)
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {Array} arrOhlc 輸入K線陣列，各元素需含time、High、Low欄位
 * @param {Array} orders 輸入下單陣列，各元素需含mode('long'或'short')、timeStart、priceStart、uTrade、priceTakeProfit、priceStopLoss、uFee欄位
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} [opt.uIni=1000] 輸入初始資金數字，預設1000
 * @returns {Promise} 回傳Promise，resolve為結算後訂單陣列
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
 * let orders = [{
 *     mode: 'long',
 *     timeStart: '2020-01-01T00:00:00',
 *     priceStart: 100,
 *     uTrade: 100,
 *     priceTakeProfit: 105,
 *     priceStopLoss: 97,
 *     timeEnd: '',
 *     priceEnd: '',
 *     modeResult: '',
 *     uFee: 0.05,
 * }]
 *
 * calcOrders(arrOhlc, orders, { uIni: 1000 })
 *     .then((rs) => {
 *         console.log(rs[0])
 *         // => {
 *         //   mode: 'long',
 *         //   timeStart: '2020-01-01T00:00:00',
 *         //   priceStart: 100,
 *         //   uTrade: 100,
 *         //   priceTakeProfit: 105,
 *         //   priceStopLoss: 97,
 *         //   timeEnd: '2020-01-01T04:00:00',
 *         //   priceEnd: 105,
 *         //   modeResult: 'profit',
 *         //   uFee: 0.05,
 *         //   uProfitOrLoss: 4.9,
 *         //   rProfitOrLoss: 0.049,
 *         //   uCumuProfitOrLoss: 4.9,
 *         //   rCumuProfitOrLoss: '0.49%',
 *         //   uEquity: 1004.9
 *         // }
 *     })
 *
 */
let calcOrders = async(arrOhlc, orders, opt = {}) => {

    //sortBy, 已或未平倉訂單一定有timeStart欄位
    orders = sortBy(orders, 'timeStart')

    //uIni
    let uIni = get(opt, 'uIni', 1000)

    //kpOhlc
    let kpOhlc = {}
    each(arrOhlc, (v) => {
        // console.log('v', v)
        //   time: '2025-10-31T12:00:00',
        //   Open: 3829.16,
        //   High: 3873.68,
        //   Low: 3821.67,
        //   Close: 3831.49,
        //   Volumn: 56050.6433,
        //   CloseTime: '2025-10-31T15:59:59',
        //   QuoteAssetVolume: 215591315.444694,
        //   NumberOfTrades: 634069,
        //   TakerBuyBaseAssetVolume: 28908.4413,
        //   TakerBuyQuoteAssetVolume: 111187066.78764
        kpOhlc[v['time']] = v
    })
    // console.log('kpOhlc', kpOhlc)

    //kpOrders
    let kpOrders = {}
    let uEquity = uIni
    let uCumuProfitOrLoss = 0
    each(orders, (o, ko) => {

        each(kpOhlc, (g) => {

            //check, 小於等於下單時間不計算
            if (g['time'] <= o.timeStart) {
                delete kpOhlc[g['time']]
                return true //跳出換下一個
            }
            // console.log('size(kpOhlc)', size(kpOhlc))

            if (o.mode === 'long') {

                if (g.Low <= o.priceStopLoss) { //先偵測出現止損
                    //止損
                    o.timeEnd = g['time']
                    o.priceEnd = o.priceStopLoss
                    o.uProfitOrLoss = (o.uTrade * (o.priceEnd / o.priceStart)) - o.uTrade - 2 * o.uFee //須扣除手續費
                    o.rProfitOrLoss = o.uProfitOrLoss / o.uTrade
                    uCumuProfitOrLoss += o.uProfitOrLoss
                    o.uCumuProfitOrLoss = uCumuProfitOrLoss
                    o.rCumuProfitOrLoss = dig((o.uCumuProfitOrLoss / uIni) * 100, 2) + '%' //單位為%
                    uEquity += o.uProfitOrLoss
                    o.uEquity = uEquity
                    o.modeResult = o.uProfitOrLoss < 0 ? 'loss' : 'profit'
                    kpOrders[ko] = o
                    return false //跳出
                }
                if (g.High >= o.priceTakeProfit) { //後偵測出現止盈
                    //止盈
                    o.timeEnd = g['time']
                    o.priceEnd = o.priceTakeProfit
                    o.uProfitOrLoss = (o.uTrade * (o.priceEnd / o.priceStart)) - o.uTrade - 2 * o.uFee //須扣除手續費
                    o.rProfitOrLoss = o.uProfitOrLoss / o.uTrade
                    uCumuProfitOrLoss += o.uProfitOrLoss
                    o.uCumuProfitOrLoss = uCumuProfitOrLoss
                    o.rCumuProfitOrLoss = dig((o.uCumuProfitOrLoss / uIni) * 100, 2) + '%' //單位為%
                    uEquity += o.uProfitOrLoss
                    o.uEquity = uEquity
                    o.modeResult = o.uProfitOrLoss < 0 ? 'loss' : 'profit'
                    kpOrders[ko] = o
                    return false //跳出
                }

            }
            else { //short

                if (g.High >= o.priceStopLoss) { //先偵測出現止損
                    //止損
                    o.timeEnd = g['time']
                    o.priceEnd = o.priceStopLoss
                    o.uProfitOrLoss = (o.priceStart - o.priceEnd) * (o.uTrade / o.priceStart) - 2 * o.uFee //須扣除手續費
                    o.rProfitOrLoss = o.uProfitOrLoss / o.uTrade
                    uCumuProfitOrLoss += o.uProfitOrLoss
                    o.uCumuProfitOrLoss = uCumuProfitOrLoss
                    o.rCumuProfitOrLoss = dig((o.uCumuProfitOrLoss / uIni) * 100, 2) + '%' //單位為%
                    uEquity += o.uProfitOrLoss
                    o.uEquity = uEquity
                    o.modeResult = o.uProfitOrLoss < 0 ? 'loss' : 'profit'
                    kpOrders[ko] = o
                    return false //跳出
                }
                if (g.Low <= o.priceTakeProfit) { //後偵測出現止盈
                    //止盈
                    o.timeEnd = g['time']
                    o.priceEnd = o.priceTakeProfit
                    o.uProfitOrLoss = (o.priceStart - o.priceEnd) * (o.uTrade / o.priceStart) - 2 * o.uFee //須扣除手續費
                    o.rProfitOrLoss = o.uProfitOrLoss / o.uTrade
                    uCumuProfitOrLoss += o.uProfitOrLoss
                    o.uCumuProfitOrLoss = uCumuProfitOrLoss
                    o.rCumuProfitOrLoss = dig((o.uCumuProfitOrLoss / uIni) * 100, 2) + '%' //單位為%
                    uEquity += o.uProfitOrLoss
                    o.uEquity = uEquity
                    o.modeResult = o.uProfitOrLoss < 0 ? 'loss' : 'profit'
                    kpOrders[ko] = o
                    return false //跳出
                }

            }

        })

    })
    // console.log('kpOrders', kpOrders)

    if (true) {
        let _orders = []
        each(orders, (o, ko) => {
            // console.log('o', o)
            let oo = null
            if (haskey(kpOrders, ko)) {
                oo = kpOrders[ko]
            }
            else {
                oo = o
            }
            // console.log('oo', oo)
            _orders.push(oo)
        })
        orders = _orders
    }

    return orders
}


export default calcOrders
