

let renderOrdersTimeline = (ele, orders, opt = {}) => {

    let _ = window._
    let w = window.wsemi
    let ot = window.dayjs
    let vis = window.vis

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

    let cv = (t) => {
        if (!w.isestr(t)) {
            return new Date()
        }
        return new Date(t)
    }

    let gv = (t, key, def = '') => {
        let value = _.get(t, key, '')
        if (!w.isestr(value) && !w.isnum(value)) {
            return def
        }
        return value
    }

    let kv = (v) => {
        if (v === 'profit') {
            return '止盈'
        }
        else if (v === 'loss') {
            return '止損'
        }
        return '尚未平倉'
    }

    function gft(d) {
        return {
            year: d.year(),
            month: w.cstr(d.month() + 1).padStart(2, '0'),
            day: w.cstr(d.date()).padStart(2, '0'),
            hour: w.cstr(d.hour()).padStart(2, '0'),
            minute: w.cstr(d.minute()).padStart(2, '0'),
            second: w.cstr(d.second()).padStart(2, '0'),
            millisecond: w.cstr(d.millisecond()).padStart(3, '0'),
        }
    }

    function buildVisModel(rows) {
        let groups = new vis.DataSet(
            rows.map((r, idx) => ({
                id: r['id'],
                content: r['id'], // 左邊列標籤
                order: idx, // 固定排序
            }))
        )

        let items = new vis.DataSet(
            rows.map((r, idx) => ({
                id: idx + 1,
                group: r['id'],
                content: `${r['id']}: ${kv(r.modeResult)}`, //bar上的文字
                start: cv(r.timeStart),
                end: cv(r.timeEnd),
                type: 'range',
                title: `${r['id']}: ${gv(r, 'timeStart', '非預期錯誤')} 至 ${gv(r, 'timeEnd', '尚未平倉')}`,
                className: r.mode === 'long' ? 'bar-long' : 'bar-short',
            }))
        )

        return { groups, items }
    }

    let options = {

        height: '600px',

        stack: false, // 同一列不要堆疊（每列只有一個 item 時很適合）
        horizontalScroll: true,
        //zoomKey: "ctrlKey", // Ctrl + 滾輪縮放（避免誤縮放）
        selectable: false,
        multiselect: false,
        margin: { item: 20, axis: 10 },
        orientation: 'both', // 顯示上方時間軸 + 左側 groups
        //showCurrentTime: true,

        format: {
            majorLabels: (d, scale, step) => {
                // console.log('majorLabels', d, 'scale', scale, 'step', step)
                let { year, month, day, hour, minute, second, millisecond } = gft(d)
                if (scale === 'year') {
                    return `${year}`
                }
                else if (scale === 'month') {
                    return `${year}`
                }
                else if (scale === 'day' || scale === 'weekday') {
                    return `${year}/${month}`
                }
                else if (scale === 'hour') {
                    return `${year}/${month}/${day}`
                }
                else if (scale === 'minute') {
                    return `${year}/${month}/${day} ${hour}`
                }
                else if (scale === 'second') {
                    return `${year}/${month}/${day} ${hour}:${minute}`
                }
                else if (scale === 'millisecond') {
                    return `${year}/${month}/${day} ${hour}:${minute}:${second}`
                }
                throw new Error(`invalid scale[${scale}]`)
            },
            minorLabels: (d, scale, step) => {
                // console.log('minorLabels', d, 'scale', scale, 'step', step)
                let { year, month, day, hour, minute, second, millisecond } = gft(d)
                if (scale === 'year') {
                    return `${year}`
                }
                else if (scale === 'month') {
                    return `${month}`
                }
                else if (scale === 'day' || scale === 'weekday') {
                    return `${day}`
                }
                else if (scale === 'hour') {
                    return `${hour}h`
                }
                else if (scale === 'minute') {
                    return `${minute}m`
                }
                else if (scale === 'second') {
                    return `${second}s`
                }
                else if (scale === 'millisecond') {
                    return `${millisecond}ms`
                }
                throw new Error(`invalid scale[${scale}]`)
            },
        },

    }

    let { groups, items } = buildVisModel(orders)
    new vis.Timeline(ele, items, groups, options)
    //let timeline = new vis.Timeline(ele, items, groups, options)
    //timeline.fit();

}
