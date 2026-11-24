'use strict'

// Resilient supervision of the local API sidecar: restart on crash OR on a
// failed health probe, with capped exponential backoff. The attempt budget
// resets after the sidecar stays healthy, so an occasional crash never exhausts
// it for good — the old handler restarted once ever, then gave up, so a sidecar
// that died while the app sat idle was never brought back and the profile/feed
// read as empty forever.

const SIDECAR_MAX_RESTARTS = 5
const SIDECAR_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]

function createSidecarSupervisor({ apiSidecar, log, onError }) {
  let expected = false
  let restarts = 0
  let restartTimer = null
  let healthySince = 0
  let watchTimer = null

  const markHealthy = () => {
    expected = true
    healthySince = Date.now()
  }

  const restart = (reason) => {
    if (restartTimer) return // one restart in flight at a time
    if (restarts >= SIDECAR_MAX_RESTARTS) {
      log(`sidecar: giving up after ${restarts} restarts (${reason})`)
      if (onError) onError()
      return
    }
    const delay = SIDECAR_BACKOFF_MS[Math.min(restarts, SIDECAR_BACKOFF_MS.length - 1)]
    restarts += 1
    log(`sidecar: restart #${restarts} in ${delay}ms (${reason})`)
    restartTimer = setTimeout(() => {
      restartTimer = null
      void apiSidecar
        .startApi()
        .then(markHealthy)
        .then(() => log('sidecar: restarted ok'))
        .catch((e) => {
          log(`sidecar: restart failed: ${e && e.message ? e.message : e}`)
          void restart('restart-failed')
        })
    }, delay)
    if (typeof restartTimer.unref === 'function') restartTimer.unref()
  }

  const startWatchdog = () => {
    if (watchTimer) return
    // 45s probe: cheap, and catches a hung (not cleanly-exited) sidecar too.
    watchTimer = setInterval(() => {
      if (!expected || restartTimer) return
      void apiSidecar
        .ping(3000)
        .then((healthy) => {
          if (healthy) {
            // Reset the restart budget after a stable minute.
            if (healthySince && Date.now() - healthySince > 60_000) restarts = 0
            return
          }
          void restart('unhealthy')
        })
        .catch(() => void restart('unhealthy'))
    }, 45_000)
    if (typeof watchTimer.unref === 'function') watchTimer.unref()
  }

  return {
    markHealthy,
    crashed: (code) => {
      log(`sidecar crashed code=${code}`)
      void restart('crash')
    },
    startWatchdog,
  }
}

module.exports = { createSidecarSupervisor, SIDECAR_MAX_RESTARTS, SIDECAR_BACKOFF_MS }