import assert from 'assert'
import ott, { nowTpeStr } from '../src/ott.mjs'


//規格來源: src/ott.mjs
//  ott(input): 以dayjs解析秒時間字串為台北時區時間物件, nowTpeStr(): 回傳當下台北時區秒時間字串


describe('ott', function() {

    it('解析秒時間字串並可format與diff', function() {
        assert.strictEqual(ott('2020-01-01T00:00:00').format('YYYY-MM-DD'), '2020-01-01')
        assert.strictEqual(ott('2020-01-03T04:00:00').diff(ott('2020-01-01T20:00:00'), 'day'), 1)
    })

    it('nowTpeStr回傳台北時區秒時間字串', function() {
        assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(nowTpeStr()))
    })

})
