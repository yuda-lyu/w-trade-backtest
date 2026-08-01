import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import writeTxt from './writeTxt.mjs'


//模板資產(tmp.html, render*.js)與本模組同資料夾, 以模組位置解析, 不依賴 cwd
let fd = path.dirname(fileURLToPath(import.meta.url))

/**
 * 產出html回測報告
 *
 * 讀取與本模組同資料夾之模板資產(tmp.html與render*.js)，置換{name}、{orders}、{summary}後寫出html
 * 報告內含權益曲線、訂單表格、時間軸與摘要
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-data-tdbacktest/blob/master/test/unit-WDataTdbacktest.test.mjs Github}
 * @function
 * @param {Object} r 輸入報告物件，需含name(報告名稱字串)、orders(訂單陣列)、summary(摘要物件)欄位
 * @param {String} fpOut 輸入輸出html檔案路徑字串
 * @returns {undefined} 無回傳，於fpOut寫出html報告
 * @example
 *
 * //rr為runStrategies範例之回傳{orders,summary}
 * genReport({ name: '示範策略', orders: rr.orders, summary: rr.summary }, './report.html')
 * // => 於'./report.html'寫出html報告
 *
 */
let genReport = (r, fpOut) => {

    let rd = (fn) => {
        let fp = path.resolve(fd, fn)
        let h = fs.readFileSync(fp, 'utf8')
        return h
    }

    let h = rd('tmp.html')
    let hPlot = rd('renderProfitPlot.js')
    let hTable = rd('renderOrdersTable.js')
    let hTimeline = rd('renderOrdersTimeline.js')
    let hSummary = rd('renderSummary.js')

    h = h.replace(`{renderProfitPlot}`, hPlot)
    h = h.replace(`{renderOrdersTable}`, hTable)
    h = h.replace(`{renderOrdersTimeline}`, hTimeline)
    h = h.replace(`{renderSummary}`, hSummary)
    h = h.replace(`{name}`, r.name)
    h = h.replace(`{orders}`, JSON.stringify(r.orders))
    h = h.replace(`{summary}`, JSON.stringify(r.summary))

    //writeTxt
    writeTxt(fpOut, h)

}


export default genReport
