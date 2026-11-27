"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * One context menu, every surface.
 *
 * A menu is DATA, not markup: `{ id, label, icon, params, run }`. Any action
 * that needs input (a file name, a target, a strength) declares `params` and
 * the menu grows the control itself — callers never hand-roll a dropdown.
 *
 * `run` receives the param values. Menus are dismissed after a run unless the
 * action says `keepOpen`.
 */

export type ContextParamValue = string | boolean;

export type ContextParam =
  | { id: string; label: string; type: 'text'; value?: string; placeholder?: string }
  | { id: string; label: string; type: 'select'; value: string; options: Array<{ value: string; label: string }> }
  | { id: string; label: string; type: 'toggle'; value: boolean };

export interface ContextAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Right-aligned hint (a key, a value). */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a separator above this row. */
  separatorBefore?: boolean;
  params?: ContextParam[];
  /** Keep the menu open after running (for toggles/tunables). */
  keepOpen?: boolean;
  run: (params: Record<string, ContextParamValue>) => void | Promise<void>;
}

function initialValues(actions: ContextAction[]): Record<string, Record<string, ContextParamValue>> {
  const out: Record<string, Record<string, ContextParamValue>> = {};
  for (const a of actions) {
    if (!a.params?.length) continue;
    const row: Record<string, ContextParamValue> = {};
    for (const p of a.params) row[p.id] = p.type === 'toggle' ? p.value : p.type === 'select' ? p.value : (p.value ?? '');
    out[a.id] = row;
  }
  return out;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions: ContextAction[];
  onDismiss: () => void;
  width?: number;
}

export function ContextMenu({ x, y, title, subtitle, actions, onDismiss, width = 236 }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [values, setValues] = useState(() => initialValues(actions));
  const [pos, setPos] = useState({ left: x, top: y });

  // Dismiss like a native menu: Esc, outside click, scroll, resize, blur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDismiss(); } };
    const onScroll = () => onDismiss();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('blur', onScroll);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('blur', onScroll);
    };
  }, [onDismiss]);

  // Clamp after layout: the panel can grow (expanded params) past the fold.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - w - 10)),
      top: Math.max(8, Math.min(y, window.innerHeight - h - 10)),
    });
  }, [x, y, openId, actions.length]);

  const setValue = (actionId: string, paramId: string, v: ContextParamValue) =>
    setValues((prev) => ({ ...prev, [actionId]: { ...prev[actionId], [paramId]: v } }));

  const run = async (a: ContextAction) => {
    try {
      await a.run(values[a.id] ?? {});
    } finally {
      if (!a.keepOpen) {
        setOpenId(null);
        onDismiss();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-lightbox)]"
      onClick={onDismiss}
      onContextMenu={(e) => { e.preventDefault(); onDismiss(); }}
    >
      <div
        ref={panelRef}
        role="menu"
        aria-label="Context menu"
        data-testid="context-menu"
        className="fixed bg-retro-panel/95 backdrop-blur-md border border-edge rounded-xl shadow-2xl p-1.5 text-xs animate-orbit-fade-in text-retro-fg max-h-[min(70vh,32rem)] overflow-y-auto styled-scrollbar"
        style={{ top: pos.top, left: pos.left, width }}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || subtitle) && (
          <div className="px-2.5 py-1 mb-1 border-b border-edge/40">
            {title && <div className="flex items-center gap-1.5 text-2xs font-semibold tracking-wider text-retro-muted uppercase">{title}</div>}
            {subtitle && <div className="text-2xs font-mono text-retro-faint truncate" title={String(subtitle)}>{subtitle}</div>}
          </div>
        )}

        {actions.map((a) => {
          const expanded = openId === a.id;
          return (
            <React.Fragment key={a.id}>
              {a.separatorBefore && <div className="my-1 border-t border-edge/50" />}
              <button
                type="button"
                role="menuitem"
                disabled={a.disabled}
                aria-expanded={a.params?.length ? expanded : undefined}
                onClick={() => {
                  if (a.disabled) return;
                  if (a.params?.length) { setOpenId(expanded ? null : a.id); return; }
                  void run(a);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 transition-colors font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default ${
                  a.danger ? 'text-danger-fg hover:bg-danger/15' : 'hover:bg-glass-w12'
                } ${expanded ? 'bg-glass-w10' : ''}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {a.icon}
                  <span className="truncate">{a.label}</span>
                </span>
                {a.hint && <span className="text-2xs text-retro-muted font-mono shrink-0">{a.hint}</span>}
              </button>

              {expanded && a.params && (
                <div className="mx-1 mb-1 mt-0.5 p-2 rounded-lg bg-surface-canvas/60 border border-edge/60 space-y-1.5">
                  {a.params.map((p) => {
                    const v = values[a.id]?.[p.id];
                    if (p.type === 'select') {
                      return (
                        <label key={p.id} className="block">
                          <span className="block text-2xs text-retro-muted mb-0.5">{p.label}</span>
                          <select
                            value={String(v ?? '')}
                            onChange={(e) => setValue(a.id, p.id, e.target.value)}
                            className="w-full bg-retro-panel border border-edge rounded-md px-2 py-1 text-xs text-retro-fg outline-none"
                          >
                            {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </label>
                      );
                    }
                    if (p.type === 'toggle') {
                      return (
                        <label key={p.id} className="flex items-center justify-between gap-2 cursor-pointer">
                          <span className="text-2xs text-retro-muted">{p.label}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(v)}
                            onChange={(e) => setValue(a.id, p.id, e.target.checked)}
                            className="accent-[var(--color-retro-accent)]"
                          />
                        </label>
                      );
                    }
                    return (
                      <label key={p.id} className="block">
                        <span className="block text-2xs text-retro-muted mb-0.5">{p.label}</span>
                        <input
                          type="text"
                          value={String(v ?? '')}
                          placeholder={p.placeholder}
                          onChange={(e) => setValue(a.id, p.id, e.target.value)}
                          className="w-full bg-retro-panel border border-edge rounded-md px-2 py-1 text-xs text-retro-fg outline-none"
                        />
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => void run(a)}
                    className="w-full mt-1 px-2 py-1 rounded-md bg-retro-accent text-retro-accent-text text-2xs font-semibold hover:bg-retro-fg transition-colors cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default ContextMenu;