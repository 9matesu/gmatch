'use strict'

// Resilient supervision of the local API sidecar: restart on crash OR on a
// failed health probe, with capped exponential backoff. The old handler
// restarted once ever, then gave up — a sidecar that died while the app sat
// idle was never brought back and the profile read empty.
//
// Two guards added after the first version killed a HEALTHY sidecar under load:
//  - debounce: a restart needs N consecutive failed probes (a busy Bun/SQLite
//    event loop can make one /api/health answer slow or time out);
//  - stop the old process before restarting, so a hung child on :8790 does not
//    collide with a new spawn (EADDRINUSE — the death the watchdog meant to fix).
// The restart budget resets on EVERY healthy probe, not just at boot.

const SIDECAR_MAX_RESTARTS = 5
const SIDECAR_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]
const FAILS_BEFORE_RESTART = 3

function createSidecarSupervisor({ apiSidecar, log, onError }) {
  let expected = false
  let restarts = 0
  let consecutiveFails = 0
  let restartTimer = null
  let watchTimer = null

  const markHealthy = () => {
    expected = true
    consecutiveFails = 0
    restarts = 0
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
    consecutiveFails = 0
    log(`sidecar: restart #${restarts} in ${delay}ms (${reason})`)
    restartTimer = setTimeout(() => {
      restartTimer = null
      // A HEALTHY sidecar that already answers on :8790 (the adopted one, not
      // our child) must not be "restarted": the spawn dies with EADDRINUSE and
      // burns the restart budget while the app is being served fine. That is
      // what filled main.log with "crashed code=1" + "giving up after 5".
      void apiSidecar
        .ping(2000)
        .then((healthy) => {
          if (healthy) {
            markHealthy()
            log(`sidecar: ${reason} ignored - :8790 is answering (adopted)`)
            return null
          }
          // A hung child still holding :8790 must be stopped first; otherwise
          // startApi() either adopts it (still hung) or a new spawn dies with
          // EADDRINUSE.
          try {
            if (apiSidecar.isRunning && apiSidecar.isRunning()) apiSidecar.stopApi()
          } catch {
            /* best effort */
          }
          return apiSidecar
            .startApi()
            .then(markHealthy)
            .then(() => log('sidecar: restarted ok'))
        })
        .catch((e) => {
          log(`sidecar: restart failed: ${e && e.message ? e.message : e}`)
          void restart('restart-failed')
        })
    }, delay)
    if (typeof restartTimer.unref === 'function') restartTimer.unref()
  }

  const probe = () => {
    if (!expected || restartTimer) return
    void apiSidecar
      .ping(3000)
      .then((healthy) => {
        if (healthy) {
          markHealthy() // one good answer clears the streak and the budget
          return
        }
        consecutiveFails += 1
        if (consecutiveFails >= FAILS_BEFORE_RESTART) void restart('unhealthy')
      })
      .catch(() => {
        consecutiveFails += 1
        if (consecutiveFails >= FAILS_BEFORE_RESTART) void restart('unhealthy')
      })
  }

  const startWatchdog = () => {
    if (watchTimer) return
    // 45s probe x 3 failures = ~2min15 of sustained silence before a restart.
    watchTimer = setInterval(probe, 45_000)
    if (typeof watchTimer.unref === 'function') watchTimer.unref()
  }

  return {
    markHealthy,
    crashed: (code) => {
      // A child that died on EADDRINUSE while a healthy sidecar serves :8790
      // is not an outage: the app is talking to the adopted one.
      void apiSidecar
        .ping(1500)
        .then((healthy) => {
          if (healthy) {
            markHealthy()
            log(`sidecar crashed code=${code} but :8790 answers - adopted, no restart`)
            return
          }
          log(`sidecar crashed code=${code}`)
          void restart('crash')
        })
        .catch(() => {
          log(`sidecar crashed code=${code}`)
          void restart('crash')
        })
    },
    startWatchdog,
    // Exposed for tests: drive probes without waiting 45s.
    _probe: probe,
    _state: () => ({ restarts, consecutiveFails, running: apiSidecar.isRunning ? apiSidecar.isRunning() : null }),
  }
}

module.exports = { createSidecarSupervisor, SIDECAR_MAX_RESTARTS, SIDECAR_BACKOFF_MS, FAILS_BEFORE_RESTART }