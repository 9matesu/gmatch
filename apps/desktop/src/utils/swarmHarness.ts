"use client";

import { restoreIdentity } from '@orbit/crypto'
import { createSwarmSession, sha256HexBlob, type SwarmMessage, type SwarmReceiptIdentity, type SwarmSession } from './p2pSwarm'

/**
 * In-process multi-instance swarm harness (roadmap L3, in-process layer).
 *
 * Composes fully isolated `createSwarmSession` nodes — each with its own
 * signing identity, its own durable-store map (the model for the vault),
 * and its own receipt state machine — over a controllable in-memory network
 * that supports partitions (isolate/restore), frame duplication, frame
 * drops, and node restarts that survive on the node's durable store.
 *
 * Honest limits: this exercises the PROTOCOL across independent node
 * contexts in one process. It is NOT separate OS processes, real NAT
 * traversal, or the Electron vault — those remain L3's final acceptance
 * gate (real multi-instance + two-machine evidence). The harness network
 * only ever carries `SwarmMessage` frames: by construction, none of the
 * scenarios below can touch a central content API.
 */

export interface HarnessNode {
  readonly id: string
  readonly durable: Map<string, Blob>
  identity: SwarmReceiptIdentity
  session: SwarmSession
}

export class SwarmTestNetwork {
  private readonly nodes = new Map<string, HarnessNode>()
  private readonly isolated = new Set<string>()
  private readonly duplicated = new Set<string>()
  private taps: Array<(fromId: string, msg: SwarmMessage) => boolean> = []
  readonly delivered: Array<{ from: string; msg: SwarmMessage }> = []

  /** A node with a fixed test identity derived from its name. */
  createNode(id: string, durable = new Map<string, Blob>()): HarnessNode {
    const identity = restoreIdentity(
      Array.from(id).map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64),
      'ab'.repeat(32),
    )
    return this.wireNode(id, {
      orbitId: identity.orbitId,
      publicKeyHex: identity.publicKeyHex,
      privateKeyHex: identity.privateKeyHex,
    }, durable)
  }

  /** Replace a node with a fresh session over the SAME durable store: the
   *  restart model — process dies, vault bytes survive, identity is restored. */
  restart(nodeId: string): HarnessNode {
    const old = this.nodes.get(nodeId)
    if (!old) throw new Error(`harness: unknown node ${nodeId}`)
    return this.wireNode(nodeId, old.identity, old.durable)
  }

  isolate(nodeId: string): void { this.isolated.add(nodeId) }
  restore(nodeId: string): void { this.isolated.delete(nodeId) }
  /** Deliver every frame from this node twice (duplicate-delivery fault). */
  duplicateFrom(nodeId: string): void { this.duplicated.add(nodeId) }
  /** Drop frames matching the predicate; returns a cancel handle. */
  dropWhere(tap: (fromId: string, msg: SwarmMessage) => boolean): () => void {
    this.taps.push(tap)
    return () => { this.taps = this.taps.filter((t) => t !== tap) }
  }

  node(nodeId: string): HarnessNode {
    const found = this.nodes.get(nodeId)
    if (!found) throw new Error(`harness: unknown node ${nodeId}`)
    return found
  }

  private wireNode(id: string, identity: SwarmReceiptIdentity, durable: Map<string, Blob>): HarnessNode {
    const node: HarnessNode = { id, durable, identity, session: null as unknown as SwarmSession }
    node.session = createSwarmSession({
      localStore: durable,
      receiptIdentity: identity,
      persist: async (objectId, blob) => { durable.set(objectId, blob) },
      send: (msg) => this.route(id, msg),
    })
    this.nodes.set(id, node)
    return node
  }

  private route(from: string, msg: SwarmMessage): void {
    this.delivered.push({ from, msg })
    if (this.isolated.has(from)) return
    if (this.taps.some((tap) => !tap(from, msg))) return
    const deliveries: Array<[string, SwarmMessage]> = [[from, msg]]
    if (this.duplicated.has(from)) deliveries.push([from, msg])
    for (const [origin, frame] of deliveries) {
      for (const [id, target] of this.nodes) {
        if (id === origin || this.isolated.has(id)) continue
        void target.session.handleMessage(frame)
      }
    }
  }
}

/** Verify a node's durable store holds exactly the expected bytes. */
export async function expectDurableBytes(node: HarnessNode, objectId: string): Promise<string> {
  const blob = node.durable.get(objectId)
  if (!blob) throw new Error(`node ${node.id} does not durably hold ${objectId}`)
  return sha256HexBlob(blob)
}
