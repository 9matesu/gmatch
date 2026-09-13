#!/usr/bin/env bash
# Wave 2 (F2): leak grep gate. Every grep must print NOTHING; the script
# exits 1 on the first hit. Run from the repo root: bash scripts/security-greps.sh
set -u
FAIL=0
G() {
  local desc="$1" cmd="$2"
  local hits
  hits=$(eval "$cmd" 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "LEAK: $desc"
    echo "$hits"
    FAIL=1
  fi
}

G "IP headers logged" \
  "grep -rn 'console\.\(log\|warn\|error\).*x-forwarded-for\|console\.\(log\|warn\|error\).*x-real-ip\|console\.\(log\|warn\|error\).*remoteAddress' apps/api/src --include='*.ts' | grep -v test"
G "IP headers read outside limiter/redaction" \
  "grep -rn 'x-forwarded-for\|x-real-ip\|remoteAddress' apps/api/src --include='*.ts' | grep -v test | grep -v 'rate-limit\|security-headers'"
G "old hardcoded admin fallback (outside its own regression test)" \
  "grep -rn 'Ionwarehouse' apps --include='*.ts' --include='*.cjs' | grep -v 'admin-pin.test'"
G "non-relay ICE policy" \
  "grep -rn 'iceTransportPolicy.*all' apps/desktop/src --include='*.ts' | grep -v test"
G "telemetry/analytics network calls" \
  "grep -rn 'sentry\|beacon(\|google-analytics\|posthog\|mixpanel' apps/desktop/src --include='*.ts' --include='*.tsx' | grep -v test"
G "raw endpoint_hint rendered as JSX text" \
  "grep -rn '>{s.endpoint_hint\\|{s.endpoint_hint ||' apps/desktop/src --include='*.tsx' | grep -v maskedServerUrl | grep -v test"

G "admin bypass on the object read path" \
  "grep -rn 'isAdminUser' apps/api/src/routes/objects.ts"
G "bulk per-user asset sweep route" \
  "grep -n \"admin.get('/users/:id/objects\" apps/api/src/routes/admin.ts"
G "admin chat touching private messages" \
  "grep -n "channel === 'dm'" apps/api/src/routes/admin.ts"
G "spy hack reading DM bodies" \
  "grep -n 'SELECT body.*FROM PrivateMessages\|SELECT.*FROM PrivateMessages' apps/api/src/routes/users.ts"

G "legacy /api/pm mount is dead"   "grep -n \"route('/api/pm\" apps/api/src/index.ts"

if [ "$FAIL" -eq 0 ]; then echo "ALL GREPS CLEAN"; else exit 1; fi
