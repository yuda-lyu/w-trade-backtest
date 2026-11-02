

let genCard = (opt = {}) => {

    let {
        icon = 'fa-question-circle',
        iconColor = 'text-gray-600',
        iconBg = 'bg-gray-100',
        title = '',
        main = '',
        mainColor = 'text-gray-900',
        sub = '',
    } = opt

    let h = `
        <div class="stat-card flex items-start gap-4">
            <div class="p-3 rounded-lg ${iconBg} ${iconColor}">
                <i class="fas ${icon} fa-lg"></i>
            </div>
            <div>
                <p class="text-sm font-medium text-gray-500">${title}</p>
                <p class="text-2xl font-bold ${mainColor}">${main}</p>
                <p class="text-md font-semibold text-gray-500">${sub}</p>
            </div>
        </div>
    `

    return h
}


let renderSummary = (ele, summary) => {

    let _ = window._
    let w = window.wsemi
    let ot = window.dayjs

    if (!w.isEle(ele)) {
        throw new Error(`invalid ele`)
    }

    let cards = []

    let isProfit = summary.uEquityFinal >= summary.uIni

    let profitColor = isProfit ? 'text-green-600' : 'text-red-600'
    let profitBg = isProfit ? 'bg-green-100' : 'bg-red-100'

    let tStart = ot(summary.timeOhlcStart)
    let tEnd = ot(summary.timeOhlcEnd)
    // console.log('summary.timeOhlcStart', summary.timeOhlcStart, tStart)
    // console.log('summary.timeOhlcEnd', summary.timeOhlcEnd, tEnd)

    let sStart = tStart.format('YYYY-MM-DD')
    let sEnd = tEnd.format('YYYY-MM-DD')

    //總報酬率
    cards.push(genCard({
        icon: 'fa-arrow-trend-up',
        iconColor: profitColor,
        iconBg: profitBg,
        title: '總報酬率',
        main: `${summary.rCumuProfitOrLossFinal}`,
        mainColor: profitColor,
        sub: `年化報酬率: ${summary.rCumuProfitOrLossFinalNormYear}`,
    }))

    //總等效報酬率
    cards.push(genCard({
        icon: 'fa-solid fa-shuffle',
        iconColor: profitColor,
        iconBg: profitBg,
        title: '總等效報酬率',
        main: `${summary.rEquivalentCumuProfitOrLossFinal}`,
        mainColor: profitColor,
        sub: `等效年化報酬率: ${summary.rEquivalentCumuProfitOrLossFinalNormYear}`,
    }))

    //最終資金
    cards.push(genCard({
        icon: 'fa-arrow-up-right-dots',
        iconColor: profitColor,
        iconBg: profitBg,
        title: '最終資金',
        main: `${w.dig(summary.uEquityFinal, 2)} USDT`,
        mainColor: profitColor,
        sub: `淨盈虧: ${w.dig(summary.uEquityFinal - summary.uIni, 2)} USDT`,
    }))

    //初始資金
    cards.push(genCard({
        icon: 'fa-coins',
        iconColor: 'text-yellow-600',
        iconBg: 'bg-yellow-100',
        title: '初始資金',
        main: `${w.dig(summary.uIni, 2)} USDT`,
        mainColor: 'text-gray-900',
        sub: '',
    }))

    //最大回撤
    cards.push(genCard({
        icon: 'fa-arrow-trend-down',
        iconColor: 'text-red-600',
        iconBg: 'bg-red-100',
        title: '最大回撤',
        main: `${w.dig(summary.uDrawdownMax, 2)} USDT`,
        mainColor: 'text-red-500',
        sub: '',
    }))

    //最大回撤率
    cards.push(genCard({
        icon: 'fa-arrow-trend-down',
        iconColor: 'text-red-600',
        iconBg: 'bg-red-100',
        title: '最大回撤率',
        main: `${summary.rDrawdownMax}`,
        mainColor: 'text-red-500',
        sub: `等效最大回徹率: ${summary.rEquivalentDrawdownMax}`,
    }))

    //最大持倉筆數
    cards.push(genCard({
        icon: 'fa-layer-group',
        iconColor: 'text-orange-600',
        iconBg: 'bg-orange-100',
        title: '最大持倉筆數',
        main: `${summary.numTradeAllMax} 筆`,
        mainColor: 'text-gray-900',
        sub: `同時出場單數為 ${summary.numTradeAllMax * 2} 筆`,
    }))

    //最大持倉
    cards.push(genCard({
        icon: 'fa-wallet',
        iconColor: 'text-orange-600',
        iconBg: 'bg-orange-100',
        title: '最大持倉',
        main: `${w.dig(summary.uTradeAllMax, 2)} USDT`,
        mainColor: 'text-gray-900',
        sub: `佔本金: ${summary.rTradeAllMax}`,
    }))

    //總交易次數
    cards.push(genCard({
        icon: 'fa-solid fa-arrows-rotate',
        iconColor: 'text-blue-600',
        iconBg: 'bg-blue-100',
        title: '總交易次數',
        main: `${summary.numTrade} 次`,
        mainColor: 'text-gray-900',
        sub: '',
    }))

    //勝率
    cards.push(genCard({
        icon: 'fa-percent',
        iconColor: 'text-indigo-600',
        iconBg: 'bg-indigo-100',
        title: '勝率',
        main: `${summary.rWin}`,
        mainColor: 'text-gray-900',
        sub: '',
    }))

    //夏普值
    cards.push(genCard({
        icon: 'fa-chart-line',
        iconColor: 'text-emerald-600',
        iconBg: 'bg-emerald-100',
        title: '夏普值',
        main: w.dig(summary.rSharpe, 2),
        mainColor: 'text-emerald-700',
        sub: '風險調整後報酬',
    }))

    //回測區間
    cards.push(genCard({
        icon: 'fa-calendar-alt',
        iconColor: 'text-sky-600',
        iconBg: 'bg-sky-100',
        title: '回測區間',
        main: `${summary.btDays}日(${summary.btYears}年)`,
        mainColor: 'text-gray-900',
        sub: `${sStart} 至 ${sEnd}`,
    }))

    let h = cards.join('')

    ele.innerHTML = h

    return null
}
