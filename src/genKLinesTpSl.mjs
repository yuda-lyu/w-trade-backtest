/**
 * 計算各K線進場後之止盈止損先觸結果
 *
 * 以各根K線收盤價為進場價，往後逐根K線掃描first-touch，long以Low<=進場價*(1-sl)判止損、High>=進場價*(1+tp)判止盈
 * short以High>=進場價*(1+sl)判止損、Low<=進場價*(1-tp)判止盈，同根同時觸發時皆先判止損
 * 末根K線與掃描至序列末仍未觸發者視為未結，win為-1且pnl與hold為NaN
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {Array} arrOhlc 輸入K線陣列，各元素需含time(秒時間字串)、Close、High、Low欄位，且依時間由小至大排序
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Number} opt.tp 輸入止盈比例正數，如0.05代表5%
 * @param {Number} opt.sl 輸入止損比例正數，如0.05代表5%
 * @param {String} [opt.mode='long'] 輸入交易方向字串，可為'long'或'short'，預設'long'
 * @returns {Object} 回傳物件，內含time(時間字串陣列)、pnl(Float64Array，止盈為tp、止損為-sl、未結為NaN)、win(Int8Array，1為止盈先觸、0為止損先觸、-1為未結)、hold(Float64Array，出場K線與進場K線之位移根數，未結為NaN)欄位，各陣列長度同arrOhlc且index對應
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
 * let r = genKLinesTpSl(arrOhlc, { tp: 0.05, sl: 0.05, mode: 'long' })
 * console.log(Array.from(r.win))
 * // => [ 1, 0, 0, -1, 1, -1 ]
 * console.log(Array.from(r.hold))
 * // => [ 1, 2, 1, NaN, 1, NaN ]
 * console.log(Array.from(r.pnl))
 * // => [ 0.05, -0.05, -0.05, NaN, 0.05, NaN ]
 *
 */
let genKLinesTpSl = (arrOhlc, opt = {}) => {

    let tp = opt.tp; let sl = opt.sl; let mode = opt.mode || 'long'
    if (!(tp > 0) || !(sl > 0)) throw new Error(`genKLinesTpSl: invalid tp[${tp}] / sl[${sl}]`)

    let n = arrOhlc.length
    let time = new Array(n)
    let C = new Float64Array(n); let H = new Float64Array(n); let L = new Float64Array(n)
    for (let i = 0; i < n; i++) {
        let r = arrOhlc[i]; time[i] = r.time; C[i] = r.Close; H[i] = r.High; L[i] = r.Low
    }

    let pnl = new Float64Array(n).fill(NaN)
    let win = new Int8Array(n).fill(-1)
    let hold = new Float64Array(n).fill(NaN)

    for (let i = 0; i < n - 1; i++) {
        let e = C[i]; if (!(e > 0)) continue
        let up = e * (1 + tp); let dn = e * (1 - sl) //長: up=止盈線, dn=止損線
        for (let j = i + 1; j < n; j++) {
            if (mode === 'long') {
                //長: 跌破 dn (SL) 或 漲到 up (TP); 同根同觸 → 先判 SL
                if (L[j] <= dn) {
                    pnl[i] = -sl; win[i] = 0; hold[i] = j - i; break
                }
                if (H[j] >= up) {
                    pnl[i] = tp; win[i] = 1; hold[i] = j - i; break
                }
            }
            else {
                //空: 漲到 e*(1+sl) (SL) 或 跌到 e*(1-tp) (TP); 同根同觸 → 先判 SL
                let upS = e * (1 + sl); let dnS = e * (1 - tp)
                if (H[j] >= upS) {
                    pnl[i] = -sl; win[i] = 0; hold[i] = j - i; break
                }
                if (L[j] <= dnS) {
                    pnl[i] = tp; win[i] = 1; hold[i] = j - i; break
                }
            }
        }
    }

    return { time, pnl, win, hold }
}


export default genKLinesTpSl
