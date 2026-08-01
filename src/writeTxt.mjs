import fs from 'fs'
import getPathParent from 'wsemi/src/getPathParent.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'


let writeTxt = (fp, tag) => {
    try {
        let fd = getPathParent(fp)
        if (!fsIsFolder(fd)) {
            fsCreateFolder(fd)
        }
        fs.writeFileSync(fp, tag, 'utf8')
    }
    catch (err) {}
}


export default writeTxt
