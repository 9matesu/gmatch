export type ServerMode = 'host' | 'client'

export interface ResolvedServer {
  mode: ServerMode
  url: string
}

export declare function isServerUrl(v: unknown): v is string
export declare function normalizeServerUrl(v: unknown): string | null
export declare function isMode(v: unknown): v is ServerMode
export declare function resolveServerUrl(input: {
  envUrl?: string | null
  stored?: { mode?: string; url?: string } | null
  hostUrl: string
}): ResolvedServer
