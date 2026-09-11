/** Native notification, ONLY while the window is hidden — in-app screens
 * already speak in the foreground; this is the exactly-one-channel rule. */
export function notifyWhenHidden(body: string, title = 'gMatch'): void {
  try {
    if (typeof document === 'undefined' || !document.hidden) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    new Notification(title, { body, icon: '/icon-192.png', tag: `gmatch-${Date.now()}` })
  } catch {
    /* notification is best-effort */
  }
}
