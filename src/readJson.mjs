import fs from 'fs'
import w from 'wsemi'


let readJson = (fp) => {

    //check
    if (!w.fsIsFile(fp)) {
        throw new Error(`fp[${fp}] does not exist`)
    }

    //obj
    let obj = null
    try {
        let j = fs.readFileSync(fp, 'utf8')
        obj = JSON.parse(j)
    }
    catch (err) {
        console.log(err)
    }

    return obj
}


export default readJson
