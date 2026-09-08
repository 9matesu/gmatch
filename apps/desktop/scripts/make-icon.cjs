// Generates build/icon.ico from public/icon.svg (P5.1).
// Run: node scripts/make-icon.cjs (from apps/desktop)
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { Resvg } = require('@resvg/resvg-js')
const pngToIco = require('png-to-ico').default || require('png-to-ico')

const svg = readFileSync(join(__dirname, '..', 'public', 'icon.svg'), 'utf8')
const sizes = [256, 128, 64, 48, 32, 16]
const pngs = sizes.map((s) => {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: s } })
  return r.render().asPng()
})

Promise.resolve(pngToIco(pngs))
  .then((ico) => {
    const out = join(__dirname, '..', 'build', 'icon.ico')
    writeFileSync(out, ico)
    console.log(`wrote ${out} (${ico.length} bytes, sizes ${sizes.join('/')})`)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
