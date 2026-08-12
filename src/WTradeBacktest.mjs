import runStrategy from './runStrategy.mjs'
import runStrategies from './runStrategies.mjs'
import runStrategiesAndBacktest from './runStrategiesAndBacktest.mjs'
import calcOrders from './calcOrders.mjs'
import calcOrdersRatio from './calcOrdersRatio.mjs'
import calcOrdersSummary from './calcOrdersSummary.mjs'
import calcOrdersSummarySimple from './calcOrdersSummarySimple.mjs'
import calcSummary from './calcSummary.mjs'
import closeAndSummaryOrders from './closeAndSummaryOrders.mjs'
import genReport from './genReport.mjs'
import genReportCore from './genReportCore.mjs'
import genKLinesTpSl from './genKLinesTpSl.mjs'
import buildKLinesTpSl from './buildKLinesTpSl.mjs'
import loadKLinesTpSl from './loadKLinesTpSl.mjs'
import buildStrategyFastSession from './buildStrategyFastSession.mjs'


let r = {
    runStrategy,
    runStrategies,
    runStrategiesAndBacktest,
    calcOrders,
    calcOrdersRatio,
    calcOrdersSummary,
    calcOrdersSummarySimple,
    calcSummary,
    closeAndSummaryOrders,
    genReport,
    genReportCore,
    genKLinesTpSl,
    buildKLinesTpSl,
    loadKLinesTpSl,
    buildStrategyFastSession,
}


export default r
