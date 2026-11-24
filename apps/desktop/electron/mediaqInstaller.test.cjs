'use strict'
// Pure decision logic for the mediaq installer (no network, no spawn).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { uvAssetName, uvBinName, installPlan } = require('./mediaqInstaller.cjs')

test('uvAssetName maps each platform/arch to the uv release asset', () => {
  assert.equal(uvAssetName('win32', 'x64'), 'uv-x86_64-pc-windows-msvc.zip')
  assert.equal(uvAssetName('win32', 'arm64'), 'uv-aarch64-pc-windows-msvc.zip')
  assert.equal(uvAssetName('darwin', 'arm64'), 'uv-aarch64-apple-darwin.tar.gz')
  assert.equal(uvAssetName('darwin', 'x64'), 'uv-x86_64-apple-darwin.tar.gz')
  assert.equal(uvAssetName('linux', 'x64'), 'uv-x86_64-unknown-linux-gnu.tar.gz')
  assert.equal(uvAssetName('linux', 'arm64'), 'uv-aarch64-unknown-linux-gnu.tar.gz')
  assert.equal(uvAssetName('freebsd', 'x64'), null, 'unsupported platform has no asset')
})

test('uvBinName is uv.exe on Windows and uv elsewhere', () => {
  assert.equal(uvBinName('win32'), 'uv.exe')
  assert.equal(uvBinName('linux'), 'uv')
  assert.equal(uvBinName('darwin'), 'uv')
})

test('installPlan picks the next step from what is present', () => {
  const base = { platform: 'win32', arch: 'x64' }
  // nothing installed -> install uv first
  expect_install(base, { hasUv: false, hasMediaq: false }, 'install-uv')
  // uv present, mediaq missing -> install mediaq
  expect_install(base, { hasUv: true, hasMediaq: false }, 'install-mediaq')
  // both present -> ready
  expect_install(base, { hasUv: true, hasMediaq: true }, 'ready')
  // unsupported platform -> unsupported, regardless of state
  expect_install({ platform: 'freebsd', arch: 'x64' }, { hasUv: true, hasMediaq: true }, 'unsupported')
})

function expect_install(base, state, step) {
  const plan = installPlan({ ...base, ...state })
  assert.equal(plan.step, step)
  if (step === 'unsupported') assert.equal(plan.asset, null)
  else assert.ok(plan.asset, 'supported plan carries the asset name')
}