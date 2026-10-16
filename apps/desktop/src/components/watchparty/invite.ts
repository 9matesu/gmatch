// #/watch?room=<8hex> invite deep link: parse + consume, pure + testable.
export function watchRoomFromHash(hash: string): string | null {
  return watchInviteFromHash(hash)?.room || null
}

export function watchInviteFromHash(hash: string): { room: string; invite?: string } | null {
  const q = hash.split('?')[1] || ''
  const params = new URLSearchParams(q)
  const room = (params.get('room') || '').toLowerCase()
  if (!/^[0-9a-f]{8}$/.test(room)) return null
  const invite = params.get('invite') || ''
  // Private-room invite tokens are opaque bearer values. Accept the minted
  // shape; anything else is ignored rather than sent to the server.
  if (/^[0-9a-f]{32}$/i.test(invite)) return { room, invite: invite.toLowerCase() }
  return { room }
}

export function stripWatchRoom(hash: string): string {
  return hash.includes('?') ? hash.split('?')[0] : hash
}
