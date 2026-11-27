// Survive a closed stdout/stderr pipe.
//
// Writing to a broken pipe does NOT throw at the call site: node emits an
// 'error' EVENT on the stream, so a try/catch around console.log() cannot
// see it. With no 'error' listener, node treats it as an uncaught exception
// and the whole main process dies ("Error: EPIPE: broken pipe, write").
//
// That is not a theoretical hazard: it kills gMatch whenever the app's
// console pipe goes away (the launcher closed, a parent shell exited, a
// service manager detached). One listener per stream, installed once at boot,
// is the whole fix.
const IGNORED = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'])

/**
 * Attach the swallowing 'error' listener to a stream.
 * Returns true when the stream was guarded.
 */
function guardStream(stream) {
  if (!stream || typeof stream.on !== 'function') return false
  if (stream.__gmatchStdioGuarded) return true
  stream.on('error', (err) => {
    // A pipe that went away is a lost LOG, never a lost app.
    if (err && IGNORED.has(err.code)) return
    // Anything else is a real problem: surface it instead of hiding it.
    try { console.error('[stdio]', err) } catch { /* the sink is gone too */ }
  })
  stream.__gmatchStdioGuarded = true
  return true
}

/** Guard the process's own stdout + stderr. Safe to call more than once. */
function guardStdio(proc = process) {
  return [guardStream(proc.stdout), guardStream(proc.stderr)].every(Boolean)
}

module.exports = { guardStdio, guardStream }
