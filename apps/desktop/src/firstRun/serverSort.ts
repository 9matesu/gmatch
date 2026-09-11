import type { DirectoryServer } from '../components/servers/ServersView'

export type ServerSort = 'players' | 'name'

function hostOf(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`)
    return u.host.toLowerCase().replace(/:(443|80)$/, '')
  } catch {
    return ''
  }
}

/** Game-browser ordering: the central node row is always first, the rest
 *  sorted by name (A→Z) or players (online desc, members tie-break, unknown
 *  counts last). Central match = same host as the configured directory. */
export function sortDirectoryServers(
  servers: DirectoryServer[],
  centralUrl: string,
  sort: ServerSort,
): DirectoryServer[] {
  const centralHost = hostOf(centralUrl)
  const isCentral = (s: DirectoryServer) =>
    !!centralHost && !!s.endpoint_hint && hostOf(s.endpoint_hint) === centralHost
  const central = servers.filter(isCentral)
  const rest = servers
    .filter((s) => !isCentral(s))
    .sort(
      sort === 'name'
        ? (a, b) => a.name.localeCompare(b.name)
        : (a, b) =>
            (b.online_count ?? -1) - (a.online_count ?? -1) ||
            (b.user_count ?? -1) - (a.user_count ?? -1),
    )
  return [...central, ...rest]
}
