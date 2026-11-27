'use strict'

// Resilient supervision of the local API sidecar: restart on crash OR on a
// failed health probe, with capped exponential backoff. The old handler
// restarted once ever, then gave up — a sidecar that died while the app sat
// idle was never brought back and the profile read empty.
//
// Guards added after the first version killed a HEALTHY sidecar under load:
//  - debounce: a restart needs N consecutive failed probes (a busy Bun/SQLite
//    event loop can make one /api/health answer slow or time out);
//  - a healthy answer (or a crash handled while a restart is pending) CANCELS
//    the pending restart — otherwise a backoff timer fires after recovery and
//    stops a perfectly good node;
//  - probes are serialised and generation-tagged, so a slow reply from before
//    a recovery cannot contribute a stale failure to a new streak;
//  - the old process is stopped AND the port is confirmed free before a new
//    spawn, so a dying child holding :8790 cannot collide (EADDRINUSE).
// The restart budget resets on EVERY healthy probe, not just at boot.

const SIDECAR_MAX_RESTARTS = 5
const SIDECAR_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]
const FAILS_BEFORE_RESTART = 3

function createSidecarSupervisor({ apiSidecar, log, onError }) {
  let expected = false
  let restarts = 0
  let consecutiveFails = 0
  let restartTimer = null
  let restartInFlight = false
  let probeInFlight = false
  let watchTimer = null
  // Bumped on every healthy answer. An async probe/restart that started in an
  // older generation is ignored when it finally settles.
  let epoch = 0

  const markHealthy = () => {
    expected = true
    consecutiveFails = 0
    restarts = 0
    epoch += 1
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
      log('sidecar: pending restart cancelled - node answered')
    }
  }

  const isHealthyNow = () => apiSidecar.ping(2000).then((healthy) => Boolean(healthy)).catch(() => false)

  const restart = (reason) => {
    if (restartTimer || restartInFlight) return // one restart in flight at a time
    if (restarts >= SIDECAR_MAX_RESTARTS) {
      log(`sidecar: giving up after ${restarts} restarts (${reason})`)
      if (onError) onError()
      return
    }
    const delay = SIDECAR_BACKOFF_MS[Math.min(restarts, SIDECAR_BACKOFF_MS.length - 1)]
    restarts += 1
    consecutiveFails = 0
    const startedAt = epoch
    log(`sidecar: restart #${restarts} in ${delay}ms (${reason})`)
    restartTimer = setTimeout(() => {
      restartTimer = null
      restartInFlight = true
      void (async () => {
        // A HEALTHY sidecar that already answers on :8790 (the adopted one,
        // not our child) must not be "restarted": a spawn dies with EADDRINUSE
        // and burns the restart budget while the app is served fine.
        const healthy = await isHealthyNow()
        if (healthy || startedAt !== epoch) {
          markHealthy()
          log(`sidecar: ${reason} ignored - :8790 is answering (adopted)`)
          return
        }
        // A hung child still holding :8790 must be stopped first; otherwise
        // startApi() either adopts it (still hung) or a new spawn dies with
        // EADDRINUSE. Killing is asynchronous at the OS level: wait for the
        // port to actually close before starting the replacement.
        try {
          if (apiSidecar.isRunning && apiSidecar.isRunning()) apiSidecar.stopApi()
        } catch {
          /* best effort */
        }
        if (apiSidecar.waitForPortFree) {
          const free = await apiSidecar.waitForPortFree()
          if (!free) {
            log('sidecar: :8790 still bound after stopping the old child; retrying restart')
            // restart() refuses while one is in flight; queue it after this
            // async run has released the flag.
            setTimeout(() => restart('port-still-bound'), 0)
            return
          }
        }
        if (startedAt !== epoch) {
          log('sidecar: restart skipped - node recovered while the port was closing')
          return
        }
        await apiSidecar.startApi()
        markHealthy()
        log('sidecar: restarted ok')
      })()
        .catch((e) => {
          log(`sidecar: restart failed: ${e && e.message ? e.message : e}`)
          void restart('restart-failed')
        })
        .finally(() => { restartInFlight = false })
    }, delay)
    if (typeof restartTimer.unref === 'function') restartTimer.unref()
  }

  const probe = () => {
    // Probes keep running during a pending restart: a recovery must be able
    // to cancel the backoff timer. A failure cannot schedule a SECOND restart
    // while one is pending (restart() itself rejects that).
    if (!expected || probeInFlight) return null
    probeInFlight = true
    const startedAt = epoch
    // Start the ping synchronously so a second probe cannot slip in before
    // the in-flight flag is visible; return the chain so it can be awaited.
    let pending
    try {
      pending = Promise.resolve(apiSidecar.ping(3000))
    } catch (err) {
      pending = Promise.reject(err)
    }
    return pending
      .then((result) => {
        if (startedAt !== epoch) return // node recovered while we were probing
        if (result) {
          markHealthy() // one good answer clears the streak and the budget
          return
        }
        consecutiveFails += 1
        if (consecutiveFails >= FAILS_BEFORE_RESTART) void restart('unhealthy')
      })
      .catch(() => {
        if (startedAt !== epoch) return
        consecutiveFails += 1
        if (consecutiveFails >= FAILS_BEFORE_RESTART) void restart('unhealthy')
      })
      .finally(() => { probeInFlight = false })
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
      void isHealthyNow()
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
    _state: () => ({
      restarts,
      consecutiveFails,
      epoch,
      restartInFlight,
      running: apiSidecar.isRunning ? apiSidecar.isRunning() : null,
    }),
  }
}

module.exports = { createSidecarSupervisor, SIDECAR_MAX_RESTARTS, SIDECAR_BACKOFF_MS, FAILS_BEFORE_RESTART }
