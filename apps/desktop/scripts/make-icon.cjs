// Generates build/icon.ico (Windows) and build/icon.png (Linux) from
// public/icon.svg. The PNG is the 512x512 icon electron-builder requires for
// AppImage/deb; both are derived from the same source, no OS-only assets.
// Run: node scripts/make-icon.cjs (from apps/desktop)
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { Resvg } = require('@resvg/resvg-js')
const pngToIco = require('png-to-ico').default || require('png-to-ico')

const svg = readFileSync(join(__dirname, '..', 'public', 'icon.svg'), 'utf8')
const sizes = [512, 256, 128, 64, 48, 32, 16]
const pngs = sizes.map((s) => {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: s } })
  return r.render().asPng()
})

Promise.resolve(pngToIco(pngs.slice(1)))
  .then((ico) => {
    const out = join(__dirname, '..', 'build', 'icon.ico')
    writeFileSync(out, ico)
    console.log(`wrote ${out} (${ico.length} bytes, sizes ${sizes.slice(1).join('/')})`)
    const pngOut = join(__dirname, '..', 'build', 'icon.png')
    writeFileSync(pngOut, pngs[0])
    console.log(`wrote ${pngOut} (${pngs[0].length} bytes, 512x512)`)
  })
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
