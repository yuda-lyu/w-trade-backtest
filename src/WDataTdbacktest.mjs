import ott from './ott.mjs'
import runStrategy from './runStrategy.mjs'
import runStrategies from './runStrategies.mjs'
import calcOrders from './calcOrders.mjs'
import calcOrdersRatio from './calcOrdersRatio.mjs'
import calcOrdersSummary from './calcOrdersSummary.mjs'
import calcOrdersSummarySimple from './calcOrdersSummarySimple.mjs'
import calcSummary from './calcSummary.mjs'
import closeAndSummaryOrders from './closeAndSummaryOrders.mjs'
import genReport from './genReport.mjs'


let r = {
    ott,
    runStrategy,
    runStrategies,
    calcOrders,
    calcOrdersRatio,
    calcOrdersSummary,
    calcOrdersSummarySimple,
    calcSummary,
    closeAndSummaryOrders,
    genReport,
}


export default r
