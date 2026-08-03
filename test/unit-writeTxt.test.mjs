import assert from 'assert'
import fs from 'fs'
import path from 'path'
import writeTxt from '../src/writeTxt.mjs'
import { buildFdTmp } from './unit-setup.mjs'


//規格來源: src/writeTxt.mjs
//  writeTxt(fp, txt): 自動建立上層資料夾後寫出文字檔


let fdTmp = buildFdTmp('writeTxt')


describe('writeTxt', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('自動建立資料夾並寫出文字', function() {
        let fp = path.resolve(fdTmp, 'sub-txt', 'a.txt')
        writeTxt(fp, 'abc中文')
        assert.strictEqual(fs.readFileSync(fp, 'utf8'), 'abc中文')
    })

})
