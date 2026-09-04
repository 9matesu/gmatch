"use client";

import { useState, useMemo } from 'react';
import { X, Search } from 'lucide-react';

interface BooruQueryBoxProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  label?: string;
  showPreview?: boolean;
}

function parseQuery(query: string): string[] {
  return query
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
    .filter(Boolean);
}

function formatTag(tag: string): string {
  return tag.startsWith('-') ? tag : `#${tag}`;
}

export function BooruQueryBox({
  value,
  onChange,
  placeholder = 'Type booru query (e.g. 1girl solo -ai_generated -bikini)...',
  suggestions = [
    '1girl',
    'solo',
    'scenery',
    'highres',
    'wallpaper',
    'cyberpunk',
    'game_cg',
    'waifu',
    '-ai_generated',
    '-3d',
    '-bikini',
    '-lowres',
  ],
  label,
  showPreview = true,
}: BooruQueryBoxProps) {
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);

  const includeTags = useMemo(
    () => value.filter((t) => !t.startsWith('-')),
    [value]
  );
  const excludeTags = useMemo(
    () => value.filter((t) => t.startsWith('-')),
    [value]
  );

  const handleSubmit = () => {
    const tags = parseQuery(input);
    if (tags.length > 0) {
      const merged = Array.from(new Set([...value, ...tags]));
      onChange(merged);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRemove = (tagToRemove: string) => {
    onChange(value.filter((t) => t !== tagToRemove));
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (value.includes(suggestion)) return;
    onChange([...value, suggestion]);
  };

  const queryPreview = useMemo(() => {
    if (value.length === 0) return '';
    return `tags=${value.join(' ')}`;
  }, [value]);

  return (
    <div className="space-y-3">
      {label && (
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
          {label}
        </label>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="w-full bg-[#18181b] border border-[#27272a] rounded-xl pl-10 pr-4 py-2 text-xs text-zinc-100 outline-none focus:border-purple-500 transition-colors"
          aria-label="Booru query input"
        />
      </div>

      {(focused || input) && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleSuggestionClick(s)}
              disabled={value.includes(s)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded bg-[#27272a] border border-[#27272a] transition-colors cursor-pointer ${
                s.startsWith('-')
                  ? 'text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/50'
                  : 'text-cyan-300 hover:bg-cyan-500/10 hover:border-purple-300'
              } ${value.includes(s) ? 'opacity-30 cursor-not-allowed' : ''}`}
            >
              {formatTag(s)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 p-3 bg-[#27272a] border border-[#27272a] rounded-xl min-h-[44px]">
        {includeTags.map((t) => (
          <span
            key={t}
            className="px-2.5 py-1 bg-[#18181b] border border-purple-300 text-cyan-300 rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 shadow-xs"
          >
            <span>#{t}</span>
            <button
              type="button"
              onClick={() => handleRemove(t)}
              className="text-zinc-400 hover:text-red-500 font-bold ml-0.5 cursor-pointer"
              title="Remove tag"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {excludeTags.map((t) => (
          <span
            key={t}
            className="px-2.5 py-1 bg-[#18181b] border border-rose-500/50 text-rose-400 rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 shadow-xs"
          >
            <span>{t}</span>
            <button
              type="button"
              onClick={() => handleRemove(t)}
              className="text-zinc-400 hover:text-red-500 font-bold ml-0.5 cursor-pointer"
              title="Remove anti-tag"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {value.length === 0 && (
          <span className="text-xs text-zinc-400 italic py-0.5">No tags set. Type a query above or click suggestions.</span>
        )}
      </div>

      {showPreview && value.length > 0 && (
        <div className="p-2 bg-[#18181b] border border-[#27272a] rounded-lg">
          <code className="text-[10px] font-mono text-zinc-400">{queryPreview}</code>
        </div>
      )}
    </div>
  );
}