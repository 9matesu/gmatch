"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Check, Minus, Search, Filter, X, MoreHorizontal } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { TableConfig, TableParams, TableResponse, RowAction, BulkAction } from "../../../utils/adminTypes";

interface AdminTableProps<T> {
  config: TableConfig<T>;
  data?: T[];
  total?: number;
  isLoading?: boolean;
  onParamsChange?: (params: TableParams) => void;
  className?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  getRowId?: (row: T) => string;
}

function normalizeTableRows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }
  return [];
}

function getTableParamsKey(params: TableParams): string {
  return JSON.stringify({
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort ?? null,
    filters: params.filters ?? {},
    search: params.search ?? "",
  });
}

function Checkbox({ checked, indeterminate, onChange, className, ...props }: {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate ?? false;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={e => onChange?.(e.target.checked)}
      className={cn("w-4 h-4 accent-cyan-500 rounded border border-border-glass bg-surface-canvas cursor-pointer", className)}
      {...props}
    />
  );
}

function AdminActionMenu<T>({ actions, row }: { actions: RowAction<T>[]; row: T }) {
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

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded hover:bg-white/10 text-retro-muted hover:text-retro-fg transition-colors"
        aria-label="Row actions"
        aria-expanded={open}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-surface-elevated border border-border-glass rounded-lg shadow-lg overflow-hidden animate-orbit-pop">
          {visibleActions.map((action, index) => {
              const actionIcon = action.icon;
              const isIconFunction = typeof actionIcon === 'function';
              const ActionIcon = isIconFunction ? (actionIcon as (row: T) => React.ComponentType<{ className?: string }>)(row) : actionIcon;
              const actionVariant = typeof action.variant === 'function' ? action.variant(row) : action.variant;
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
                    actionVariant === "danger" && "text-red-300 hover:bg-red-500/10",
                    actionVariant === "primary" && "text-cyan-300 hover:bg-cyan-500/10",
                    actionVariant === "ghost" && "text-retro-muted hover:text-retro-fg hover:bg-white/5",
                    (!actionVariant || actionVariant === "default") && "text-retro-fg hover:bg-white/10",
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

export function AdminTable<T extends Record<string, unknown>>({
  config,
  data: initialData = [],
  total: initialTotal = 0,
  isLoading = false,
  onParamsChange,
  className,
  emptyMessage = "No data found",
  emptyAction,
  getRowId = (row: T) => (row as Record<string, unknown>).id as string,
}: AdminTableProps<T>) {
  const [sorting, setSorting] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(
    config.defaultSort ? { column: config.defaultSort.column, direction: config.defaultSort.direction } : null
  );
  const [columnFilters, setColumnFilters] = useState<Record<string, unknown>>({});
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50 });
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [data, setData] = useState<T[]>(() => normalizeTableRows<T>(initialData));
  const [total, setTotal] = useState(initialTotal);
  const [isFetching, setIsFetching] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const lastNotifiedParamsRef = useRef<string>("");

  const fetchData = useCallback(async () => {
    if (!config.fetchFn) return;
    setIsFetching(true);
    try {
      const params: TableParams = {
        page: pagination.page,
        pageSize: pagination.pageSize,
        sort: sorting ? { column: sorting.column, direction: sorting.direction } : undefined,
        filters: columnFilters,
      };
      const response = await config.fetchFn(params);
      const rows = normalizeTableRows<T>(response.data);
      setData(rows);
      setTotal(Number.isFinite(response.total) ? response.total : rows.length);
      const paramsKey = getTableParamsKey(params);
      if (paramsKey !== lastNotifiedParamsRef.current) {
        lastNotifiedParamsRef.current = paramsKey;
        onParamsChange?.(params);
      }
    } catch (error) {
    } finally {
      setIsFetching(false);
    }
  }, [config.fetchFn, pagination, sorting, columnFilters, onParamsChange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const rows = normalizeTableRows<T>(initialData);
    if (rows.length > 0) {
      setData(rows);
    }
  }, [initialData]);

  useEffect(() => {
    if (initialTotal > 0) {
      setTotal(initialTotal);
    }
  }, [initialTotal]);

  const handleSort = useCallback((column: string) => {
    setSorting(prev => {
      if (prev && prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { column, direction: 'asc' };
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handleFilterChange = useCallback((key: string, value: unknown) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (value === undefined || value === null || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, page }));
  }, []);

  const handlePageSizeChange = useCallback((pageSize: number) => {
    setPagination(prev => ({ ...prev, pageSize, page: 1 }));
  }, []);

  const selectedCount = Object.keys(rowSelection).filter(k => rowSelection[k]).length;

  const hasFetchFn = typeof config.fetchFn === "function";

  // Apply client-side sorting and filtering only if not using server fetchFn
  const processedData = useMemo(() => {
    let result = normalizeTableRows<T>(data);
    if (hasFetchFn) {
      return result;
    }
    
    // Apply filters
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        result = result.filter(row => {
          const rowValue = (row as Record<string, unknown>)[key];
          if (rowValue === undefined || rowValue === null) return false;
          return String(rowValue).toLowerCase().includes(String(value).toLowerCase());
        });
      }
    });

    // Apply sorting
    if (sorting) {
      result.sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sorting.column];
        const bVal = (b as Record<string, unknown>)[sorting.column];
        if (aVal === undefined || aVal === null) return 1;
        if (bVal === undefined || bVal === null) return -1;
        const aStr = String(aVal);
        const bStr = String(bVal);
        const cmp = aStr.localeCompare(bStr);
        return sorting.direction === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [data, columnFilters, sorting, hasFetchFn]);

  // Apply pagination only if not using server fetchFn
  const paginatedData = useMemo(() => {
    if (hasFetchFn) {
      return processedData;
    }
    const start = (pagination.page - 1) * pagination.pageSize;
    return processedData.slice(start, start + pagination.pageSize);
  }, [processedData, pagination.page, pagination.pageSize, hasFetchFn]);

  const totalPages = Math.ceil(total / pagination.pageSize);

  if (isLoading && data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-center space-y-2">
          <div className="skeleton h-8 w-32 mx-auto" />
          <div className="skeleton h-4 w-48 mx-auto" />
          <div className="skeleton h-4 w-64 mx-auto" />
        </div>
      </div>
    );
  }

  if (data.length === 0 && !isLoading && !isFetching) {
    return (
      <div className="empty-state">
        <Filter className="w-12 h-12 text-retro-muted mb-3" />
        <p className="text-retro-muted">{emptyMessage}</p>
        {emptyAction && <div className="mt-4">{emptyAction}</div>}
      </div>
    );
  }

  return (
    <div className={cn("overflow-auto", className)}>
      <div className="relative">
        <table className="w-full border-collapse text-xs" role="grid">
          <thead className="sticky top-0 bg-surface-raised border-b border-border-glass">
            <tr>
              {config.columns.map(col => (
                <th
                  key={col.accessorKey}
                  className={cn(
                    "px-3 py-2 text-left font-bold uppercase tracking-wider text-retro-muted bg-surface-raised border-b border-border-glass",
                    col.enableSorting !== false && "cursor-pointer hover:text-retro-fg select-none"
                  )}
                  onClick={col.enableSorting !== false ? () => handleSort(col.accessorKey as string) : undefined}
                  style={{ width: col.size, minWidth: col.minSize, maxWidth: col.maxSize }}
                >
                  <div className="flex items-center gap-1.5">
                    {col.header}
                    {sorting?.column === col.accessorKey && (
                      sorting.direction === 'asc' ? (
                        <ChevronUp className="w-3.5 h-3.5 text-retro-accent" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-retro-accent" />
                      )
                    )}
                  </div>
                </th>
              ))}
              {config.enableRowSelection && (
                <th className="px-3 py-2 w-40">
                  <Checkbox
                    checked={selectedCount === paginatedData.length && paginatedData.length > 0}
                    indeterminate={selectedCount > 0 && selectedCount < paginatedData.length}
                    onChange={value => {
                      paginatedData.forEach(row => setRowSelection(prev => ({ ...prev, [getRowId(row)]: value ?? false })));
                    }}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {config.rowActions && config.rowActions.length > 0 && (
                <th className="px-3 py-2 w-120">Actions</th>
              )}
            </tr>
            {config.columns.some(c => c.enableFiltering) && (
              <tr>
                {config.columns.map(col => (
                  <th key={col.accessorKey} className="px-3 py-1.5">
                    {col.enableFiltering && (
                      <input
                        type="text"
                        placeholder={`Filter ${col.header}...`}
                        value={(columnFilters[col.accessorKey] as string) || ""}
                        onChange={e => handleFilterChange(col.accessorKey as string, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full bg-surface-canvas border border-border-glass rounded px-2 py-1 text-[10px] outline-none focus:border-retro-accent"
                      />
                    )}
                  </th>
                ))}
                {config.enableRowSelection && <th className="px-3 py-1.5 w-40" />}
                {config.rowActions && config.rowActions.length > 0 && <th className="px-3 py-1.5 w-120" />}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {paginatedData.map(row => {
              const rowId = getRowId(row);
              return (
                <tr
                  key={rowId}
                  className={cn(
                    "transition-colors hover:bg-white/5",
                    rowSelection[rowId] && "bg-retro-accent/10"
                  )}
                >
                  {config.columns.map(col => (
                    <td key={col.accessorKey} className="px-3 py-2 border-r border-border-subtle/50 last:border-0">
                      {col.cell ? col.cell((row as Record<string, unknown>)[col.accessorKey as string], row) : String((row as Record<string, unknown>)[col.accessorKey as string] ?? "")}
                    </td>
                  ))}
                  {config.enableRowSelection && (
                    <td className="px-3 py-2 w-40">
                      <Checkbox
                        checked={rowSelection[rowId]}
                        onChange={value => setRowSelection(prev => ({ ...prev, [rowId]: value ?? false }))}
                        aria-label="Select row"
                      />
                    </td>
                  )}
                  {config.rowActions && config.rowActions.length > 0 && (
                    <td className="px-3 py-2 w-120">
                      <AdminActionMenu
                        actions={config.rowActions.filter(a => !a.hidden?.(row))}
                        row={row}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
            {paginatedData.length === 0 && !isLoading && !isFetching && (
              <tr>
                <td colSpan={config.columns.length + (config.enableRowSelection ? 1 : 0) + (config.rowActions && config.rowActions.length > 0 ? 1 : 0)} className="px-3 py-8 text-center text-retro-muted">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-3 py-3 border-t border-border-glass bg-surface-raised mt-2">
        <div className="flex items-center gap-3 text-xs text-retro-muted">
          {config.enableRowSelection && selectedCount > 0 && (
            <span className="font-mono">{selectedCount} selected</span>
          )}
          {config.bulkActions && config.bulkActions.length > 0 && selectedCount > 0 && (
            <div className="flex items-center gap-1.5">
              {config.bulkActions.map(action => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => action.onClick(
                    data.filter(row => rowSelection[getRowId(row)])
                  )}
                  disabled={action.disabled?.(data.filter(row => rowSelection[getRowId(row)]))}
                  className={cn(
                    "px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors",
                    action.variant === "danger" && "bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30",
                    action.variant === "primary" && "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30",
                    action.variant !== "danger" && action.variant !== "primary" && "bg-surface-interactive text-retro-fg border border-border-glass hover:bg-white/10"
                  )}
                >
                  {action.icon && <action.icon className="w-3.5 h-3.5 mr-1" />}
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={pagination.pageSize}
            onChange={e => handlePageSizeChange(Number(e.target.value))}
            className="bg-surface-canvas border border-border-glass rounded px-2 py-1 text-xs outline-none focus:border-retro-accent"
          >
            {[25, 50, 100, 200].map(size => (
              <option key={size} value={size}>{size} per page</option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-1.5 rounded border border-border-glass text-retro-muted hover:text-retro-fg disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-retro-muted font-mono">
              Page {pagination.page} of {Math.max(1, totalPages)}
            </span>
            <button
              type="button"
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= totalPages}
              className="p-1.5 rounded border border-border-glass text-retro-muted hover:text-retro-fg disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useAdminTable<T extends Record<string, unknown>>(config: TableConfig<T>) {
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [params, setParams] = useState<TableParams>({
    page: 1,
    pageSize: 50,
    sort: config.defaultSort,
    filters: config.defaultFilters,
  });

  const fetchData = useCallback(async () => {
    if (!config.fetchFn) return;
    setIsLoading(true);
    try {
      const response = await config.fetchFn(params);
      setData(response.data);
      setTotal(response.total);
    } catch (error) {
    } finally {
      setIsLoading(false);
    }
  }, [config.fetchFn, params]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setPage = useCallback((page: number) => {
    setParams(prev => ({ ...prev, page }));
  }, []);

  const setPageSize = useCallback((pageSize: number) => {
    setParams(prev => ({ ...prev, pageSize, page: 1 }));
  }, []);

  const setSort = useCallback((sort: TableParams["sort"]) => {
    setParams(prev => ({ ...prev, sort, page: 1 }));
  }, []);

  const setFilters = useCallback((filters: TableParams["filters"]) => {
    setParams(prev => ({ ...prev, filters, page: 1 }));
  }, []);

  const refresh = useCallback(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    total,
    isLoading,
    params,
    setPage,
    setPageSize,
    setSort,
    setFilters,
    refresh,
  };
}
