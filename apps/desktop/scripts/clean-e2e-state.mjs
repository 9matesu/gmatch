// Remove every artifact an e2e run leaves behind.
//
// The suite is designed to be hermetic: the dev-sidecar plugin boots a throwaway
// node on port 8791 and, with GMATCH_API_FRESH=1, unlinks the database before
// spawning it. Two things used to defeat that:
//
//   1. nothing tore the sidecar down, so each run orphaned a `bun serve.ts` on
//      8791. The next run found a healthy sidecar, ADOPTED it, and returned
//      before the wipe — silently stacking runs onto the previous database;
//   2. even a clean run left the files on disk between runs, so an interrupted
//      run's users survived to appear as User_xxxxxx in the directory.
//
// (1) is fixed in vite.config.ts, which now kills the child on shutdown and
// refuses to adopt a sidecar when GMATCH_API_FRESH=1. This script is for the
// other direction: clearing what earlier runs already left behind.
//
// Safe to run at any time. It only touches the e2e data directory, which is
// never used by `npm run dev` (that is port 8790 with its own path).
import { existsSync, rmSync } from 'node:fs'

const DATA_DIR = process.env.GMATCH_E2E_DATA_DIR || 'I:/tmp/gmatch-e2e'

if (!existsSync(DATA_DIR)) {
  console.log(`[e2e:clean] nothing to do — ${DATA_DIR} does not exist`)
} else {
  rmSync(DATA_DIR, { recursive: true, force: true })
  console.log(`[e2e:clean] removed ${DATA_DIR} (database, blobs and watch-party snapshot)`)
}

// A sidecar still holding the port would immediately repopulate the directory,
// so say so rather than leaving the user to wonder why it came back.
try {
  const health = await fetch('http://127.0.0.1:8791/api/health', { signal: AbortSignal.timeout(1500) })
  if (health.ok) {
    console.log(
      '[e2e:clean] WARNING: a sidecar is still running on 8791 and will recreate files.\n' +
        '            Stop it first, or the next run will inherit its users.',
    )
  }
} catch {
  /* nothing listening, which is what we want */
}
