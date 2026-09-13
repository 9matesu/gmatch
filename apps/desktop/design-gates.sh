#!/bin/bash
# DESIGN.md v1.1 acceptance gates — every count must be 0.
# Run from apps/desktop. Kept in-repo so the DESIGN.md grep block stays honest.
cd "$(dirname "$0")"
HEX_EXEMPT='e08a4c|cfd6e6|ffd75e|5ee0ff|b8b8c4|9fe3ff|0b0e14|0095f6|d6c6ff|ffd6f0|27272a|3f3f46|52525b|71717a|a1a1aa|d4d4d8|e4e4e7|18181b|67e8f9|34d399|a855f7|38bdf8|f59e0b|3fd68c'
chk() { printf "%-48s %s\n" "$1" "$(eval "$2" | wc -l | tr -d ' ')"; }
echo "== acceptance gates (expect 0) =="
chk "border-retro-border" 'grep -rn "border-retro-border" src --include=*.tsx | grep -v test'
chk "z-[3+digits]" 'grep -rhoE "z-\[[0-9]{3,}\]" src --include=*.tsx'
chk "text off-scale (6-9|11px)" 'grep -rhoE "text-\[(6|7|8|9|11)px\]" src --include=*.tsx'
chk "rounded-2xl/3xl" 'grep -rhoE "rounded-(2xl|3xl)" src --include=*.tsx'
chk "hex literals (exempt list)" "grep -rhoE '#[0-9a-fA-F]{6}' src --include=*.tsx | grep -viE '$HEX_EXEMPT'"
chk "white-alpha chrome (media exempt)" 'grep -rn "bg-white/\|border-white/" src --include=*.tsx | grep -v test | grep -v holo | grep -v "bg-black/" | grep -v BooruSlideshow'
chk "duration-75/100/200/1000" 'grep -rhoE "duration-(75|100|200|1000)\b" src --include=*.tsx'
chk "duration-[Nms]" 'grep -rhoE "duration-\[[0-9]+ms\]" src --include=*.tsx'
chk "scale-[1.0 hover bumps" 'grep -rhoE "scale-\[1\.0" src --include=*.tsx'
chk "tw-animate classes" 'grep -rn "animate-in \|animate-out \|slide-in-from" src --include=*.tsx | grep -v orbit'
chk "chrome glow shadow-[0_0]" 'grep -rn "shadow-\[0_0" src --include=*.tsx | grep -v test | grep -vE "CardBack|FlashOverlay|CardTile|Babecock|styles.ts|GoonPanel|BooruSlideshow"'
chk "hype/welcome copy" 'grep -rn "Welcome to\|successfully\|seamless\|effortless\|unleash\|cutting-edge\|Dive into" src --include=*.tsx | grep -v test | grep -vE ":[0-9]+: *(//|\*|/\*)"'
chk "metro-rule" 'grep -rn "metro-rule" src'
chk "em-dash in chrome" "grep -rn $'\u2014' src --include=*.tsx | grep -v test | grep -vE ':[0-9]+: *(//|/\*|\*|\{/\*)' | grep -v $'^[^:]*:[0-9]*: *\u2014 *$' | grep -vF $'\u2014\" :'"
chk "emoji glyph chrome" 'grep -rn "❤️\|⚡\|★\|✕" src --include=*.tsx | grep -v test | grep -v CommentsModal'
chk "bare animate-fade/slide" 'grep -rn "animate-fade-in\|animate-slide-up\|animate-slide-down" src --include=*.tsx | grep -v orbit'
echo "-- scrim uniformity (all must be /70) --"
grep -rn "fixed inset-0" src --include=*.tsx | grep -v test | grep -v ContextOverlay | grep -oE "bg-black/[0-9]+" | sort | uniq -c
