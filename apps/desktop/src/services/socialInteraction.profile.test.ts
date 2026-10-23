import { describe, expect, it } from 'vitest'
import { restoreIdentity } from '@orbit/crypto'
import { SocialOperationLog, type LoggedOperation, type OperationLogBackend } from '../services/socialOperationLog'
import { acceptInboundOperation } from '../services/socialOpTransport'
import { projectProfiles, publishProfileUpdate } from '../services/socialInteraction'

const ME = restoreIdentity('00'.repeat(32), '11'.repeat(32))
const PEER = restoreIdentity('22'.repeat(32), '33'.repeat(32))

function memoryBackend(): OperationLogBackend & { store: Map<string, LoggedOperation> } {
  const store = new Map<string, LoggedOperation>()
  return {
    store,
    async put(entry) { store.set(entry.operationId, entry) },
    async get(id) { return store.get(id) ?? null },
    async getAll() { return [...store.values()] },
    async delete(id) { store.delete(id) },
  }
}

const newLog = () => new SocialOperationLog(memoryBackend())

describe('profile fields as versioned replicated operations (P1)', () => {
  it('publishes, projects, and converges across replicas regardless of arrival order', async () => {
    const authorLog = newLog()
    const first = await publishProfileUpdate(ME, { displayName: 'gooner', bio: 'firs bio' }, authorLog)
    const second = await publishProfileUpdate(ME, { bio: 'second bio' }, authorLog)
    expect(second.payload.displayName).toBeUndefined()
    expect(second.previousOperationId).toBe(first.operationId)

    // A peer replicates BOTH operations (in chain order — the authorizer
    // refuses a successor before its predecessor), then projects from a list
    // whose order is scrambled: the resolution must not depend on it.
    const replicaLog = newLog()
    for (const operation of [first, second]) {
      expect(await acceptInboundOperation(replicaLog, operation)).toBe('accepted')
    }
    const scrambled = (await replicaLog.listAllOperations()).slice().reverse()
    const projected = projectProfiles(scrambled).get(ME.orbitId)
    expect(projected?.displayName).toBe('gooner')
    expect(projected?.bio).toBe('second bio')
    expect(projected?.operationId).toBe(second.operationId)
    expect(projected?.actorSequence).toBe(2)
    // The author's own projection agrees (single source of truth = the log).
    expect(projectProfiles(await authorLog.listAllOperations()).get(ME.orbitId)?.bio).toBe('second bio')
  })

  it('an empty field is an explicit clear; an omitted field is unchanged', async () => {
    const log = newLog()
    await publishProfileUpdate(ME, { displayName: 'gooner', bio: 'stuff' }, log)
    await publishProfileUpdate(ME, { bio: '' }, log)
    const profile = projectProfiles(await log.listAllOperations()).get(ME.orbitId)
    expect(profile?.displayName).toBe('gooner')
    expect(profile?.bio).toBe('')
    expect(profile?.bio).not.toBeUndefined()
  })

  it('another actor\'s profile lives under that actor\'s key, never mine', async () => {
    const log = newLog()
    await publishProfileUpdate(ME, { displayName: 'me' }, log)
    await publishProfileUpdate(PEER, { displayName: 'them' }, log)
    const profiles = projectProfiles(await log.listAllOperations())
    expect(profiles.get(ME.orbitId)?.displayName).toBe('me')
    expect(profiles.get(PEER.orbitId)?.displayName).toBe('them')
  })

  it('an update naming no field is refused', async () => {
    const log = newLog()
    await expect(publishProfileUpdate(ME, {}, log)).rejects.toThrow(/at least one field/)
  })
})
