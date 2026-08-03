import assert from 'assert'
import fs from 'fs'
import path from 'path'
import writeJson from '../src/writeJson.mjs'
import { buildFdTmp } from './unit-setup.mjs'


//規格來源: src/writeJson.mjs
//  writeJson(fp, obj, {structured}): 自動建立上層資料夾後寫出json, structured:true為多行縮排


let fdTmp = buildFdTmp('writeJson')


describe('writeJson', function() {

    after(function() {
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    it('自動建立資料夾並寫出json, structured:true為多行縮排', function() {
        let fp = path.resolve(fdTmp, 'sub-json', 'a.json')
        writeJson(fp, { a: 1, b: [2, 3] }, { structured: true })
        let c = fs.readFileSync(fp, 'utf8')
        assert.deepStrictEqual(JSON.parse(c), { a: 1, b: [2, 3] })
        assert.ok(c.includes('\n'))
    })

})
