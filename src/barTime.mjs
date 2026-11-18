import iseint from 'wsemi/src/iseint.mjs'
import cint from 'wsemi/src/cint.mjs'


//intervalSec之上限(365日)與種類描述(錯誤訊息用)
let INTERVAL_SEC_MAX = 31536000
let INTERVAL_SEC_DESC = 'a positive integer multiple of 60 up to 31536000'


/**
 * 解析並檢測每根K線之時長與時間口徑選項(不入聚合入口; 他套件可經深層路徑取用: import parseBarTime from 'w-trade-backtest/src/barTime.mjs', 或具名匯入{ parseBarTime })
 *
 * 供runStrategy與快速評估之settings、runStrategies之各策略settings、calcOrdersRatio、calcOrdersSummary、calcOrdersSummarySimple、calcSummary、closeAndSummaryOrders、genReport之opt共用，避免各路徑各自解讀選項；呼叫端(如求解)可先以之檢測再把轉型後之值寫入策略之settings
 * intervalSec為每根K線之秒數，須為有效整數(wsemi iseint，數字或整數字串，同本套件units之慣例)、為60之倍數且介於60與31536000(365日)之間，通過即以cint轉為Number；undefined或null為未給(回傳null)
 * timeBasis為時間口徑，'open'為以K線開盤時刻標籤計(現行)，'span'為計入每根K線之時距(持倉時間為進場棒收盤至出場棒收盤，回測期間為首根開盤至末根收盤)；undefined或null視同'open'；'span'須同時給intervalSec
 * 給了而無效即throw(訊息為`invalid ${name}.intervalSec: must be a positive integer multiple of 60 up to 31536000`、`invalid ${name}.timeBasis: must be one of 'open', 'span'`、`invalid ${name}.intervalSec: must be a positive integer multiple of 60 up to 31536000 when ${name}.timeBasis is 'span'`，不含輸入值)，不改用預設(影響口徑之選項，同跨套件規格〈輸入參數之檢測機制〉§11「決定資料口徑之opt」)；不改寫呼叫端之物件
 * 不檢查intervalSec與K線資料之實際間距(不符時'span'之回測天數與closeAndSummaryOrders之區間檢查失真，持倉天數不受影響)
 * obj為undefined或null視為未給兩選項
 *
 * @function
 * @param {Object} obj 輸入含intervalSec與timeBasis之物件(settings或opt)
 * @param {String} [name='opt'] 輸入錯誤訊息所用之名稱字串，預設'opt'
 * @returns {Object} 回傳{intervalSec,timeBasis}，intervalSec為整數或null，timeBasis為'open'或'span'
 * @example
 *
 * console.log(parseBarTime({ intervalSec: '86400', timeBasis: 'span' }, 'settings'))
 * // => { intervalSec: 86400, timeBasis: 'span' }
 *
 */
let parseBarTime = (obj, name = 'opt') => {

    //各欄只讀取一次
    let given = obj !== undefined && obj !== null
    let vIntervalSec = given ? obj.intervalSec : undefined
    let vTimeBasis = given ? obj.timeBasis : undefined

    //intervalSec, 60之倍數且介於60與365日之間(極大值會使'span'之摘要變成NaN, 故設上限)
    let intervalSec = null
    if (vIntervalSec !== undefined && vIntervalSec !== null) {
        if (!iseint(vIntervalSec, { min: 60, max: INTERVAL_SEC_MAX }) || cint(vIntervalSec) % 60 !== 0) {
            throw new Error(`invalid ${name}.intervalSec: must be ${INTERVAL_SEC_DESC}`)
        }
        intervalSec = cint(vIntervalSec)
    }

    //timeBasis
    let timeBasis = 'open'
    if (vTimeBasis !== undefined && vTimeBasis !== null) {
        if (vTimeBasis !== 'open' && vTimeBasis !== 'span') {
            throw new Error(`invalid ${name}.timeBasis: must be one of 'open', 'span'`)
        }
        timeBasis = vTimeBasis
    }

    //span須有intervalSec
    if (timeBasis === 'span' && intervalSec === null) {
        throw new Error(`invalid ${name}.intervalSec: must be ${INTERVAL_SEC_DESC} when ${name}.timeBasis is 'span'`)
    }

    return { intervalSec, timeBasis }
}


/**
 * 計算回測天數btDays(內部用, 不入聚合入口與文件)；calcOrdersSummary與calcOrdersSummarySimple共用，使兩者之btDays逐位相同
 *
 * bt.timeBasis為'open'時為首根與末根開盤時刻標籤之日差(dayjs之diff以'day'截斷，現行)；為'span'時計至末根收盤(末根開盤加bt.intervalSec秒)，即首根開盤至末根收盤之整日數(截斷)
 * 'span'時timeOhlcEnd須為末根K線之開盤時刻(若傳入窗之結束時刻而非末根開盤，會多算一根)；不足1日之窗為0(年化與等效年化為0)
 *
 * @function
 * @param {Function} ott 輸入時區時間函數
 * @param {String} timeOhlcStart 輸入首根開盤時刻字串
 * @param {String} timeOhlcEnd 輸入末根開盤時刻字串
 * @param {Object} bt 輸入parseBarTime之回傳物件
 * @returns {Number} 回傳回測天數
 * @example
 *
 * console.log(calcBtDays(ott, '2022-07-01T00:00:00', '2025-04-08T00:00:00', { intervalSec: 86400, timeBasis: 'span' }))
 * // => 1013
 *
 */
let calcBtDays = (ott, timeOhlcStart, timeOhlcEnd, bt) => {
    if (bt.timeBasis === 'span') {
        return ott(timeOhlcEnd).add(bt.intervalSec, 'second').diff(ott(timeOhlcStart), 'day')
    }
    return ott(timeOhlcEnd).diff(ott(timeOhlcStart), 'day')
}


/**
 * 計算timeBasis為'span'時之持倉天數(內部用, 不入聚合入口與文件)
 *
 * 進場於進場棒收盤(timeStart加每根時長)、出場至遲於出場棒收盤(timeEnd加每根時長)，兩者之差等於兩開盤時刻標籤之差；以日計(dayjs之diff以'day'取小數)、無條件進位、至少1日
 * 為經過之時長而非根數: 日線無缺根時持k根即k日，有缺根時為經過之日數
 *
 * @function
 * @param {Function} ott 輸入時區時間函數
 * @param {String} timeStart 輸入進場棒之開盤時刻字串
 * @param {String} timeEnd 輸入出場棒之開盤時刻字串
 * @returns {Number} 回傳持倉天數
 * @example
 *
 * console.log(calcDayHoldSpan(ott, '2022-07-01T20:00:00', '2022-07-02T00:00:00'))
 * // => 1
 *
 */
let calcDayHoldSpan = (ott, timeStart, timeEnd) => {
    return Math.max(1, Math.ceil(ott(timeEnd).diff(ott(timeStart), 'day', true)))
}


export { parseBarTime, calcBtDays, calcDayHoldSpan }
export default parseBarTime
