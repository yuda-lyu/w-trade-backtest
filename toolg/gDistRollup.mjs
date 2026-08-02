import path from 'path'
import fs from 'fs'
import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


async function rp() {

    await rollupFiles({ //rollupFiles預設會clean folder
        fns: 'WTradeBacktest.mjs',
        fdSrc,
        fdTar,
        nameDistType: 'kebabCase',
        // bNodePolyfill: true,
        // bMinify: false,
        globals: {
            path: 'path',
            fs: 'fs',
            url: 'url',
        },
        external: [
            'path',
            'fs',
            'url',
        ],
    })
        .catch((err) => {
            console.log(err)
        })

    //genReportCore於執行期以fs讀取同資料夾之模板資產(js與html不打包進bundle), 故須複製至dist
    let fnsAssets = [
        'tmp.html',
        'renderProfitPlot.js',
        'renderOrdersTable.js',
        'renderOrdersTimeline.js',
        'renderSummary.js',
    ]
    fnsAssets.forEach((fn) => {
        fs.copyFileSync(path.resolve(fdSrc, fn), path.resolve(fdTar, fn))
    })

}
rp()
    .catch((err) => {
        console.log(err)
    })

