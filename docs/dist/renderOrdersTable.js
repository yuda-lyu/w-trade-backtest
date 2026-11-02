

let renderOrdersTable = (ele, orders, opt = {}) => {

    let _ = window._
    let w = window.wsemi

    if (!w.isEle(ele)) {
        throw new Error(`invalid ele`)
    }
    if (!w.isearr(orders)) {
        throw new Error(`invalid orders`)
    }

    orders = _.map(orders, (o, k) => {
        o.id = `o${k + 1}`
        return o
    })

    let optDef = {
        columns: [
            'id',
            'mode',
            'timeStart',
            'priceStart',
            'uTrade',
            'uTradeAll',
            'rTakeProfit',
            'rStopLoss',
            'timeEnd',
            'priceEnd',
            'modeResult',
            'uProfitOrLoss',
            'uCumuProfitOrLoss',
            'uEquity',
        ],
        columnTranslations: {
            id: '流水號',
            mode: '模式',
            timeStart: '開倉時間',
            priceStart: '開倉價格<br>(USDT)',
            uTrade: '下單金額<br>(USDT)',
            uTradeAll: '當前持倉<br>(USDT)',
            rTakeProfit: '止盈<br>(%)',
            rStopLoss: '止損<br>(%)',
            timeEnd: '平倉時間',
            priceEnd: '平倉價格<br>(USDT)',
            modeResult: '結果',
            uProfitOrLoss: '單筆盈虧<br>(USDT)',
            uCumuProfitOrLoss: '累計盈虧<br>(USDT)',
            uEquity: '累計金額<br>(USDT)',
        },
        modeLabels: {
            long: '做多',
            short: '做空',
        },
        modeResultLabels: {
            profit: '止盈',
            loss: '止損',
        },
        rowClassDef: 'border-b border-gray-200',
        cellClassDef: 'px-4 py-3 whitespace-nowrap',
        formatters: {}, //使用key -> fn
        rowClassFn: null, //使用接收(order, rowIndex) => '...'
    }

    let cfg = _.merge({}, optDef, opt)

    let hHead = _.map(cfg.columns, key => {
        let label = _.get(cfg.columnTranslations, key, key)
        return `<th scope="col" class="px-4 py-3">${label}</th>`
    }).join('')

    let hBody = ''
    _.forEach(orders, (order, rowIndex) => {

        let rowClass = _.trim([
            cfg.rowClassDef || '',
            _.isFunction(cfg.rowClassFn)
                ? (cfg.rowClassFn(order, rowIndex) || '')
                : ''
        ].join(' '))

        hBody += `<tr class="${rowClass}">`

        _.forEach(cfg.columns, key => {

            let value = _.get(order, key, '')
            let cellClass = cfg.cellClassDef
            let format = cfg.formatters[key]

            if (_.isFunction(format)) {
                value = format(value, order, rowIndex)
            }
            else {
                switch (key) {

                case 'mode': {
                    if (value === 'long') {
                        value = cfg.modeLabels.long
                        cellClass += ' text-green-600 font-semibold'
                    }
                    else if (value === 'short') {
                        value = cfg.modeLabels.short
                        cellClass += ' text-red-600 font-semibold'
                    }
                    else {
                        value = ''
                    }
                    break
                }

                case 'modeResult': {
                    if (value === 'profit') {
                        value = cfg.modeResultLabels.profit
                        cellClass += ' text-green-600 font-semibold'
                    }
                    else if (value === 'loss') {
                        value = cfg.modeResultLabels.loss
                        cellClass += ' text-red-600 font-semibold'
                    }
                    else {
                        value = ''
                    }
                    break
                }

                case 'uProfitOrLoss':
                case 'uCumuProfitOrLoss': {
                    if (w.isnum(value)) {
                        value = w.cdbl(value)
                        if (value > 0) {
                            cellClass += ' text-green-600 font-semibold'
                        }
                        else if (value < 0) {
                            cellClass += ' text-red-600 font-semibold'
                        }
                        else {
                            //empty
                        }
                        value = w.dig(value, 4)
                    }
                    break
                }

                case 'uEquity': {
                    if (w.isnum(value)) {
                        value = w.cdbl(value)
                        if (value > 0) {
                            //empty
                        }
                        else if (value < 0) {
                            //empty
                        }
                        else {
                            //empty
                        }
                        value = w.dig(value, 4)
                    }
                    break
                }

                case 'rTakeProfit':
                case 'rStopLoss': {
                    if (w.isnum(value)) {
                        value = `${w.dig(value * 100, 1)}%`
                    }
                    break
                }

                case 'priceStart':
                case 'priceEnd': {
                    if (w.isnum(value)) {
                        value = w.dig(value, 2)
                    }
                    break
                }

                case 'uTrade':
                case 'uTradeAll': {
                    if (w.isnum(value)) {
                        value = w.dig(value, 2)
                    }
                    break
                }

                case 'timeStart':
                case 'timeEnd': {
                    if (w.isestr(value)) {
                        value = value.replace('T', ' ')
                    }
                    break
                }

                default:
                    break
                }
            }

            hBody += `<td class="${cellClass}">${value}</td>`
        })

        hBody += `</tr>`
    })

    let h = `
        <table class="trade-table w-full text-sm text-gray-600">
            <thead><tr>${hHead}</tr></thead>
            <tbody>${hBody}</tbody>
        </table>
    `

    ele.innerHTML = h

    return null
}

