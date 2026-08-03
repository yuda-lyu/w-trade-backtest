import assert from 'assert'
import genKLinesTpSl from '../src/genKLinesTpSl.mjs'
import { t00, t04, t08, t12, t16, t20, buildArrOhlc } from './unit-setup.mjs'


//規格來源: src/genKLinesTpSl.mjs
//  genKLinesTpSl(arrOhlc, {tp,sl,mode}): 各根K線以Close為進場價往後掃first-touch, long以Low<=(1-sl)判止損先於High>=(1+tp)判止盈,
//    short以High>=(1+sl)判止損先於Low<=(1-tp)判止盈, 回傳{time,pnl,win,hold}, win為1/0/-1(止盈/止損/未結), 未結pnl與hold為NaN


describe('genKLinesTpSl', function() {

    it('long: 各根以Close為進場價往後掃first-touch, 同根同觸先判止損, 掃至序列末未觸者win為-1', function() {
        let r = genKLinesTpSl(buildArrOhlc(), { tp: 0.05, sl: 0.05, mode: 'long' })
        //t00: e=100, up=105, dn=95, t04之High=106觸止盈
        //t04: e=105, up=110.25, dn=99.75, t12之Low=94觸止損(位移2)
        //t08: e=103, up=108.15, dn=97.85, t12之Low=94觸止損
        //t12: e=95, up=99.75, dn=90.25, t16與t20皆未觸
        //t16: e=93, up=97.65, dn=88.35, t20之High=99觸止盈
        //t20: 末根無後續K棒
        assert.deepStrictEqual(Array.from(r.win), [1, 0, 0, -1, 1, -1])
        assert.deepStrictEqual(Array.from(r.hold), [1, 2, 1, NaN, 1, NaN])
        assert.deepStrictEqual(Array.from(r.pnl), [0.05, -0.05, -0.05, NaN, 0.05, NaN])
        assert.deepStrictEqual(r.time, [t00, t04, t08, t12, t16, t20])
    })

    it('short: 以High>=(1+sl)判止損先於Low<=(1-tp)判止盈', function() {
        let r = genKLinesTpSl(buildArrOhlc(), { tp: 0.05, sl: 0.05, mode: 'short' })
        //t00: e=100, upS=105, dnS=95, t04之High=106觸止損
        //t04: e=105, upS=110.25, dnS=99.75, t12之Low=94觸止盈(位移2)
        //t16: e=93, upS=97.65, dnS=88.35, t20之High=99觸止損
        assert.deepStrictEqual(Array.from(r.win), [0, 1, 1, -1, 0, -1])
        assert.deepStrictEqual(Array.from(r.hold), [1, 2, 1, NaN, 1, NaN])
    })

    it('mode預設long', function() {
        let r = genKLinesTpSl(buildArrOhlc(), { tp: 0.05, sl: 0.05 })
        assert.deepStrictEqual(Array.from(r.win), [1, 0, 0, -1, 1, -1])
    })

    it('tp或sl非正數時throw', function() {
        assert.throws(() => genKLinesTpSl(buildArrOhlc(), { sl: 0.05 }), { message: `genKLinesTpSl: invalid tp[undefined] / sl[0.05]` })
        assert.throws(() => genKLinesTpSl(buildArrOhlc(), { tp: 0.05, sl: 0 }), { message: `genKLinesTpSl: invalid tp[0.05] / sl[0]` })
    })

})
