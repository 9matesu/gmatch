/** Mask IPv4 hosts before anything is rendered — the player's LAN/public IP
 * is never shown. Copy buttons may still write the real value. */
export function maskIp(input: string): string {
  return input.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, '$1.$2.•••.•••')
}

export function maskedServerUrl(url: string): string {
  return maskIp(url)
}
