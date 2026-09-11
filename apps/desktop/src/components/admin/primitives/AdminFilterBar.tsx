"use client";

import { Fragment, useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, X, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { FilterConfig } from "../../../utils/adminTypes";

interface AdminFilterBarProps {
  filters: Record<string, unknown>;
  onFiltersChange: (filters: Record<string, unknown>) => void;
  configs: FilterConfig[];
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  showSearch?: boolean;
  className?: string;
}

export function AdminFilterBar({
  filters,
  onFiltersChange,
  configs,
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search...",
  showSearch = true,
  className,
}: AdminFilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const filterConfigs = useMemo(() => configs || [], [configs]);
  const [localFilters, setLocalFilters] = useState(filters || {});

  const activeFilterCount = useMemo(() => {
    return Object.entries(localFilters).filter(([key, value]) => {
      const config = filterConfigs.find(c => c.key === key);
      if (!config) return false;
      if (config.type === "boolean") return value === true;
      if (config.type === "date-range") return value && typeof value === "object" && (value as any).from;
      return value !== undefined && value !== null && value !== "";
    }).length;
  }, [localFilters, filterConfigs]);

  const handleFilterChange = useCallback((key: string, value: unknown) => {
    const newFilters = { ...localFilters };
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      delete newFilters[key];
    } else {
      newFilters[key] = value;
    }
    setLocalFilters(newFilters);
    onFiltersChange(newFilters);
  }, [localFilters, onFiltersChange]);

  const handleClearAll = useCallback(() => {
    setLocalFilters({});
    onFiltersChange({});
  }, [onFiltersChange]);

  const renderFilter = useCallback((config: FilterConfig) => {
    const value = localFilters[config.key];

    switch (config.type) {
      case "text":
        return (
          <div className="flex-1 min-w-[180px] max-w-[300px]">
            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider mb-1 block">{config.label}</label>
            <input
              type="text"
              value={(value as string) || ""}
              onChange={e => handleFilterChange(config.key, e.target.value)}
              placeholder={config.placeholder}
              className="w-full bg-surface-canvas border border-border-glass rounded px-2 py-1.5 text-xs outline-none focus:border-retro-accent"
            />
          </div>
        );

      case "select":
        return (
          <div className="flex-1 min-w-[160px] max-w-[240px]">
            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider mb-1 block">{config.label}</label>
            <select
              value={(value as string) || ""}
              onChange={e => handleFilterChange(config.key, e.target.value || undefined)}
              className="w-full bg-surface-canvas border border-border-glass rounded px-2 py-1.5 text-xs outline-none focus:border-retro-accent"
            >
              <option value="">All</option>
              {config.options?.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        );

      case "multi-select":
        return (
          <div className="flex-1 min-w-[200px] max-w-[300px] relative">
            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider mb-1 block">{config.label}</label>
            <MultiSelect
              value={(value as string[]) || []}
              options={config.options || []}
              onChange={vals => handleFilterChange(config.key, vals)}
              placeholder={config.placeholder || "Select..."}
            />
          </div>
        );

      case "date-range":
        return (
          <div className="flex-1 min-w-[280px] max-w-[400px]">
            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider mb-1 block">{config.label}</label>
            <DateRangePicker
              value={value as { from?: string; to?: string } || {}}
              onChange={val => handleFilterChange(config.key, val)}
            />
          </div>
        );

      case "number":
        return (
          <div className="flex-1 min-w-[140px] max-w-[200px]">
            <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider mb-1 block">{config.label}</label>
            <input
              type="number"
              value={(value as string) || ""}
              onChange={e => handleFilterChange(config.key, e.target.value ? Number(e.target.value) : undefined)}
              placeholder={config.placeholder}
              className="w-full bg-surface-canvas border border-border-glass rounded px-2 py-1.5 text-xs outline-none focus:border-retro-accent"
            />
          </div>
        );

      case "boolean":
        return (
          <div className="flex-1 min-w-[140px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={value === true}
                onChange={e => handleFilterChange(config.key, e.target.checked || undefined)}
                className="w-4 h-4 accent-cyan-500 rounded border border-border-glass bg-surface-canvas cursor-pointer"
              />
              <span className="text-[10px] font-bold text-retro-muted uppercase tracking-wider">{config.label}</span>
            </label>
          </div>
        );

      default:
        return null;
    }
  }, [localFilters, handleFilterChange]);

  return (
    <div className={cn("space-y-3 p-4 bg-surface-raised border border-border-glass rounded-xl", className)}>
      {showSearch && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-retro-muted" />
          <input
            type="text"
            value={searchValue}
            onChange={e => onSearchChange?.(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-surface-canvas border border-border-glass rounded-xl pl-10 pr-4 py-2 text-xs outline-none focus:border-retro-accent"
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-retro-muted" />
          <span className="text-xs font-bold uppercase tracking-wider text-retro-fg">Filters</span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 text-[10px] font-bold rounded-full">
              {activeFilterCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors"
            >
              <X className="w-3 h-3 mr-1" />
              Clear All
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={cn(
              "px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded border transition-colors flex items-center gap-1.5",
              expanded
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                : "bg-surface-interactive text-retro-fg border-border-glass hover:bg-glass-w10"
            )}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      <div className={cn("space-y-3 transition-all duration-150", expanded ? "opacity-100 max-h-96" : "opacity-0 max-h-0 overflow-hidden")}>
        <div className="flex flex-wrap gap-3">
          {filterConfigs.map(config => <Fragment key={config.key}>{renderFilter(config)}</Fragment>)}
        </div>
      </div>
    </div>
  );
}

function MultiSelect({ value, options, onChange, placeholder }: {
  value: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (value: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full bg-surface-canvas border border-border-glass rounded px-2 py-1.5 text-xs outline-none focus:border-retro-accent flex items-center justify-between",
          open && "border-retro-accent"
        )}
      >
        <span className="truncate flex-1">
          {value.length === 0 ? (
            <span className="text-retro-muted">{placeholder}</span>
          ) : value.length <= 2 ? (
            value.map(v => options.find(o => o.value === v)?.label || v).join(", ")
          ) : (
            `${value.length} selected`
          )}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-retro-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface-elevated border border-border-glass rounded-lg shadow-lg max-h-48 overflow-auto z-50 animate-orbit-pop">
          {options.map(opt => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-glass-w5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={e => {
                  const newValue = e.target.checked
                    ? [...value, opt.value]
                    : value.filter(v => v !== opt.value);
                  onChange(newValue);
                }}
                className="w-3.5 h-3.5 accent-cyan-500 rounded border border-border-glass bg-surface-canvas cursor-pointer"
              />
              <span className="text-retro-fg">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function DateRangePicker({ value, onChange }: {
  value: { from?: string; to?: string };
  onChange: (value: { from?: string; to?: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <label className="text-[10px] text-retro-faint uppercase tracking-wider mb-0.5 block">From</label>
        <input
          type="date"
          value={value.from || ""}
          onChange={e => onChange({ ...value, from: e.target.value || undefined })}
          className="w-full bg-surface-canvas border border-border-glass rounded px-2 py-1.5 text-xs outline-none focus:border-retro-accent"
        />
      </div>
      <div className="flex-1">
        <label className="text-[10px] text-retro-faint uppercase tracking-wider mb-0.5 block">To</label>
        <input
          type="date"
          value={value.to || ""}
          onChange={e => onChange({ ...value, to: e.target.value || undefined })}
          className="w-full bg-surface-canvas border border-border-glass rounded px-2 py-1.5 text-xs outline-none focus:border-retro-accent"
        />
      </div>
    </div>
  );
}

