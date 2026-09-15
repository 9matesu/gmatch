// #/watch?room=<8hex> invite deep link: parse + consume, pure + testable.
export function watchRoomFromHash(hash: string): string | null {
  const q = hash.split('?')[1] || ''
  const room = new URLSearchParams(q).get('room') || ''
  return /^[0-9a-f]{8}$/i.test(room) ? room.toLowerCase() : null
}

export function stripWatchRoom(hash: string): string {
  return hash.includes('?') ? hash.split('?')[0] : hash
}
