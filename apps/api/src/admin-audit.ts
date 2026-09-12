import type { D1Turso } from './db'

/**
 * Append an entry to the admin audit log. Every moderation action (ban,
 * unban, redact, delete, end-match, add-points, resolve-report…) should
 * go through this so we have a forensics trail across admin sessions.
 *
 * Keep the call cheap (single INSERT) and never throw — a moderation action
 * must succeed even if the audit row fails to persist.
 */
export async function logAdminAction(
  db: D1Turso,
  adminId: string,
  action: string,
  target: { id?: string; type?: string } | null,
  reason?: string | null,
): Promise<void> {
  const id = crypto.randomUUID()
  try {
    await db
      .prepare(
        'INSERT INTO AdminAuditLog (id, admin_id, action, target_id, target_type, reason) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(id, adminId, action, target?.id || null, target?.type || null, reason || null)
      .run()
  } catch  {
  }
}
