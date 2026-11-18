import assert from 'assert'
import { parseBarTime, calcBtDays, calcDayHoldSpan } from '../src/barTime.mjs'
import ott from '../src/ott.mjs'


//規格來源: 規則帳本R-BT-01(選項與檢測)、R-BT-03(span之持倉天數)、R-BT-04(span之回測天數); src/barTime.mjs(內部用, 不入聚合入口)
//  parseBarTime(obj, name): intervalSec為有效整數(iseint)、60之倍數且介於60與31536000(365日)之間, 數字或整數字串通過即轉為Number; undefined或null為未給(null)
//    timeBasis為'open'或'span', undefined或null視同'open'; 'span'須同時給intervalSec; 無效即throw, 訊息不含輸入值, 不改寫obj
let DESC = 'a positive integer multiple of 60 up to 31536000'


describe('parseBarTime', function() {

    it('未給(obj為undefined、null、{}、兩欄為undefined或null)時回傳{intervalSec:null,timeBasis:open}', function() {
        //R-BT-01: undefined或null為未給
        for (let obj of [undefined, null, {}, { intervalSec: undefined, timeBasis: undefined }, { intervalSec: null, timeBasis: null }]) {
            assert.deepStrictEqual(parseBarTime(obj, 'opt'), { intervalSec: null, timeBasis: 'open' })
        }
    })

    it('intervalSec為60之倍數之有效整數(含整數字串)且不大於31536000時轉為Number, timeBasis原樣', function() {
        //R-BT-01: 數字或整數字串(同本套件units之慣例), 通過即cint轉型; 範圍含兩端60與31536000
        let goods = [
            [14400, 14400], ['86400', 86400], [' 3600 ', 3600], [60, 60], [120, 120], ['3600.0', 3600],
            ['+86400', 86400], ['0086400', 86400], [604800, 604800], [31536000, 31536000], ['31536000', 31536000],
        ]
        for (let [v, n] of goods) {
            assert.deepStrictEqual(parseBarTime({ intervalSec: v }), { intervalSec: n, timeBasis: 'open' }, `intervalSec=${String(v)}`)
        }
        assert.deepStrictEqual(parseBarTime({ intervalSec: '86400', timeBasis: 'span' }), { intervalSec: 86400, timeBasis: 'span' })
        assert.deepStrictEqual(parseBarTime({ intervalSec: ' 3600 ', timeBasis: 'open' }), { intervalSec: 3600, timeBasis: 'open' })
    })

    it('intervalSec無效時throw, 訊息為invalid <name>.intervalSec: must be a positive integer multiple of 60 up to 31536000(不含輸入值)', function() {
        //R-BT-01: 給了而無效即throw, 不改用預設; 非60之倍數、小於60、大於365日(極大值會使span之摘要變成NaN)皆無效
        let bads = [
            0, -1, -60, 1, 59, 61, 90, 3599, 3601, 1.5, '1.5', '1', '1.0', '1e3', 3600.4, '3600.4', '0', '-3600', '', ' ', 'abc', '0x10', 'Infinity',
            31536001, 31536060, '31536060', 1e13, 9e12, 2 ** 52, 2 ** 60,
            NaN, Infinity, -Infinity, true, false, 10n, 3600n, Object(14400), {}, [], [14400], () => 1,
        ]
        for (let v of bads) {
            assert.throws(() => parseBarTime({ intervalSec: v }, 'settings'), (err) => err.message === `invalid settings.intervalSec: must be ${DESC}`, `intervalSec=${typeof v === 'bigint' ? 'bigint' : String(v)}`)
        }
        assert.throws(() => parseBarTime({ intervalSec: 0 }), { message: `invalid opt.intervalSec: must be ${DESC}` })
    })

    it('timeBasis非open或span時throw, 訊息為invalid <name>.timeBasis: must be one of \'open\', \'span\'', function() {
        //R-BT-01: 字串全等, 大小寫與前後空白皆不接受
        let bads = ['', 'OPEN', 'Span', ' span', 'close', 1, 0, true, {}, [], Object('span')]
        for (let v of bads) {
            assert.throws(() => parseBarTime({ intervalSec: 14400, timeBasis: v }, 'opt'), (err) => err.message === `invalid opt.timeBasis: must be one of 'open', 'span'`, `timeBasis=${String(typeof v)}`)
        }
    })

    it('timeBasis為span而未給intervalSec時throw', function() {
        //R-BT-01: span須同時給intervalSec
        for (let obj of [{ timeBasis: 'span' }, { timeBasis: 'span', intervalSec: null }, { timeBasis: 'span', intervalSec: undefined }]) {
            assert.throws(() => parseBarTime(obj, 'strategies[2].settings'), { message: `invalid strategies[2].settings.intervalSec: must be ${DESC} when strategies[2].settings.timeBasis is 'span'` })
        }
        //intervalSec無效者先報intervalSec本身
        assert.throws(() => parseBarTime({ timeBasis: 'span', intervalSec: -1 }, 'opt'), { message: `invalid opt.intervalSec: must be ${DESC}` })
    })

    it('不改寫呼叫端之物件, 各欄只讀取一次', function() {
        //R-BT-01: 不改寫呼叫端之物件
        let obj = { intervalSec: '86400', timeBasis: 'span', other: 1 }
        let snap = JSON.stringify(obj)
        parseBarTime(obj, 'opt')
        assert.strictEqual(JSON.stringify(obj), snap)
        let nRead = 0
        let objGetter = {
            get intervalSec() {
                nRead++
                return 86400
            },
            timeBasis: 'span',
        }
        assert.deepStrictEqual(parseBarTime(objGetter), { intervalSec: 86400, timeBasis: 'span' })
        assert.strictEqual(nRead, 1)
    })

})


describe('calcDayHoldSpan, calcBtDays', function() {

    it('calcDayHoldSpan: 進場棒收盤至出場棒收盤之時長(日), 無條件進位, 至少1日', function() {
        //R-BT-03: 為經過之時長而非根數(日線無缺根時持k根即k日, 有缺根時為經過之日數); 日內以經過時長計, 與午夜位置無關
        let cs = [
            ['2022-07-01T00:00:00', '2022-07-02T00:00:00', 1], //日線次根
            ['2022-07-01T00:00:00', '2022-07-08T00:00:00', 7], //日線持7根
            ['2022-07-01T08:00:00', '2022-07-02T08:00:00', 1], //日線開盤不在0點
            ['2022-07-01T00:00:00', '2022-07-03T00:00:00', 2], //日線07-02缺根: 持1根而經過2日, 取經過之日數
            ['2022-07-01T00:00:00', '2022-07-04T00:00:00', 3], //3日線1根
            ['2024-01-01T00:00:00', '2024-01-15T00:00:00', 14], //週線持2根
            ['2022-07-01T20:00:00', '2022-07-02T00:00:00', 1], //4hr當日最後一根進場、次根出場(現行為2)
            ['2022-07-01T08:00:00', '2022-07-02T04:00:00', 1], //4hr 20小時
            ['2022-07-01T08:00:00', '2022-07-02T08:00:00', 1], //4hr 24小時
            ['2022-07-01T08:00:00', '2022-07-02T12:00:00', 2], //4hr 28小時
            ['2022-07-01T23:00:00', '2022-07-02T00:00:00', 1], //1hr跨午夜
            ['2024-02-29T23:59:00', '2024-03-01T00:00:00', 1], //1分線跨午夜(跨閏日)
            ['2024-02-29T00:00:00', '2024-02-29T23:59:00', 1], //1分線差1分不足1日
            ['2024-02-29T00:00:00', '2024-03-01T00:00:00', 1], //恰1日
            ['2024-02-29T00:00:00', '2024-03-01T00:01:00', 2], //1日又1分(進位)
            ['2024-02-29T00:00:00', '2024-03-01T00:14:00', 2], //1日又14分(進位之邊界: 不可四捨五入)
            ['2024-02-29T00:00:00', '2024-03-02T23:59:00', 3], //2日23時59分
            ['2022-07-01T00:00:00', '2022-07-01T00:00:00', 1], //同時刻(至少1日)
        ]
        for (let [ts, te, d] of cs) {
            assert.strictEqual(calcDayHoldSpan(ott, ts, te), d, `${ts} -> ${te}`)
        }
    })

    it('calcBtDays: open為兩標籤之日差(截斷), span計至末根收盤', function() {
        //R-BT-04
        assert.strictEqual(calcBtDays(ott, '2022-07-01T00:00:00', '2025-04-08T00:00:00', { intervalSec: null, timeBasis: 'open' }), 1012)
        assert.strictEqual(calcBtDays(ott, '2022-07-01T00:00:00', '2025-04-08T00:00:00', { intervalSec: 86400, timeBasis: 'open' }), 1012)
        assert.strictEqual(calcBtDays(ott, '2022-07-01T00:00:00', '2025-04-08T00:00:00', { intervalSec: 86400, timeBasis: 'span' }), 1013)
        assert.strictEqual(calcBtDays(ott, '2022-07-01T00:00:00', '2025-04-08T00:00:00', { intervalSec: 14400, timeBasis: 'span' }), 1012)
        assert.strictEqual(calcBtDays(ott, '2022-07-01T00:00:00', '2022-07-02T20:00:00', { intervalSec: 14400, timeBasis: 'open' }), 1)
        assert.strictEqual(calcBtDays(ott, '2022-07-01T00:00:00', '2022-07-02T20:00:00', { intervalSec: 14400, timeBasis: 'span' }), 2)
        assert.strictEqual(calcBtDays(ott, '2022-07-01T00:00:00', '2022-07-01T23:00:00', { intervalSec: 3600, timeBasis: 'span' }), 1)
        //1分線: 首根23:30、末根次日23:29, span恰1日, open為0
        assert.strictEqual(calcBtDays(ott, '2024-02-29T23:30:00', '2024-03-01T23:29:00', { intervalSec: 60, timeBasis: 'open' }), 0)
        assert.strictEqual(calcBtDays(ott, '2024-02-29T23:30:00', '2024-03-01T23:29:00', { intervalSec: 60, timeBasis: 'span' }), 1)
        //不足1日之窗為0
        assert.strictEqual(calcBtDays(ott, '2024-02-29T00:00:00', '2024-02-29T22:00:00', { intervalSec: 3600, timeBasis: 'span' }), 0)
        //週線12根: open 77日, span 84日
        assert.strictEqual(calcBtDays(ott, '2024-01-01T00:00:00', '2024-03-18T00:00:00', { intervalSec: 604800, timeBasis: 'open' }), 77)
        assert.strictEqual(calcBtDays(ott, '2024-01-01T00:00:00', '2024-03-18T00:00:00', { intervalSec: 604800, timeBasis: 'span' }), 84)
        //每根時長與資料間距不符時不檢查: 日線之窗給14400則只加4小時(截斷後與open同), 給604800則多算6日
        assert.strictEqual(calcBtDays(ott, '2023-01-01T00:00:00', '2023-01-07T00:00:00', { intervalSec: 14400, timeBasis: 'span' }), 6)
        assert.strictEqual(calcBtDays(ott, '2023-01-01T00:00:00', '2023-01-07T00:00:00', { intervalSec: 604800, timeBasis: 'span' }), 13)
    })

})
