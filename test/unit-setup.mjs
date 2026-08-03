import path from 'path'


//共用fixtures與工具, 各unit-*.test.mjs引用
//  本檔不帶.test.中綴, 不會被mocha當測試檔抓取


//approx, 浮點容差比較
let approx = (a, b, tol = 1e-9) => Math.abs(a - b) < tol


//fixtures: 6根4hr K線(同一日內, 2020-01-01T00:00至20:00)
let t00 = '2020-01-01T00:00:00'
let t04 = '2020-01-01T04:00:00'
let t08 = '2020-01-01T08:00:00'
let t12 = '2020-01-01T12:00:00'
let t16 = '2020-01-01T16:00:00'
let t20 = '2020-01-01T20:00:00'
let buildArrOhlc = () => {
    return [
        { time: t00, Open: 100, High: 101, Low: 99, Close: 100 },
        { time: t04, Open: 100, High: 106, Low: 100, Close: 105 },
        { time: t08, Open: 105, High: 107, Low: 102, Close: 103 },
        { time: t12, Open: 103, High: 104, Low: 94, Close: 95 },
        { time: t16, Open: 95, High: 98, Low: 92, Close: 93 },
        { time: t20, Open: 93, High: 99, Low: 95, Close: 97 },
    ]
}

//buildOrders: 4張手工下單(calcOrders會就地修改訂單, 故每次重建)
//  A: long@t00, priceStart=100, TP=105(t04之High=106觸發止盈), SL=97
//  B: long@t04, priceStart=105, TP=110.25, SL=101.85(t12之Low=94觸發止損)
//  C: short@t08, priceStart=103, TP=97.85(t12之Low=94觸發止盈), SL=106.09
//  D: long@t16, priceStart=93, TP=105, SL=85(其後K棒皆未觸發, 未平倉)
let buildOrder = (mode, timeStart, priceStart, priceTakeProfit, priceStopLoss) => {
    return {
        mode,
        timeStart,
        priceStart,
        uTrade: 100,
        priceTakeProfit,
        priceStopLoss,
        timeEnd: '',
        priceEnd: '',
        modeResult: '',
        uFee: 0.05, //rFee=0.0005, uFee=0.0005*100
    }
}
let buildOrders = () => {
    return [
        buildOrder('long', t00, 100, 105, 97),
        buildOrder('long', t04, 105, 110.25, 101.85),
        buildOrder('short', t08, 103, 97.85, 106.09),
        buildOrder('long', t16, 93, 105, 85),
    ]
}

//buildArrSig: sig訊號, t00與t08為1(>th觸發), 其餘為0
let buildArrSig = () => {
    return [
        { time: t00, param: 1 },
        { time: t04, param: 0 },
        { time: t08, param: 1 },
        { time: t12, param: 0 },
        { time: t16, param: 0 },
        { time: t20, param: 0 },
    ]
}

//buildStrategy: 單一策略, keyOhlc為btc, 條件序列為sig
let buildStrategy = (mode, sym, th) => {
    return {
        mode,
        keyOhlc: 'btc',
        conds: [{ key: 'sig', sym, th, opr: 'and' }],
        settings: {
            uIni: 1000,
            uTrade: 100,
            rTakeProfit: 0.05,
            rStopLoss: 0.03,
            rFee: 0.0005,
        },
    }
}

//buildFunGetSeries: 序列查詢函數, btc回傳K線, sig回傳訊號
let buildFunGetSeries = () => {
    let arrSig = buildArrSig()
    return async (key) => {
        if (key === 'btc') {
            return buildArrOhlc()
        }
        if (key === 'sig') {
            return arrSig
        }
        throw new Error(`invalid key[${key}]`)
    }
}

//buildFdTmp: 暫存根資料夾, 各測試檔獨立使用./test/tmp-unit-{函數名}, 結束時整夾刪除,
//  各檔不共用父層, 故平行測試(mocha --parallel)時互不干擾
let buildFdTmp = (name) => path.resolve(`./test/tmp-unit-${name}`)


export {
    approx,
    t00,
    t04,
    t08,
    t12,
    t16,
    t20,
    buildArrOhlc,
    buildOrder,
    buildOrders,
    buildArrSig,
    buildStrategy,
    buildFunGetSeries,
    buildFdTmp,
}
