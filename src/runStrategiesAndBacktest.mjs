import path from 'path'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import isearr from 'wsemi/src/isearr.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsWriteJson from 'wsemi/src/fsWriteJson.mjs'
import WDataTdprovide from 'w-data-tdprovide/src/WDataTdprovide.mjs'
import runStrategies from './runStrategies.mjs'
import genReportCore from './genReportCore.mjs'


/**
 * 執行多策略回測並輸出訂單、摘要與報告檔案
 *
 * 以w-data-tdprovide讀取fdOhlc與fdParam資料夾數據，建立timeStart至timeEnd範圍之序列查詢函數後執行runStrategies
 * 合併結果命名為'全部策略'，並輸出orders.json、summary.json、report.html至fdTest資料夾
 * fdOhlc或fdParam非資料夾、strategies非有效陣列時throw
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {Function} ott 輸入時區時間函數，傳入時間字串回傳dayjs時間物件(可用src/ott.mjs或自行以dayjs包裝)
 * @param {String} fdOhlc 輸入儲存K線(ohlc)序列資料夾字串，各序列以`${key}.json`儲存
 * @param {String} fdParam 輸入儲存指標參數序列資料夾字串
 * @param {Array} strategies 輸入策略陣列，各元素需含sid與runStrategy之strategy欄位
 * @param {String} timeStart 輸入回測起始秒時間字串
 * @param {String} timeEnd 輸入回測結束秒時間字串
 * @param {String} fdTest 輸入輸出結果資料夾字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.writeOrders=true] 輸入是否輸出orders.json布林值，預設true
 * @param {Boolean} [opt.writeSummary=true] 輸入是否輸出summary.json布林值，預設true
 * @param {Boolean} [opt.writeReport=true] 輸入是否輸出report.html布林值，預設true
 * @returns {Promise} 回傳Promise，resolve為{name,orders,summary}物件，另於fdTest輸出結果檔案
 * @example
 *
 * import fs from 'fs'
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
 * //建立數據資料夾, fdOhlc放K線序列, fdParam放指標參數序列
 * fs.mkdirSync('./data-ohlc', { recursive: true })
 * fs.mkdirSync('./data-param', { recursive: true })
 * fs.writeFileSync('./data-ohlc/btc.json', JSON.stringify(arrOhlc), 'utf8')
 * fs.writeFileSync('./data-param/sig.json', JSON.stringify(arrSig), 'utf8')
 *
 * let settings = { uIni: 1000, uTrade: 100, rTakeProfit: 0.05, rStopLoss: 0.03, rFee: 0.0005 }
 * let strategies = [
 *     { sid: 's1', mode: 'long', keyOhlc: 'btc', conds: [{ key: 'sig', sym: '>', th: 0.5, opr: 'and' }], settings },
 *     { sid: 's2', mode: 'short', keyOhlc: 'btc', conds: [{ key: 'sig', sym: '<', th: 0.5, opr: 'and' }], settings },
 * ]
 *
 * let r = await runStrategiesAndBacktest(ott, './data-ohlc', './data-param', strategies, '2020-01-01T00:00:00', '2020-01-01T20:00:00', './result')
 * console.log(r.name, r.summary.uIni, r.summary.numTrade, r.summary.rWin)
 * // => 全部策略 2000 6 40.00%
 * console.log(fs.readdirSync('./result'))
 * // => [ 'orders.json', 'report.html', 'summary.json' ]
 *
 */
let runStrategiesAndBacktest = async (ott, fdOhlc, fdParam, strategies, timeStart, timeEnd, fdTest, opt = {}) => {

    if (!fsIsFolder(fdOhlc)) {
        throw new Error(`fdOhlc[${fdOhlc}] is not a forder`)
    }
    if (!fsIsFolder(fdParam)) {
        throw new Error(`fdParam[${fdParam}] is not a forder`)
    }
    //check
    if (!isearr(strategies)) {
        throw new Error(`invalid strategies`)
    }

    let writeOrders = get(opt, 'writeOrders', true)
    let writeSummary = get(opt, 'writeSummary', true)
    let writeReport = get(opt, 'writeReport', true)

    //wdp
    let wdp = WDataTdprovide(fdOhlc, fdParam)

    //funGetSeries
    let funGetSeries = await wdp.buildGetTimeSeriesByTimeRange(timeStart, timeEnd)

    //runStrategies
    let r = await runStrategies(ott, strategies, funGetSeries, {})
    r.name = `全部策略`

    if (writeOrders) {

        //fnOrders
        let fnOrders = `orders.json`

        //fpOrders
        let fpOrders = path.resolve(fdTest, fnOrders)

        //fsWriteJson
        fsWriteJson(fpOrders, r.orders, { useFormat: true })

    }

    if (writeSummary) {

        //fnSummary
        let fnSummary = `summary.json`

        //fpSummary
        let fpSummary = path.resolve(fdTest, fnSummary)

        //stsm
        let stsm = {
            name: r.name,
            summary: r.summary,
        }
        // console.log('stsm', stsm)

        //fsWriteJson
        fsWriteJson(fpSummary, stsm, { useFormat: true })

        console.log('summary', r.summary, size(r.orders))
    }

    if (writeReport) {

        //fnHtml
        let fnHtml = `report.html`

        //fpHtml
        let fpHtml = path.resolve(fdTest, fnHtml)

        //genReport
        genReportCore(r, fpHtml)

    }

    return r
}


export default runStrategiesAndBacktest
