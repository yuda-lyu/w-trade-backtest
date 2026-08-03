import path from 'path'
import fs from 'fs'
import dig from 'wsemi/src/dig.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'


/**
 * 載入止盈止損先觸結果快取檔並提供訂單重建
 *
 * 讀取buildKLinesTpSl產出之快取json，提供ordersFromBars依指定mode與tpsl組合與進場時間陣列重建訂單陣列
 * 重建訂單之盈虧與累計欄位公式逐欄對齊calcOrders，可直接餵入calcOrdersSummary或calcOrdersSummarySimple
 * fpJson非有效字串或非檔案時throw
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {String} fpJson 輸入buildKLinesTpSl產出之快取json檔案路徑字串
 * @returns {Object} 回傳物件，內含meta(快取設定物件)、bars(以進場時間為key之結果物件)與ordersFromBars(mode, tpsl, entryTimes, opt)訂單重建函數，函數之opt可給uTrade(每單金額，預設1)、uIni(初始資金，預設1000)、rFee(手續費率，預設0.0005)、maxExitTime(出場時間大於等於此值之單視為未平倉，預設null)與skipSort(呼叫端保證entryTimes已升序時可省排序，預設false)，回傳訂單陣列，快取內查無之進場時間會被濾除，未結單各盈虧欄位留空
 * @example
 *
 * //fpJson為buildKLinesTpSl產出之快取檔
 * let r = loadKLinesTpSl('./cache/kltpsl.json')
 * console.log(r.meta.nBars)
 * // => 6
 *
 * let orders = r.ordersFromBars('long', 5, ['2020-01-01T00:00:00', '2020-01-01T12:00:00'], { uTrade: 100, uIni: 1000 })
 * console.log(orders.map((o) => `${o.timeStart} ${o.timeEnd || 'unsettled'} ${o.modeResult || '-'}`))
 * // => [
 * //   '2020-01-01T00:00:00 2020-01-01T04:00:00 profit',
 * //   '2020-01-01T12:00:00 unsettled -'
 * // ]
 * console.log(orders[0].priceStart, orders[0].priceEnd, orders[0].uProfitOrLoss, orders[0].uEquity)
 * // => 100 105 4.9 1004.9
 *
 */
let loadKLinesTpSl = (fpJson) => {

    //check
    if (!isestr(fpJson)) {
        throw new Error(`invalid fpJson`)
    }
    if (!fsIsFile(fpJson)) {
        throw new Error(`fpJson[${fpJson}] is not a file`)
    }

    let obj = JSON.parse(fs.readFileSync(path.resolve(fpJson), 'utf8'))
    let meta = obj.meta
    let bars = obj.bars

    let ordersFromBars = (mode, tpsl, entryTimes, opt = {}) => {
        let { uTrade = 1, uIni = 1000, rFee = 0.0005, maxExitTime = null, skipSort = false } = opt
        let k = `${mode}_${tpsl}`
        let tpr = tpsl / 100
        let uFee = rFee * uTrade

        //先建全部 order 物件(未結者欄位留空, 對齊 calcOrders 對未平倉單的處理)。
        //  skipSort: 呼叫端保證 entryTimes 已升序時省 [...].sort()(熱路徑省數千筆複製+排序); 預設 false 維持原行為。
        let ets = skipSort ? entryTimes : [...entryTimes].sort()
        let orders = ets.filter((t) => bars[t]).map((t) => {
            let c0 = bars[t].close
            return {
                mode,
                timeStart: t,
                priceStart: c0,
                uTrade,
                rTakeProfit: tpr,
                priceTakeProfit: mode === 'long' ? (1 + tpr) * c0 : (1 - tpr) * c0,
                rStopLoss: tpr,
                priceStopLoss: mode === 'long' ? (1 - tpr) * c0 : (1 + tpr) * c0,
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
        })

        //填已結單(公式對齊 d04 calcOrders)
        let uEquity = uIni
        let uCumu = 0
        for (let o of orders) {
            let r = bars[o.timeStart][k]
            if (!r || r.win < 0 || !r.timeEnd) {
                continue //未結 → 留空(計入 numTrade, 不計入已結績效)
            }
            if (maxExitTime && r.timeEnd >= maxExitTime) {
                continue //區段內尚未觸 → 留未平倉
            }
            o.timeEnd = r.timeEnd
            o.priceEnd = r.win === 1 ? o.priceTakeProfit : o.priceStopLoss
            o.uProfitOrLoss = o.mode === 'long'
                ? o.uTrade * (o.priceEnd / o.priceStart) - o.uTrade - 2 * o.uFee
                : (o.priceStart - o.priceEnd) * (o.uTrade / o.priceStart) - 2 * o.uFee
            o.rProfitOrLoss = o.uProfitOrLoss / o.uTrade
            uCumu += o.uProfitOrLoss
            o.uCumuProfitOrLoss = uCumu
            o.rCumuProfitOrLoss = dig((o.uCumuProfitOrLoss / uIni) * 100, 2) + '%'
            uEquity += o.uProfitOrLoss
            o.uEquity = uEquity
            o.modeResult = o.uProfitOrLoss < 0 ? 'loss' : 'profit'
        }

        return orders
    }

    return { meta, bars, ordersFromBars }
}


export default loadKLinesTpSl
