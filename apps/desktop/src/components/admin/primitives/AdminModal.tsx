"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { RowAction, BulkAction } from "../../../utils/adminTypes";

interface AdminActionMenuProps<T> {
  actions: RowAction<T>[];
  row: T;
  trigger?: React.ReactNode;
  className?: string;
}

export function AdminActionMenu<T>({
  actions,
  row,
  trigger,
  className,
}: AdminActionMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const visibleActions = actions.filter(a => !a.hidden?.(row));

  if (visibleActions.length === 0) return null;

  const defaultTrigger = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className="p-1.5 rounded hover:bg-glass-w10 text-retro-muted hover:text-retro-fg transition-colors"
      aria-label="Row actions"
      aria-expanded={open}
    >
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );

  return (
    <div className={cn("relative inline-block", className)} ref={ref}>
      {trigger || defaultTrigger}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-surface-elevated border border-border-glass rounded-lg shadow-lg overflow-hidden animate-orbit-pop">
          {visibleActions.map((action, _index) => {
              const actionIcon = action.icon;
              const isIconFunction = typeof actionIcon === 'function';
              const ActionIcon = isIconFunction ? (actionIcon as (row: T) => React.ComponentType<{ className?: string }>)(row) : actionIcon;
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    action.onClick(row);
                    setOpen(false);
                  }}
                  disabled={action.disabled?.(row)}
                  className={cn(
                    "w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors",
                    action.variant === "danger" && "text-red-300 hover:bg-red-500/10",
                    action.variant === "primary" && "text-cyan-300 hover:bg-cyan-500/10",
                    action.variant === "ghost" && "text-retro-muted hover:text-retro-fg hover:bg-glass-w5",
                    (!action.variant || action.variant === "default") && "text-retro-fg hover:bg-glass-w10",
                    "disabled:opacity-40 disabled:cursor-not-allowed"
                  )}
                >
                  {ActionIcon && <ActionIcon className="w-3.5 h-3.5" />}
                  {action.label}
            </button>
          )})}
        </div>
      )}
    </div>
  );
}

interface BulkActionBarProps<T> {
  actions: BulkAction<T>[];
  selectedRows: T[];
  selectedCount: number;
  onClose: () => void;
  className?: string;
}

export function BulkActionBar<T>({
  actions,
  selectedRows,
  selectedCount,
  onClose,
  className,
}: BulkActionBarProps<T>) {
  return (
    <div className={cn(
      "fixed bottom-0 left-0 right-0 z-50 bg-surface-elevated border-t border-border-glass p-3 shadow-xl animate-orbit-slide-up md:static md:shadow-none md:border-0 md:bg-transparent md:p-0",
      className
    )}>
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-retro-fg">
            {selectedCount} row{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-glass-w10 text-retro-muted hover:text-retro-fg transition-colors md:hidden"
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actions.map(action => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                action.onClick(selectedRows);
                onClose();
              }}
              disabled={action.disabled?.(selectedRows)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-colors flex items-center gap-1.5",
                action.variant === "danger" && "bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30",
                action.variant === "primary" && "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30",
                action.variant !== "danger" && action.variant !== "primary" && "bg-surface-interactive text-retro-fg border border-border-glass hover:bg-glass-w10",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {action.icon && <action.icon className="w-3.5 h-3.5" />}
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary" | "default";
  isLoading?: boolean;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  isLoading = false,
  children,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/70 animate-orbit-fade-in">
      <div className="w-full max-w-md bg-surface-elevated border border-border-glass rounded-xl shadow-2xl overflow-hidden animate-orbit-pop">
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-retro-fg">{title}</h3>
              {description && (
                <p className="text-xs text-retro-muted mt-1">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-glass-w10 text-retro-muted hover:text-retro-fg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {children}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5 border-t border-border-glass">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs font-bold rounded border border-border-glass text-retro-fg hover:bg-glass-w10 transition-colors disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={async () => {
              await onConfirm();
              onClose();
            }}
            disabled={isLoading}
            className={cn(
              "px-3 py-1.5 text-xs font-bold rounded flex items-center gap-1.5 transition-colors disabled:opacity-40",
              variant === "danger" && "bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30",
              variant === "primary" && "bg-cyan-500 text-black border border-cyan-500 hover:bg-cyan-400",
              variant === "default" && "bg-surface-interactive text-retro-fg border border-border-glass hover:bg-glass-w10"
            )}
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FormModalProps<T> {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: T) => void | Promise<void>;
  title: string;
  description?: string;
  submitLabel?: string;
  fields: FormField<T>[];
  initialData?: Partial<T>;
  isLoading?: boolean;
  className?: string;
}

export interface FormField<T> {
  key: keyof T | string;
  label: string;
  type: "text" | "textarea" | "select" | "number" | "checkbox" | "tags" | "password";
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  validation?: (value: unknown) => string | null;
  render?: (value: unknown, onChange: (value: unknown) => void) => React.ReactNode;
}

export function FormModal<T extends Record<string, unknown>>({
  isOpen,
  onClose,
  onSubmit,
  title,
  description,
  submitLabel = "Save",
  fields,
  initialData = {},
  isLoading = false,
  className,
}: FormModalProps<T>) {
  const [formData, setFormData] = useState<Partial<T>>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setFormData(initialData);
    setErrors({});
    setTouched({});
  }, [isOpen, initialData]);

  const handleChange = useCallback((key: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    if (touched[key]) {
      const field = fields.find(f => f.key === key);
      if (field?.validation) {
        const error = field.validation(value);
        setErrors(prev => ({ ...prev, [key]: error || "" }));
      }
    }
  }, [fields, touched]);

  const handleBlur = useCallback((key: string) => {
    setTouched(prev => ({ ...prev, [key]: true }));
    const field = fields.find(f => f.key === key);
    if (field?.validation) {
      const error = field.validation(formData[key]);
      setErrors(prev => ({ ...prev, [key]: error || "" }));
    }
  }, [fields, formData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    fields.forEach(field => {
      const key = field.key as keyof T;
      const error = field.validation?.(formData[key]);
      if (error) newErrors[String(field.key)] = error;
    });
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setTouched(Object.keys(formData).reduce((acc, k) => ({ ...acc, [k]: true }), {}));
      return;
    }
    await onSubmit(formData as T);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/70 animate-orbit-fade-in">
      <div className={cn(
        "w-full max-w-lg bg-surface-elevated border border-border-glass rounded-xl shadow-2xl overflow-hidden animate-orbit-pop max-h-[90vh] flex flex-col",
        className
      )}>
        <div className="p-5 border-b border-border-glass flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-retro-fg">{title}</h3>
            {description && <p className="text-xs text-retro-muted mt-1">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-glass-w10 text-retro-muted hover:text-retro-fg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {fields.map(field => (
            <div key={String(field.key)} className="space-y-1.5">
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-red-400">*</span>}
              </label>
              {field.render ? (
                field.render(formData[field.key], (v: unknown) => handleChange(String(field.key), v))
              ) : (
                <>
                  {field.type === "textarea" ? (
                    <textarea
                      value={(formData[field.key] as string) || ""}
                      onChange={e => handleChange(String(field.key), e.target.value)}
                      onBlur={() => handleBlur(String(field.key))}
                      placeholder={field.placeholder}
                      rows={3}
                      className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent resize-y"
                      required={field.required}
                    />
                  ) : field.type === "select" ? (
                    <select
                      value={(formData[field.key] as string) || ""}
                      onChange={e => handleChange(String(field.key), e.target.value || undefined)}
                      onBlur={() => handleBlur(String(field.key))}
                      className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
                      required={field.required}
                    >
                      <option value="">Select...</option>
                      {field.options?.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : field.type === "checkbox" ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData[field.key] === true}
                        onChange={e => handleChange(String(field.key), e.target.checked)}
                        className="w-4 h-4 accent-cyan-500 rounded border border-border-glass bg-surface-canvas cursor-pointer"
                      />
                      <span className="text-xs text-retro-fg">{field.placeholder || "Enable"}</span>
                    </label>
                  ) : field.type === "tags" ? (
                    <TagsInput
                      value={(formData[field.key] as string[]) || []}
                      onChange={v => handleChange(String(field.key), v)}
                      placeholder={field.placeholder}
                    />
                  ) : (
                    <input
                      type={field.type === "password" ? "password" : field.type}
                      value={(formData[field.key] as string) || ""}
                      onChange={e => handleChange(String(field.key), field.type === "number" ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value)}
                      onBlur={() => handleBlur(String(field.key))}
                      placeholder={field.placeholder}
                      className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
                      required={field.required}
                    />
                  )}
                  {errors[String(field.key)] && (
                    <p className="text-[10px] text-red-400">{errors[String(field.key)]}</p>
                  )}
                </>
              )}
            </div>
          ))}
        </form>
        <div className="flex items-center justify-end gap-2 px-5 pb-5 border-t border-border-glass">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs font-bold rounded border border-border-glass text-retro-fg hover:bg-glass-w10 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={undefined}
            onClick={handleSubmit}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs font-bold rounded bg-cyan-500 text-black border border-cyan-500 hover:bg-cyan-400 transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function TagsInput({ value, onChange, placeholder }: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const tags = input.split(/[\n,]+/).map(t => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean);
    if (tags.length > 0) {
      onChange(Array.from(new Set([...value, ...tags])));
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = (tagToRemove: string) => {
    onChange(value.filter(t => t !== tagToRemove));
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
        />
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(tag => (
            <span key={tag} className="px-2 py-1 bg-surface-interactive border border-border-glass rounded text-xs font-mono text-retro-fg flex items-center gap-1">
              #{tag}
              <button
                type="button"
                onClick={() => handleRemove(tag)}
                className="text-retro-muted hover:text-red-400 text-[10px] leading-none"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface DetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  data?: Record<string, unknown>;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

export function DetailModal({ isOpen, onClose, title, subtitle, children, data, size = "md" }: DetailModalProps) {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    full: "max-w-[90vw]",
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/70 animate-orbit-fade-in">
      <div className={cn(
        "w-full bg-surface-elevated border border-border-glass rounded-xl shadow-2xl overflow-hidden animate-orbit-pop max-h-[90vh] flex flex-col",
        sizeClasses[size]
      )}>
        <div className="p-5 border-b border-border-glass flex items-start justify-between">
          <div>
            <h3 className="text-sm font-bold text-retro-fg">{title}</h3>
            {subtitle && <p className="text-xs text-retro-muted mt-1">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-glass-w10 text-retro-muted hover:text-retro-fg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {children}
          {data && (
            <div className="divide-y divide-border-glass">
              {Object.entries(data).map(([key, val]) => (
                <div key={key} className="py-2 flex items-center justify-between text-xs gap-3">
                  <span className="text-retro-muted uppercase text-[10px] font-mono shrink-0">{key}</span>
                  <span className="font-mono text-retro-fg truncate text-right">
                    {val === null || val === undefined ? "—" : typeof val === "object" ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MoreHorizontal({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function Loader2({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}
