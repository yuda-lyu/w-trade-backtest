# w-data-tdbacktest
A tool for trade backtest.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-data-tdbacktest.svg?style=flat)](https://npmjs.org/package/w-data-tdbacktest) 
[![license](https://img.shields.io/npm/l/w-data-tdbacktest.svg?style=flat)](https://npmjs.org/package/w-data-tdbacktest) 
[![npm download](https://img.shields.io/npm/dt/w-data-tdbacktest.svg)](https://npmjs.org/package/w-data-tdbacktest) 
[![npm download](https://img.shields.io/npm/dm/w-data-tdbacktest.svg)](https://npmjs.org/package/w-data-tdbacktest) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-data-tdbacktest.svg)](https://www.jsdelivr.com/package/npm/w-data-tdbacktest)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-data-tdbacktest/global.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-data-tdbacktest
```

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-data-tdbacktest/blob/master/g.mjs)]
```alias
import WDataTdbacktest from 'w-data-tdbacktest'
import ott from 'w-data-tdbacktest/src/ott.mjs' //時區時間函數由外部傳入, 可用src/ott.mjs或自行以dayjs包裝


async function test() {

    //arrOhlc, 6根4hr K線
    let arrOhlc = [
        { time: '2020-01-01T00:00:00', Open: 100, High: 101, Low: 99, Close: 100 },
        { time: '2020-01-01T04:00:00', Open: 100, High: 106, Low: 100, Close: 105 },
        { time: '2020-01-01T08:00:00', Open: 105, High: 107, Low: 102, Close: 103 },
        { time: '2020-01-01T12:00:00', Open: 103, High: 104, Low: 94, Close: 95 },
        { time: '2020-01-01T16:00:00', Open: 95, High: 98, Low: 92, Close: 93 },
        { time: '2020-01-01T20:00:00', Open: 93, High: 99, Low: 95, Close: 97 },
    ]

    //arrSig, 進場訊號指標序列, param>0.5代表觸發進場
    let arrSig = [
        { time: '2020-01-01T00:00:00', param: 1 },
        { time: '2020-01-01T04:00:00', param: 0 },
        { time: '2020-01-01T08:00:00', param: 1 },
        { time: '2020-01-01T12:00:00', param: 0 },
        { time: '2020-01-01T16:00:00', param: 0 },
        { time: '2020-01-01T20:00:00', param: 0 },
    ]

    //funGetSeries, 序列查詢函數, 依key回傳時間序列
    let funGetSeries = async (key) => {
        if (key === 'btc') {
            return arrOhlc
        }
        if (key === 'sig') {
            return arrSig
        }
        throw new Error(`invalid key[${key}]`)
    }

    //strategy, 做多策略: sig>0.5時以Close下單, 止盈5%, 止損3%, 手續費0.05%
    let strategy = {
        mode: 'long', //做多
        keyOhlc: 'btc', //K線序列key
        conds: [ //進場條件, 各條件以sym與th判斷, opr為'and'或'or'
            { key: 'sig', sym: '>', th: 0.5, opr: 'and' },
        ],
        settings: {
            uIni: 1000, //初始資金(USDT)
            uTrade: 100, //每次下單金額(USDT)
            rTakeProfit: 0.05, //止盈比例
            rStopLoss: 0.03, //止損比例
            rFee: 0.0005, //手續費比例
        },
    }

    //runStrategy, 執行單一策略回測
    let r = await WDataTdbacktest.runStrategy(ott, strategy, funGetSeries)
    console.log('runStrategy orders:', r.orders.map((o) => `${o.timeStart} ${o.mode} ${o.priceStart}->${o.priceEnd} ${o.modeResult}`))
    // => runStrategy orders: [
    //   '2020-01-01T00:00:00 long 100->105 profit',
    //   '2020-01-01T08:00:00 long 103->99.91 loss'
    // ]
    console.log('runStrategy summary:', {
        numTrade: r.summary.numTrade,
        rWin: r.summary.rWin,
        uEquityFinal: r.summary.uEquityFinal,
        rCumuProfitOrLossFinal: r.summary.rCumuProfitOrLossFinal,
    })
    // => runStrategy summary: {
    //   numTrade: 2,
    //   rWin: '50.00%',
    //   uEquityFinal: 1001.8,
    //   rCumuProfitOrLossFinal: '0.18%'
    // }

    //runStrategies, 執行多策略回測(各單附策略sid, 以各策略uIni總和結算)
    let strategies = [
        { sid: 's1', ...strategy },
        { sid: 's2', ...strategy, mode: 'short', conds: [{ key: 'sig', sym: '<', th: 0.5, opr: 'and' }] },
    ]
    let rr = await WDataTdbacktest.runStrategies(ott, strategies, funGetSeries)
    console.log('runStrategies orders:', rr.orders.map((o) => `${o.sid} ${o.timeStart} ${o.mode} ${o.modeResult || 'unsettled'}`))
    // => runStrategies orders: [
    //   's1 2020-01-01T00:00:00 long profit',
    //   's2 2020-01-01T04:00:00 short profit',
    //   's1 2020-01-01T08:00:00 long loss',
    //   's2 2020-01-01T12:00:00 short loss',
    //   's2 2020-01-01T16:00:00 short loss',
    //   's2 2020-01-01T20:00:00 short unsettled'
    // ]
    console.log('runStrategies summary:', {
        uIni: rr.summary.uIni,
        numTrade: rr.summary.numTrade,
        numTradeFin: rr.summary.numTradeFin,
        rWin: rr.summary.rWin,
        uEquityFinal: rr.summary.uEquityFinal,
        rSharpe: rr.summary.rSharpe,
    })
    // => runStrategies summary: {
    //   uIni: 2000,
    //   numTrade: 6,
    //   numTradeFin: 5,
    //   rWin: '40.00%',
    //   uEquityFinal: 2000.5000000000005,
    //   rSharpe: 0.36228441865471217
    // }

    //calcOrders, 手工訂單結算: 給定下單清單, 依K線判斷止盈止損並計算盈虧
    let ordersSubmit = [
        {
            mode: 'long',
            timeStart: '2020-01-01T00:00:00',
            priceStart: 100,
            uTrade: 100,
            priceTakeProfit: 105,
            priceStopLoss: 97,
            timeEnd: '',
            priceEnd: '',
            modeResult: '',
            uFee: 0.05,
        },
    ]
    let ordersClose = await WDataTdbacktest.calcOrders(arrOhlc, ordersSubmit, { uIni: 1000 })
    console.log('calcOrders:', ordersClose.map((o) => `${o.timeStart}->${o.timeEnd} ${o.modeResult} uProfitOrLoss=${o.uProfitOrLoss}`))
    // => calcOrders: [ '2020-01-01T00:00:00->2020-01-01T04:00:00 profit uProfitOrLoss=4.9' ]

    //calcSummary, 基於全部交易單重算累積收益並統計摘要
    let summary = await WDataTdbacktest.calcSummary(ott, 1000, ordersClose, '2020-01-01T00:00:00', '2020-01-01T20:00:00')
    console.log('calcSummary:', {
        numTrade: summary.numTrade,
        rWin: summary.rWin,
        uEquityFinal: summary.uEquityFinal,
    })
    // => calcSummary: { numTrade: 1, rWin: '100.00%', uEquityFinal: 1004.9 }

    //genReport, 產出html報告(內含權益曲線, 訂單表格, 時間軸與摘要)
    WDataTdbacktest.genReport({ name: '示範策略', orders: rr.orders, summary: rr.summary }, './test/tmp-g/report.html')
    console.log('genReport: ./test/tmp-g/report.html')
    // => genReport: ./test/tmp-g/report.html

}
test()
    .catch((err) => {
        console.log('catch', err)
    })
```
