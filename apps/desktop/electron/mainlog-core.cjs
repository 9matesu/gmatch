// main.log writer with a hard size cap: append, rotate to .1 when > maxBytes.
const fs = require('node:fs')

function appendWithRotation(file, line, maxBytes = 1024 * 1024) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
      fs.rmSync(file + '.1', { force: true })
      fs.renameSync(file, file + '.1')
    }
  } catch { /* rotation is best-effort; never lose the append for it */ }
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\r\n`)
}

module.exports = { appendWithRotation }
