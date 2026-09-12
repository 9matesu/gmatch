import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  ShieldAlert,
  FileCode,
  List,
  Save,
  RotateCcw,
  Download,
  Upload,
  Plus,
  X,
  Search,
  Check,
  Copy,
  AlertCircle,
} from 'lucide-react'
import type { BlocklistData } from '../../types/gmatch-bridge'
import {
  getActiveBlocklistData,
  saveBlocklist,
  resetBlocklist,
  syncBlocklistFromBridge,
  DEFAULT_BLOCKLIST_DATA,
} from '../../game/tagFilter'
import { playPress } from '../../utils/sounds'

interface BlocklistSectionProps {
  toast?: (msg: string, type?: 'error' | 'success' | 'info' | 'warning' | any) => void
}

type EditorMode = 'visual' | 'json'
type ActiveCategory = 'blocklist' | 'suggested' | 'noise'

const CATEGORY_META: Record<
  ActiveCategory,
  { label: string; desc: string; color: string; badgeBg: string; commentKey: string }
> = {
  blocklist: {
    label: 'Hard Blocklist (blocklist)',
    desc: 'Tags dropped at query origin and rejected by clicker feed filters.',
    color: 'text-red-400',
    badgeBg: 'bg-red-500/10 text-red-300 border-red-500/30',
    commentKey: '_comment_hard',
  },
  suggested: {
    label: 'Suggested Excludes (suggested)',
    desc: 'Polarising tags offered as one-tap excludes on setup and in Feed options.',
    color: 'text-amber-400',
    badgeBg: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    commentKey: '_comment_suggested',
  },
  noise: {
    label: 'Noise Tags (noise)',
    desc: 'Quality, meta, and watermarking tags excluded from tag rankings and card stats.',
    color: 'text-blue-400',
    badgeBg: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    commentKey: '_comment_noise',
  },
}

export function BlocklistSection({ toast }: BlocklistSectionProps) {
  const [data, setData] = useState<BlocklistData>(() => getActiveBlocklistData())
  const [mode, setMode] = useState<EditorMode>('visual')
  const [activeCategory, setActiveCategory] = useState<ActiveCategory>('blocklist')
  const [jsonText, setJsonText] = useState(() => JSON.stringify(getActiveBlocklistData(), null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [newTagInput, setNewTagInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync with main process / bridge on mount
  useEffect(() => {
    let mounted = true
    syncBlocklistFromBridge()
      .then((current) => {
        if (mounted && current) {
          setData(current)
          setJsonText(JSON.stringify(current, null, 2))
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  // Check if current data differs from factory defaults
  const isModified = useMemo(() => {
    try {
      const def = JSON.stringify({
        blocklist: DEFAULT_BLOCKLIST_DATA.blocklist,
        suggested: DEFAULT_BLOCKLIST_DATA.suggested,
        noise: DEFAULT_BLOCKLIST_DATA.noise,
      })
      const cur = JSON.stringify({
        blocklist: data.blocklist,
        suggested: data.suggested,
        noise: data.noise,
      })
      return def !== cur
    } catch {
      return false
    }
  }, [data])

  // Validate JSON string
  const validateJson = (text: string): BlocklistData | null => {
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object') {
        setJsonError('JSON must be an object')
        return null
      }
      if (!Array.isArray(parsed.blocklist)) {
        setJsonError('Object must include a "blocklist" array')
        return null
      }
      if (!Array.isArray(parsed.suggested)) {
        setJsonError('Object must include a "suggested" array')
        return null
      }
      if (!Array.isArray(parsed.noise)) {
        setJsonError('Object must include a "noise" array')
        return null
      }
      setJsonError(null)
      return parsed as BlocklistData
    } catch (err: any) {
      setJsonError(err?.message || 'Invalid JSON syntax')
      return null
    }
  }

  // Mode switch handlers
  const switchToVisual = () => {
    const parsed = validateJson(jsonText)
    if (!parsed) {
      toast?.('Cannot switch to visual mode while JSON has syntax errors.', 'error')
      return
    }
    setData(parsed)
    setMode('visual')
    playPress(800)
  }

  const switchToJson = () => {
    setJsonText(JSON.stringify(data, null, 2))
    setJsonError(null)
    setMode('json')
    playPress(800)
  }

  // Tag mutation handlers for Visual Mode
  const addTag = () => {
    const raw = newTagInput.trim()
    if (!raw) return
    const parts = raw
      .split(/[\s,]+/)
      .map((t) => t.toLowerCase().trim())
      .filter(Boolean)
    if (parts.length === 0) return

    const currentList = Array.isArray(data[activeCategory]) ? [...data[activeCategory]] : []
    const existing = new Set(currentList.map((t) => t.toLowerCase()))
    let addedCount = 0

    for (const p of parts) {
      if (!existing.has(p)) {
        currentList.push(p)
        existing.add(p)
        addedCount++
      }
    }

    if (addedCount > 0) {
      const updated = { ...data, [activeCategory]: currentList }
      setData(updated)
      setJsonText(JSON.stringify(updated, null, 2))
      toast?.(`Added ${addedCount} tag${addedCount === 1 ? '' : 's'} to ${activeCategory}.`, 'success')
      setNewTagInput('')
    } else {
      toast?.('No new tags added (duplicates or empty).', 'info')
    }
  }

  const removeTag = (tagToRemove: string) => {
    const currentList = Array.isArray(data[activeCategory]) ? data[activeCategory] : []
    const updatedList = currentList.filter(
      (t) => t.toLowerCase() !== tagToRemove.toLowerCase(),
    )
    const updated = { ...data, [activeCategory]: updatedList }
    setData(updated)
    setJsonText(JSON.stringify(updated, null, 2))
  }

  const clearCategory = () => {
    if (!window.confirm(`Are you sure you want to clear all tags in "${activeCategory}"?`)) return
    const updated = { ...data, [activeCategory]: [] }
    setData(updated)
    setJsonText(JSON.stringify(updated, null, 2))
    toast?.(`Cleared all tags in ${activeCategory}.`, 'info')
  }

  // Raw JSON Text Area Handler
  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setJsonText(val)
    const parsed = validateJson(val)
    if (parsed) {
      setData(parsed)
    }
  }

  const formatJson = () => {
    const parsed = validateJson(jsonText)
    if (parsed) {
      const formatted = JSON.stringify(parsed, null, 2)
      setJsonText(formatted)
      setData(parsed)
      toast?.('JSON formatted cleanly.', 'info')
    } else {
      toast?.('Cannot format invalid JSON.', 'error')
    }
  }

  const copyJson = () => {
    navigator.clipboard.writeText(jsonText)
    setIsCopied(true)
    playPress(800)
    toast?.('blocklist.json copied to clipboard', 'info')
    setTimeout(() => setIsCopied(false), 2000)
  }

  // Save all changes
  const handleSave = async () => {
    setIsSaving(true)
    playPress(900)
    let payload = data
    if (mode === 'json') {
      const parsed = validateJson(jsonText)
      if (!parsed) {
        setIsSaving(false)
        toast?.('Cannot save: fix JSON syntax errors first.', 'error')
        return
      }
      payload = parsed
    }

    try {
      const ok = await saveBlocklist(payload)
      if (ok) {
        setData(payload)
        setJsonText(JSON.stringify(payload, null, 2))
        toast?.('blocklist.json saved and applied to active filters.', 'success')
      } else {
        toast?.('Failed to write blocklist.json.', 'error')
      }
    } catch (err: any) {
      toast?.(`Error saving blocklist: ${err?.message || err}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // Reset to factory defaults
  const handleReset = async () => {
    if (
      !window.confirm(
        'Reset blocklist.json to original factory defaults? All custom additions and exclusions will be reverted.',
      )
    ) {
      return
    }

    try {
      const def = await resetBlocklist()
      setData(def)
      setJsonText(JSON.stringify(def, null, 2))
      setJsonError(null)
      toast?.('blocklist.json restored to defaults.', 'success')
    } catch (err: any) {
      toast?.(`Error resetting blocklist: ${err?.message || err}`, 'error')
    }
  }

  // Export JSON file
  const handleExport = () => {
    try {
      const blob = new Blob([jsonText], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'blocklist.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast?.('blocklist.json downloaded.', 'success')
    } catch {
      toast?.('Failed to download blocklist.json.', 'error')
    }
  }

  // Import JSON file
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      const parsed = validateJson(content)
      if (parsed) {
        setData(parsed)
        setJsonText(JSON.stringify(parsed, null, 2))
        toast?.(`Loaded ${file.name} successfully. Click "Save Changes" to apply.`, 'success')
      } else {
        toast?.(`Invalid JSON format in ${file.name}.`, 'error')
      }
      e.target.value = ''
    }
    reader.onerror = () => toast?.('Could not read imported file.', 'error')
    reader.readAsText(file)
  }

  // Filtered tags in visual mode
  const currentCategoryTags = Array.isArray(data[activeCategory]) ? data[activeCategory] : []
  const filteredTags = useMemo(() => {
    if (!searchFilter.trim()) return currentCategoryTags
    const q = searchFilter.toLowerCase().trim()
    return currentCategoryTags.filter((t) => t.toLowerCase().includes(q))
  }, [currentCategoryTags, searchFilter])

  return (
    <div className="space-y-6 animate-orbit-fade-in">
      {/* Header card */}
      <div className="p-4 bg-surface-interactive border border-border-glass rounded-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-retro-fg">Content Blocklist (blocklist.json)</h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border ${
                    isModified
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  {isModified ? 'Customized' : 'Factory Default'}
                </span>
              </div>
              <p className="text-xs text-retro-muted">
                Full control over hard-blocked keywords, suggested exclude categories, and noise filter tags.
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex bg-surface-raised border border-border-glass rounded-xl p-1 text-xs font-bold shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={switchToVisual}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                mode === 'visual'
                  ? 'bg-black text-white shadow-xs'
                  : 'text-retro-muted hover:text-retro-fg'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Visual Lists</span>
            </button>
            <button
              type="button"
              onClick={switchToJson}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer ${
                mode === 'json'
                  ? 'bg-black text-white shadow-xs'
                  : 'text-retro-muted hover:text-retro-fg'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Raw JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {mode === 'visual' ? (
        <div className="space-y-4 animate-orbit-fade-in">
          {/* Category Tabs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(['blocklist', 'suggested', 'noise'] as const).map((cat) => {
              const meta = CATEGORY_META[cat]
              const count = Array.isArray(data[cat]) ? data[cat].length : 0
              const isSelected = activeCategory === cat
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    playPress(800)
                    setActiveCategory(cat)
                    setSearchFilter('')
                  }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer space-y-1 ${
                    isSelected
                      ? 'bg-surface-interactive border-retro-accent shadow-xs'
                      : 'bg-surface-raised border-border-glass hover:bg-surface-interactive'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-retro-fg capitalize">{cat}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${meta.badgeBg}`}>
                      {count}
                    </span>
                  </div>
                  <p className="text-[10px] text-retro-muted truncate">{meta.desc}</p>
                </button>
              )
            })}
          </div>

          {/* Active Category Editor */}
          <div className="p-4 bg-surface-raised border border-border-glass rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border-glass">
              <div>
                <h4 className="text-xs font-semibold text-retro-fg">{CATEGORY_META[activeCategory].label}</h4>
                <p className="text-[11px] text-retro-muted">{CATEGORY_META[activeCategory].desc}</p>
              </div>
              {currentCategoryTags.length > 0 && (
                <button
                  type="button"
                  onClick={clearCategory}
                  className="text-[11px] text-red-400 hover:text-red-300 font-medium cursor-pointer self-start sm:self-auto"
                >
                  Clear All ({currentCategoryTags.length})
                </button>
              )}
            </div>

            {/* Controls: Search and Add */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Add tag input */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                  placeholder={`Add tag(s) to ${activeCategory}...`}
                  className="flex-1 bg-surface-interactive border border-border-glass rounded-xl px-3 py-1.5 text-xs text-retro-fg outline-none focus:border-retro-accent placeholder:text-retro-muted/60"
                />
                <button
                  type="button"
                  onClick={addTag}
                  disabled={!newTagInput.trim()}
                  className="px-3 py-1.5 bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-40 text-black rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>

              {/* Search filter */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-retro-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder={`Search ${currentCategoryTags.length} tags...`}
                  className="w-full bg-surface-interactive border border-border-glass rounded-xl pl-8 pr-3 py-1.5 text-xs text-retro-fg outline-none focus:border-retro-accent placeholder:text-retro-muted/60"
                />
                {searchFilter && (
                  <button
                    type="button"
                    onClick={() => setSearchFilter('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-retro-muted hover:text-retro-fg text-xs"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Tag Pills Grid */}
            {filteredTags.length === 0 ? (
              <div className="py-8 text-center text-xs text-retro-muted">
                {searchFilter ? `No tags matching "${searchFilter}"` : `No tags in ${activeCategory}`}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto p-1 flex flex-wrap gap-1.5 styled-scrollbar">
                {filteredTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border-glass bg-glass-w5 px-2.5 py-1 text-xs font-mono text-retro-fg transition-colors hover:border-retro-accent/40"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      title={`Remove ${tag}`}
                      onClick={() => removeTag(tag)}
                      className="text-retro-muted hover:text-red-400 cursor-pointer text-xs"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Raw JSON Editor */
        <div className="space-y-3 animate-orbit-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-retro-muted">shared/blocklist.json</span>
              {jsonError ? (
                <span className="text-[10px] text-red-400 flex items-center gap-1 font-mono">
                  <AlertCircle className="w-3 h-3" />
                  {jsonError}
                </span>
              ) : (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                  <Check className="w-3 h-3" />
                  Valid JSON
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={formatJson}
                className="px-2.5 py-1 rounded-lg border border-border-glass text-xs font-bold text-retro-fg hover:bg-surface-interactive cursor-pointer"
              >
                Prettify
              </button>
              <button
                type="button"
                onClick={copyJson}
                className="px-2.5 py-1 rounded-lg border border-border-glass text-xs font-bold text-retro-fg hover:bg-surface-interactive flex items-center gap-1 cursor-pointer"
              >
                {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{isCopied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <textarea
            value={jsonText}
            onChange={handleJsonChange}
            rows={16}
            spellCheck={false}
            className={`w-full font-mono text-xs p-3 rounded-xl bg-surface-interactive border outline-none leading-relaxed resize-y styled-scrollbar ${
              jsonError
                ? 'border-red-500/60 focus:border-red-500 text-red-100'
                : 'border-border-glass focus:border-retro-accent text-retro-fg'
            }`}
          />
        </div>
      )}

      {/* Action Buttons Bar */}
      <div className="p-4 bg-surface-interactive border border-border-glass rounded-xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || Boolean(jsonError)}
            className="px-4 py-2 bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-40 text-black rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
          </button>

          {/* Reset Defaults Button */}
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-2 bg-surface-raised border border-border-glass hover:border-red-500/40 text-retro-muted hover:text-red-400 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Defaults</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Import File Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 bg-surface-raised border border-border-glass hover:bg-surface-elevated text-retro-fg rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-retro-muted" />
            <span>Import JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            className="hidden"
          />

          {/* Export File Button */}
          <button
            type="button"
            onClick={handleExport}
            className="px-3 py-2 bg-surface-raised border border-border-glass hover:bg-surface-elevated text-retro-fg rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-retro-muted" />
            <span>Export</span>
          </button>
        </div>
      </div>
    </div>
  )
}
