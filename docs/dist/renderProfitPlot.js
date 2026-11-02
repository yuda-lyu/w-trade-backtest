

let renderProfitPlot = (ele, orders, opt = {}) => {

    let _ = window._
    let w = window.wsemi
    let ot = window.dayjs
    let echarts = window.echarts

    if (!w.isEle(ele)) {
        throw new Error(`invalid ele`)
    }
    if (!w.isearr(orders)) {
        throw new Error(`invalid orders`)
    }

    let p2r = (p) => {
        p = w.cstr(p)
        p = p.replace('%', '')
        p = w.cdbl(p)
        // p /= 100
        return p
    }

    //以target為中心, 抓最大距離*1.2
    let mkMin = (target) => {
        let f = (value) => {
            // console.log(value.min, value.max)
            let d = _.max([target - value.min, value.max - target])
            return target - w.cdbl(d * 1.2)
        }
        return f
    }
    let mkMax = (target) => {
        let f = (value) => {
            // console.log(value.min, value.max)
            let d = _.max([target - value.min, value.max - target])
            return target + w.cdbl(d * 1.2)
        }
        return f
    }

    let ordersDedup = _
        .chain(orders)
        .groupBy(o => o.timeStart)
        .map(group => _.last(group)) //同一時間取最後一筆
        .sortBy(o => o.timeStart) //重新依時間排序
        .value()

    ordersDedup = _.filter(ordersDedup, (o) => {
        return w.isnum(o.uCumuProfitOrLoss) && w.isestr(o.rCumuProfitOrLoss)
    })

    //usEquity
    let usEquity = _.map(ordersDedup, (o) => {
        let t = ot(o.timeStart).toDate()
        return [t, w.cdbl(o.uCumuProfitOrLoss)]
    })

    //rsEquity
    let rsEquity = _.map(ordersDedup, (o) => {
        let t = ot(o.timeStart).toDate()
        return [t, p2r(o.rCumuProfitOrLoss)]
    })

    // 基本 optChart
    let optChart = {
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross',
                crossStyle: { color: '#999' },
            },
        },
        grid: {
            left: 80,
            right: 80,
            top: 60,
            bottom: 60,
            containLabel: false,
        },
        legend: {
            data: ['累計盈虧(USDT)', '累計盈虧比例(%)'],
            right: 100,
            bottom: 90,
            orient: 'vertical',
            icon: 'circle',
            itemWidth: 10,
            itemHeight: 10,
            textStyle: {
                fontSize: 12,
            },
        },
        xAxis: [{
            type: 'time',
            boundaryGap: false,
            // min: usEquity[0][0], // 起點時間
            // max: _.last(usEquity)[0], // 終點時間
            axisLabel: {
                formatter: (value) => {
                    return ot(value).format('YYYY-MM-DD')
                },
                hideOverlap: false,
                showMinLabel: true, //強制顯示最左
                showMaxLabel: true, //強制顯示最右
            },
            axisLine: {
                onZero: false,
                // lineStyle: { color: '#999' },
            },
            axisTick: {
                show: true,
                inside: false,
                length: 6,
            },
        }],
        yAxis: [
            {
                type: 'value',
                name: '累計盈虧(USDT)',
                position: 'left',
                min: mkMin(0),
                max: mkMax(0),
                axisLine: {
                    show: true,
                    lineStyle: { color: '#4561b5' },
                },
                axisLabel: {
                    hideOverlap: false,
                    showMinLabel: false,
                    showMaxLabel: false,
                },
                axisTick: {
                    show: true,
                    inside: true,
                    length: 6,
                },
            },
            {
                type: 'value',
                name: '累計盈虧比例(%)',
                position: 'right',
                min: mkMin(0),
                max: mkMax(0),
                axisLine: {
                    show: true,
                    lineStyle: { color: '#559538' },
                },
                splitLine: { show: false },
                axisLabel: {
                    // hideOverlap: false,
                    showMinLabel: false,
                    showMaxLabel: false,
                },
                axisTick: {
                    show: true,
                    inside: true,
                    length: 6,
                },
                axisPointer: {
                    label: {
                        formatter: (params) => {
                            return `${params.value.toFixed(2)}%`
                        }
                    }
                },
            },
        ],
        series: [
            {
                name: '累計盈虧(USDT)',
                type: 'line',
                smooth: true,
                yAxisIndex: 0,
                itemStyle: { color: '#7893e3' },
                showSymbol: false,
                data: usEquity,
            },
            {
                name: '累計盈虧比例(%)',
                type: 'line',
                smooth: true,
                yAxisIndex: 1,
                itemStyle: { color: 'transparent' },
                showSymbol: false,
                data: rsEquity,
            },
        ],
    }

    let chart = echarts.init(ele)
    chart.setOption(optChart)

    window.addEventListener('resize', () => chart.resize())

    return chart
}

