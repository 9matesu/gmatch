export type ServerMode = 'host' | 'client'

export interface ResolvedServer {
  mode: ServerMode
  url: string
}

export declare function isServerUrl(v: unknown): v is string
export declare function normalizeServerUrl(v: unknown): string | null
export declare function isMode(v: unknown): v is ServerMode
export declare function isDecommissionedUrl(v: unknown): boolean
export declare function resolveServerUrl(input: {
  envUrl?: string | null
  stored?: { mode?: string; url?: string } | null
  hostUrl: string
}): ResolvedServer

export declare const CONFIG_VERSION: number
export declare const HEALTH_TIMEOUT_MS: number
export declare function isLoopbackUrl(v: unknown): boolean
export type PauseReason = 'legacy' | 'unreachable'
export declare function isLegacyClientConfig(raw: unknown): boolean
export declare function pauseReasonOf(raw: unknown): PauseReason
export declare function probeHealth(
  url: unknown,
  options?: {
    fetchImpl?: (
      input: string,
      init?: { signal?: AbortSignal; headers?: Record<string, string> },
    ) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
    timeoutMs?: number
  },
): Promise<boolean>
