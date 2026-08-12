/**
 * 計算單筆訂單之淨盈虧金額(USDT)
 *
 * 結算公式與calcOrders逐字對齊(bit-exact): long為uTrade*(priceEnd/priceStart)-uTrade-2*uFee，short為(priceStart-priceEnd)*(uTrade/priceStart)-2*uFee
 * 供loadKLinesTpSl之ordersFromBars與buildStrategyFastSession共用，避免套件內出現第三份手抄公式
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {String} mode 輸入交易方向字串，'long'或'short'
 * @param {Number} uTrade 輸入下單金額(USDT)
 * @param {Number} priceStart 輸入進場價格
 * @param {Number} priceEnd 輸入出場價格
 * @param {Number} uFee 輸入單邊手續費(USDT)，結算扣2*uFee
 * @returns {Number} 回傳淨盈虧金額(USDT)，含手續費
 * @example
 *
 * console.log(settleOrderPnl('long', 100, 100, 105, 0.05))
 * // => 4.9
 *
 */
let settleOrderPnl = (mode, uTrade, priceStart, priceEnd, uFee) => {
    return mode === 'long'
        ? uTrade * (priceEnd / priceStart) - uTrade - 2 * uFee
        : (priceStart - priceEnd) * (uTrade / priceStart) - 2 * uFee
}


export default settleOrderPnl
