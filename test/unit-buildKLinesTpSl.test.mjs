import assert from 'assert'
import fs from 'fs'
import path from 'path'
import buildKLinesTpSl from '../src/buildKLinesTpSl.mjs'
import { t00, t04, t08, t12, t16, t20, buildArrOhlc, buildFdTmp } from './unit-setup.mjs'


//規格來源: src/buildKLinesTpSl.mjs
//  buildKLinesTpSl(fdOhlc, fdParam, fpJson, opt): 讀取opt.keyOhlc序列於opt.ts至opt.te範圍, 逐一組合opt.modes與opt.tps跑genKLinesTpSl,
//    以`${mode}_${tpsl}`為key存{win,timeEnd}(timeEnd由hold位移換算絕對時間, 未結為null)至bars, 回傳{meta,bars}並寫出fpJson


let fdTmp = buildFdTmp('buildKLinesTpSl')


describe('buildKLinesTpSl', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    //buildFdOhlc: 於`${fdTmp}/${fd}`建立data-ohlc(btc.json)與data-param(空), 回傳兩資料夾路徑
    let buildFdOhlc = (fd) => {
        let fdOhlc = path.resolve(fdTmp, fd, 'data-ohlc')
        let fdParam = path.resolve(fdTmp, fd, 'data-param')
        fs.mkdirSync(fdOhlc, { recursive: true })
        fs.mkdirSync(fdParam, { recursive: true })
        fs.writeFileSync(path.resolve(fdOhlc, 'btc.json'), JSON.stringify(buildArrOhlc()), 'utf8')
        return { fdOhlc, fdParam }
    }

    it('產出meta與bars並寫出fpJson, timeEnd由hold位移換算絕對時間, 未結為null', async function() {
        let { fdOhlc, fdParam } = buildFdOhlc('bkts-basic')
        let fpJson = path.resolve(fdTmp, 'bkts-basic', 'cache', 'kltpsl.json') //cache資料夾不存在, 應自動建立

        let r = await buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'btc', ts: t00, te: t20, tps: [5], modes: ['long'] })

        //meta
        assert.deepStrictEqual(r.meta, { keyOhlc: 'btc', ts: t00, te: t20, tps: [5], modes: ['long'], nBars: 6 })

        //bars, 各根close與long_5之{win,timeEnd}
        assert.deepStrictEqual(Object.keys(r.bars), [t00, t04, t08, t12, t16, t20])
        assert.deepStrictEqual(r.bars[t00], { close: 100, long_5: { win: 1, timeEnd: t04 } })
        assert.deepStrictEqual(r.bars[t04], { close: 105, long_5: { win: 0, timeEnd: t12 } })
        assert.deepStrictEqual(r.bars[t12], { close: 95, long_5: { win: -1, timeEnd: null } })
        assert.deepStrictEqual(r.bars[t20], { close: 97, long_5: { win: -1, timeEnd: null } })

        //fpJson, 內容與回傳一致
        assert.ok(fs.existsSync(fpJson))
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(fpJson, 'utf8')), r)
    })

    it('各mode與tps組合各存一組key', async function() {
        let { fdOhlc, fdParam } = buildFdOhlc('bkts-keys')
        let fpJson = path.resolve(fdTmp, 'bkts-keys', 'kltpsl.json')

        let r = await buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'btc', ts: t00, te: t20, tps: [5, 10], modes: ['long', 'short'] })

        assert.deepStrictEqual(Object.keys(r.bars[t00]), ['close', 'long_5', 'long_10', 'short_5', 'short_10'])
        //tpsl=10時t00之up=110, dn=90, 其後K棒皆未觸發
        assert.deepStrictEqual(r.bars[t00].long_10, { win: -1, timeEnd: null })
        assert.deepStrictEqual(r.bars[t00].short_5, { win: 0, timeEnd: t04 })
    })

    it('ts至te僅取範圍內K線', async function() {
        let { fdOhlc, fdParam } = buildFdOhlc('bkts-range')
        let fpJson = path.resolve(fdTmp, 'bkts-range', 'kltpsl.json')

        let r = await buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'btc', ts: t04, te: t12, tps: [5], modes: ['long'] })

        assert.strictEqual(r.meta.nBars, 3)
        assert.deepStrictEqual(Object.keys(r.bars), [t04, t08, t12])
    })

    it('fdOhlc非資料夾時reject', async function() {
        let { fdParam } = buildFdOhlc('bkts-invalid')
        let fdOhlc = path.resolve(fdTmp, 'bkts-invalid', 'none')
        let fpJson = path.resolve(fdTmp, 'bkts-invalid', 'kltpsl.json')
        await assert.rejects(buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'btc', ts: t00, te: t20 }), { message: `fdOhlc[${fdOhlc}] is not a folder` })
    })

    it('fdParam非資料夾時reject', async function() {
        let { fdOhlc } = buildFdOhlc('bkts-invalid2')
        let fdParam = path.resolve(fdTmp, 'bkts-invalid2', 'none')
        let fpJson = path.resolve(fdTmp, 'bkts-invalid2', 'kltpsl.json')
        await assert.rejects(buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'btc', ts: t00, te: t20 }), { message: `fdParam[${fdParam}] is not a folder` })
    })

    it('fpJson非有效字串, opt.keyOhlc非有效字串, opt.ts或opt.te非時間字串時reject', async function() {
        let { fdOhlc, fdParam } = buildFdOhlc('bkts-invalid3')
        let fpJson = path.resolve(fdTmp, 'bkts-invalid3', 'kltpsl.json')
        await assert.rejects(buildKLinesTpSl(fdOhlc, fdParam, '', { keyOhlc: 'btc', ts: t00, te: t20 }), { message: `invalid fpJson` })
        await assert.rejects(buildKLinesTpSl(fdOhlc, fdParam, fpJson, { ts: t00, te: t20 }), { message: `invalid opt.keyOhlc` })
        await assert.rejects(buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'btc', ts: 'x', te: t20 }), { message: `invalid opt.ts` })
        await assert.rejects(buildKLinesTpSl(fdOhlc, fdParam, fpJson, { keyOhlc: 'btc', ts: t00, te: 'x' }), { message: `invalid opt.te` })
    })

})
