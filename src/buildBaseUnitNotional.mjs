import { isPlainObject, parseBaseUnitPrice, parseBaseUnitRule, parseBaseUnitOpt, calcBaseUnitCore } from './calcBaseUnitQuantity.mjs'


/**
 * 建立依基礎單位計算每單名義之函數
 *
 * 供runStrategy之settings.unit、buildStrategyFastSession之evaluate之settings.unit、loadKLinesTpSl之ordersFromBars之opt.unit共用，避免各路徑各自解讀選項
 * unit為{rule,buffer,units}，rule為交易規則{stepSize,minQty,minNotional}，buffer預設0.1，units預設1，檢測與轉型同calcBaseUnitQuantity(數字或數字字串，通過即轉型)；
 * 建立時即檢測選項並以價格1試算一次，選項無效時throw(訊息為`invalid <name>: must be <種類>`、`invalid <name>.rule: …`、`invalid <name>.rule.stepSize: …`、`invalid <name>.buffer: …`、`invalid <name>.units: …`，不含輸入值)，buffer與units給了而無效即throw、不改用預設
 * 回傳之getNotional(price)為calcBaseUnitQuantity(price,rule,{buffer,units}).notional，同一價格之結果快取，price無效時throw；key為轉型後選項之識別字串(同key即同結果)，供呼叫端跨次重用
 * 回傳之unit為轉型後之選項物件{rule:{stepSize,minQty,minNotional},buffer,units}(各值皆為Number，buffer與units未給時已填入預設0.1與1；每次呼叫本函數回傳之unit皆為新物件，事後修改不影響getNotional)，同key之unit再傳入本函數得同一key，供下游(如求解與策略檔)直接寫入settings.unit而不必自行轉型
 * 建立時之檢測為以價格1試算一次(通過只代表price為1時可計算；其他價格時格數超過安全整數或數量與名義超出雙精度範圍者，於getNotional(price)時throw)
 *
 * Unit Test: {@link https://github.com/yuda-lyu/w-trade-backtest/blob/master/test/unit-WTradeBacktest.test.mjs Github}
 * @function
 * @param {Object} unit 輸入基礎單位選項物件，需含rule({stepSize,minQty,minNotional})，可含buffer(預設0.1)與units(預設1)
 * @param {String} [name='unit'] 輸入錯誤訊息所用之選項名稱字串，預設'unit'
 * @returns {Object} 回傳物件，內含key(選項識別字串)、getNotional(price)(回傳該價格之每單名義)與unit(轉型後之選項物件{rule:{stepSize,minQty,minNotional},buffer,units}，各值為Number)
 * @example
 *
 * let bu = buildBaseUnitNotional({ rule: { stepSize: 0.001, minQty: 0.001, minNotional: 20 } })
 * console.log(bu.key)
 * // => '0.001|0.001|20|0.1|1'
 * console.log(bu.getNotional(1999))
 * // => 23.988
 *
 * //數字字串通過檢測後轉為Number, 並於unit回傳(未給之buffer與units為預設)
 * let bu2 = buildBaseUnitNotional({ rule: { stepSize: '0.001', minQty: ' 0.001 ', minNotional: '20' }, units: '2' })
 * console.log(bu2.unit)
 * // => { rule: { stepSize: 0.001, minQty: 0.001, minNotional: 20 }, buffer: 0.1, units: 2 }
 *
 */
let buildBaseUnitNotional = (unit, name = 'unit') => {

    //check, 依參數順序由左至右(rule, buffer, units), 解析結果為新物件, 呼叫端事後修改unit不影響快取
    if (!isPlainObject(unit)) {
        throw new Error(`invalid ${name}: must be an object`)
    }
    let rule = parseBaseUnitRule(unit.rule, `${name}.rule`)
    let { buffer, units } = parseBaseUnitOpt(unit, name)

    //以價格1試算一次, 步長格數超過安全整數或數量與名義超出雙精度範圍者於建立時即throw(訊息之名稱改為選項名, 原因不變)
    try {
        calcBaseUnitCore(1, rule, buffer, units)
    }
    catch (err) {
        throw new Error(String(err.message).replace(/^invalid price or rule: /, `invalid ${name}: `))
    }

    //key
    let key = `${rule.stepSize}|${rule.minQty}|${rule.minNotional}|${buffer}|${units}`

    //getNotional, 同一價格快取
    let memo = new Map()
    let getNotional = (price) => {
        let v = memo.get(price)
        if (v === undefined) {
            v = calcBaseUnitCore(parseBaseUnitPrice(price), rule, buffer, units).notional
            memo.set(price, v)
        }
        return v
    }

    //unit, 轉型後之選項(新物件, 與getNotional內部使用者互不共用)
    let unitParsed = {
        rule: { stepSize: rule.stepSize, minQty: rule.minQty, minNotional: rule.minNotional },
        buffer,
        units,
    }

    return {
        key,
        getNotional,
        unit: unitParsed,
    }
}


export default buildBaseUnitNotional
