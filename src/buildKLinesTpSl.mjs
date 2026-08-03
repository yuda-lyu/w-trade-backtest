import path from 'path'
import fs from 'fs'
import isestr from 'wsemi/src/isestr.mjs'
import istime from 'wsemi/src/istime.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import WDataTdprovide from 'w-data-tdprovide/src/WDataTdprovide.mjs'
import genKLinesTpSl from './genKLinesTpSl.mjs'


/**
 * 建置各K線與各止盈止損組合之先觸結果快取檔
 *
 * 以w-data-tdprovide讀取fdOhlc與fdParam資料夾內keyOhlc序列，取ts至te範圍K線後，逐一組合modes與tps呼叫genKLinesTpSl
 * 各組合以`${mode}_${tpsl}`為key存入各根K線，win為1(止盈先觸)、0(止損先觸)或-1(至區間末仍未結)
 * timeEnd於建置時由hold位移換算為絕對時間，故下游查表即得而不需位置索引，未結者為null
 * 僅存win、timeEnd與各根close，盈虧由下游loadKLinesTpSl之ordersFromBars以close與手續費重算
 * fdOhlc或fdParam非資料夾、fpJson或opt.keyOhlc非有效字串、opt.ts或opt.te非時間字串時throw
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {String} fdOhlc 輸入儲存K線(ohlc)序列資料夾字串，各序列以`${key}.json`儲存
 * @param {String} fdParam 輸入儲存指標參數序列資料夾字串
 * @param {String} fpJson 輸入輸出快取json檔案路徑字串，資料夾不存在時自動建立
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} opt.keyOhlc 輸入K線序列key字串
 * @param {String} opt.ts 輸入起始秒時間字串
 * @param {String} opt.te 輸入結束秒時間字串
 * @param {Array} [opt.tps=[4,5,6,7,8,9,10]] 輸入止盈止損百分比數值陣列，如5代表止盈與止損皆5%，預設[4,5,6,7,8,9,10]
 * @param {Array} [opt.modes=['long','short']] 輸入交易方向字串陣列，預設['long','short']
 * @returns {Promise} 回傳Promise，resolve為{meta,bars}物件，meta內含keyOhlc、ts、te、tps、modes與nBars(K線根數)，bars以進場時間為key，各值內含close與各`${mode}_${tpsl}`之{win,timeEnd}，並同步寫出至fpJson
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
 * let r = await buildKLinesTpSl('./data-ohlc', './data-param', './cache/kltpsl.json', {
 *     keyOhlc: 'btc',
 *     ts: '2020-01-01T00:00:00',
 *     te: '2020-01-01T20:00:00',
 *     tps: [5],
 *     modes: ['long'],
 * })
 * console.log(r.meta)
 * // => {
 * //   keyOhlc: 'btc',
 * //   ts: '2020-01-01T00:00:00',
 * //   te: '2020-01-01T20:00:00',
 * //   tps: [ 5 ],
 * //   modes: [ 'long' ],
 * //   nBars: 6
 * // }
 * console.log(r.bars['2020-01-01T00:00:00'])
 * // => { close: 100, long_5: { win: 1, timeEnd: '2020-01-01T04:00:00' } }
 * console.log(r.bars['2020-01-01T12:00:00'])
 * // => { close: 95, long_5: { win: -1, timeEnd: null } }
 *
 */
let buildKLinesTpSl = async (fdOhlc, fdParam, fpJson, opt = {}) => {
    //一次性全建(訓練區間固定, 不需增量); 若日後要增量延長: 已結entry不動、未結entry用新OHLC重掃、新棒加key即可

    //check
    if (!fsIsFolder(fdOhlc)) {
        throw new Error(`fdOhlc[${fdOhlc}] is not a folder`)
    }
    if (!fsIsFolder(fdParam)) {
        throw new Error(`fdParam[${fdParam}] is not a folder`)
    }
    if (!isestr(fpJson)) {
        throw new Error(`invalid fpJson`)
    }

    let provideData = WDataTdprovide(fdOhlc, fdParam) //數據資料夾由呼叫端顯式指定

    let {
        keyOhlc,
        ts,
        te,
        tps = [4, 5, 6, 7, 8, 9, 10],
        modes = ['long', 'short'],
    } = opt

    //check
    if (!isestr(keyOhlc)) {
        throw new Error(`invalid opt.keyOhlc`)
    }
    if (!istime(ts)) {
        throw new Error(`invalid opt.ts`)
    }
    if (!istime(te)) {
        throw new Error(`invalid opt.te`)
    }

    //OHLC(訓練區間)
    let arrOhlc = await provideData.getTimeSeriesByTimeRange(keyOhlc, ts, te)
    let n = arrOhlc.length
    let time = arrOhlc.map((r) => r.time)

    //每根 close(各 mode_tpsl 共用)
    let bars = {}
    for (let i = 0; i < n; i++) {
        bars[time[i]] = { close: arrOhlc[i].Close }
    }

    //各 (mode, tpsl) 跑 first-touch → 填 { win, timeEnd }
    for (let mode of modes) {
        for (let tpsl of tps) {
            let { win, hold } = genKLinesTpSl(arrOhlc, { tp: tpsl / 100, sl: tpsl / 100, mode })
            let k = `${mode}_${tpsl}`
            for (let i = 0; i < n; i++) {
                let wn = win[i]
                let timeEnd = (wn >= 0 && Number.isFinite(hold[i])) ? time[i + hold[i]] : null
                bars[time[i]][k] = { win: wn, timeEnd }
            }
        }
    }

    //out
    let out = { meta: { keyOhlc, ts, te, tps, modes, nBars: n }, bars }

    //寫檔
    let jp = path.resolve(fpJson)
    let fd = path.dirname(jp)
    if (!fsIsFolder(fd)) {
        fsCreateFolder(fd)
    }
    fs.writeFileSync(jp, JSON.stringify(out))

    return out
}


export default buildKLinesTpSl
