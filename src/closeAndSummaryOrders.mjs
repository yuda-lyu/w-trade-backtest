import path from 'path'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import ispnum from 'wsemi/src/ispnum.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import cint from 'wsemi/src/cint.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsWriteJson from 'wsemi/src/fsWriteJson.mjs'
import WDataTdprovide from 'w-data-tdprovide/src/WDataTdprovide.mjs'
import calcOrders from './calcOrders.mjs'
import calcSummary from './calcSummary.mjs'
import genReportCore from './genReportCore.mjs'
import { parseBarTime } from './barTime.mjs'


/**
 * 結算下單清單並輸出訂單、摘要與報告檔案
 *
 * 以w-data-tdprovide讀取fdOhlc與fdParam資料夾數據，依timeOhlcStart至timeOhlcEnd範圍取keyOhlc之K線序列
 * 經calcOrders結算ordersSubmit與calcSummary統計後，輸出orders.json、summary.json、report.html至fdTest資料夾
 * 區間檢查: 未給opt.intervalSec時timeOhlcStart至timeOhlcEnd之時數(截斷為整數小時)須為4之倍數；給opt.intervalSec時兩者相差之毫秒數須為opt.intervalSec×1000之整數倍(1小時、日線等任何週期；不檢查與K線資料之實際間距)，不合即reject(訊息為`invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of 4 hours`或`… of opt.intervalSec seconds`)
 * opt.intervalSec與opt.timeBasis另交給calcSummary(timeBasis為'span'時dayHold、btDays及其衍生欄位改依每根時長計，見calcOrdersRatio與calcOrdersSummary；此時timeOhlcEnd須為末根K線之開盤時刻，傳入窗之結束時刻會多算一根)；未給或'open'時摘要不變，只給opt.intervalSec亦不變
 * fdOhlc或fdParam非資料夾、uIni非正數、timeOhlcStart或timeOhlcEnd非有效字串或區間檢查不合、opt.intervalSec給了而非60之倍數之正整數或大於31536000(數字或整數字串)、opt.timeBasis給了而非'open'或'span'、timeBasis為'span'而未給opt.intervalSec時reject，且先於讀取數據與寫檔
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {Function} ott 輸入時區時間函數，傳入時間字串回傳dayjs時間物件(可用src/ott.mjs或自行以dayjs包裝)
 * @param {String} fdOhlc 輸入儲存K線(ohlc)序列資料夾字串，各序列以`${key}.json`儲存
 * @param {String} fdParam 輸入儲存指標參數序列資料夾字串
 * @param {Number} uIni 輸入初始資金正數
 * @param {String} timeOhlcStart 輸入回測起始秒時間字串
 * @param {String} timeOhlcEnd 輸入回測結束秒時間字串
 * @param {String} keyOhlc 輸入K線序列key字串
 * @param {Array} ordersSubmit 輸入下單陣列(格式同calcOrders之orders)
 * @param {String} fdTest 輸入輸出結果資料夾字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.writeOrders=true] 輸入是否輸出orders.json布林值，預設true
 * @param {Boolean} [opt.writeSummary=true] 輸入是否輸出summary.json布林值，預設true
 * @param {Boolean} [opt.writeReport=true] 輸入是否輸出report.html布林值，預設true
 * @param {Number|String} [opt.intervalSec=null] 輸入每根K線之秒數，60之倍數之正整數且不大於31536000(如1hr為3600、4hr為14400、1day為86400)，預設null(未給，區間檢查為4小時之倍數)
 * @param {String} [opt.timeBasis='open'] 輸入時間口徑字串，'open'為以K線開盤時刻標籤計，'span'為計入每根K線之時距(須給opt.intervalSec)，預設'open'
 * @returns {Promise} 回傳Promise，無resolve值，於fdTest輸出結果檔案
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
 * //建立數據資料夾, fdOhlc放K線序列, fdParam放指標參數序列
 * fs.mkdirSync('./data-ohlc', { recursive: true })
 * fs.mkdirSync('./data-param', { recursive: true })
 * fs.writeFileSync('./data-ohlc/btc.json', JSON.stringify(arrOhlc), 'utf8')
 *
 * let ordersSubmit = [{
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
 * await closeAndSummaryOrders(ott, './data-ohlc', './data-param', 1000, '2020-01-01T00:00:00', '2020-01-01T20:00:00', 'btc', ordersSubmit, './result')
 * console.log(fs.readdirSync('./result'))
 * // => [ 'orders.json', 'report.html', 'summary.json' ]
 *
 */
let closeAndSummaryOrders = async (ott, fdOhlc, fdParam, uIni, timeOhlcStart, timeOhlcEnd, keyOhlc, ordersSubmit, fdTest, opt = {}) => {

    if (!fsIsFolder(fdOhlc)) {
        throw new Error(`fdOhlc[${fdOhlc}] is not a forder`)
    }
    if (!fsIsFolder(fdParam)) {
        throw new Error(`fdParam[${fdParam}] is not a forder`)
    }
    if (!ispnum(uIni)) {
        throw new Error(`uIni[${uIni}] is not a positive number`)
    }
    if (!isestr(timeOhlcStart)) {
        throw new Error(`invalid timeOhlcStart[${timeOhlcStart}]`)
    }
    if (!isestr(timeOhlcEnd)) {
        throw new Error(`invalid timeOhlcEnd[${timeOhlcEnd}]`)
    }
    if (!isestr(keyOhlc)) {
        throw new Error(`invalid keyOhlc[${keyOhlc}]`)
    }
    if (!isarr(ordersSubmit)) {
        throw new Error(`invalid ordersSubmit[${ordersSubmit}]`)
    }
    if (!isestr(fdTest)) {
        throw new Error(`invalid fdTest[${fdTest}]`)
    }

    //bt, 每根時長與時間口徑, 給了而無效於此throw(先於讀取數據與寫檔)
    let bt = parseBarTime(opt, 'opt')

    let writeOrders = get(opt, 'writeOrders', true)
    let writeSummary = get(opt, 'writeSummary', true)
    let writeReport = get(opt, 'writeReport', true)

    let wdp = WDataTdprovide(fdOhlc, fdParam)

    //ts, te
    let ts = ott(timeOhlcStart)
    let te = ott(timeOhlcEnd)

    //區間檢查, 給intervalSec時兩時刻相差之毫秒數須為每根時長之整數倍, 未給時維持現行(截斷之時數須為4之倍數)
    if (bt.intervalSec !== null) {
        if ((te.valueOf() - ts.valueOf()) % (bt.intervalSec * 1000) !== 0) {
            throw new Error(`invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of opt.intervalSec seconds`)
        }
    }
    else {

        //td
        let td = te.diff(ts, 'hour')
        // console.log('td', td)

        //m
        let m = td / 4
        if (m !== cint(m)) {
            throw new Error(`invalid timeOhlcEnd: must be timeOhlcStart plus a multiple of 4 hours`)
        }
        // console.log('m', m)

    }

    //funGetSeries
    let funGetSeries = await wdp.buildGetTimeSeriesByTimeRange(timeOhlcStart, timeOhlcEnd)

    //arrOhlc
    let arrOhlc = await funGetSeries(keyOhlc)
    // console.log('arrOhlc', arrOhlc, last(arrOhlc))

    //ordersClose
    let ordersClose = await calcOrders(arrOhlc, ordersSubmit, { uIni })
    // console.log('ordersClose', ordersClose)

    //summary
    let summary = await calcSummary(ott, uIni, ordersClose, timeOhlcStart, timeOhlcEnd, bt)
    console.log('summary', summary, size(ordersClose))

    //r
    let r = {
        name: `全部策略`,
        orders: ordersClose,
        summary,
    }

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

        //genReportCore
        genReportCore(r, fpHtml)

    }

}


export default closeAndSummaryOrders
