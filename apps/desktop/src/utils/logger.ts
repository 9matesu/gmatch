type Bridge = { logError?: (scope: string, msg: string) => void }

function report(level: string, scope: unknown, args: unknown[]): void {
  try {
    const g = (typeof window !== 'undefined' ? (window as { gmatch?: Bridge }).gmatch : undefined)
    const msg = args
      .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : String(a)))
      .join(' ')
    if (g?.logError) g.logError(String(scope ?? level), `${level}: ${msg}`.slice(0, 4000))
  } catch {
    /* logging must never throw */
  }
}

export const logger = {
  log(...args: unknown[]) {
    report('log', args[0], args.slice(1));
  },
  info(...args: unknown[]) {
    report('info', args[0], args.slice(1));
  },
  warn(...args: unknown[]) {
    report('warn', args[0], args.slice(1));
  },
  error(...args: unknown[]) {
    report('error', args[0], args.slice(1));
  },
};
