import runStrategy from './runStrategy.mjs'
import runStrategies from './runStrategies.mjs'
import calcOrders from './calcOrders.mjs'
import calcOrdersRatio from './calcOrdersRatio.mjs'
import calcOrdersSummary from './calcOrdersSummary.mjs'
import calcOrdersSummarySimple from './calcOrdersSummarySimple.mjs'
import calcSummary from './calcSummary.mjs'
import closeAndSummaryOrders from './closeAndSummaryOrders.mjs'
import genReport from './genReport.mjs'
import genReportCore from './genReportCore.mjs'


let r = {
    runStrategy,
    runStrategies,
    calcOrders,
    calcOrdersRatio,
    calcOrdersSummary,
    calcOrdersSummarySimple,
    calcSummary,
    closeAndSummaryOrders,
    genReport,
    genReportCore,
}


export default r
