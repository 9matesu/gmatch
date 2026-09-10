// node customFolders.test.cjs — exits 1 on failure (repo has no CJS test
// runner for electron/; mirrors the plain-node style of imageCacheMemory).
const assert = require('assert')
const path = require('path')
const { __test } = require('./customFolders.cjs')

const root = path.join('I:', 'pics')

// inside the grant
assert.strictEqual(__test.insideGrant(path.join(root, 'a.jpg'), root), true, 'direct child allowed')
assert.strictEqual(__test.insideGrant(path.join(root, 'sub', 'b.png'), root), true, 'nested child allowed')

// traversal escapes rejected
assert.strictEqual(__test.insideGrant(path.join(root, '..', 'evil.jpg'), root), false, 'dotdot escape rejected')
assert.strictEqual(__test.insideGrant(root + '-other' + path.sep + 'a.jpg', root), false, 'sibling-prefix rejected')
assert.strictEqual(__test.insideGrant(path.join(path.dirname(root), 'other', 'a.jpg'), root), false, 'sibling dir rejected')

console.log('customFolders traversal-guard tests passed')
