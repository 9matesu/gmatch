"use client";

import { useEffect } from "react";
import { API_BASE } from "../utils/api";

const VISITOR_KEY_STORAGE = "goonmatch_visitor_key";
const REFERRER_SENT_KEY = "goonmatch_referrer_sent";

function makeId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function classifySource(host: string): string {
  if (!host) return "direct";
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h.includes("reddit")) return "reddit";
  if (h.includes("kosmi")) return "kosmi";
  if (h.includes("twitter") || h.includes("x.com") || h.includes("t.co")) return "twitter";
  if (h.includes("discord")) return "discord";
  if (h.includes("telegram")) return "telegram";
  if (h.includes("youtube") || h.includes("youtu.be")) return "youtube";
  if (h.includes("tiktok")) return "tiktok";
  if (h.includes("twitch")) return "twitch";
  if (h.includes("instagram")) return "instagram";
  if (h.includes("facebook") || h.includes("fb.")) return "facebook";
  if (h.includes("google") || h.includes("bing") || h.includes("duckduckgo")) return "search";
  return h.split(".").slice(-2).join(".") || "other";
}

function captureReferrer(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    if (localStorage.getItem(REFERRER_SENT_KEY)) return;

    let visitorKey = localStorage.getItem(VISITOR_KEY_STORAGE);
    if (!visitorKey) {
      visitorKey = makeId();
      localStorage.setItem(VISITOR_KEY_STORAGE, visitorKey);
    }

    const params = new URLSearchParams(window.location.search);
    const paramSource = params.get("ref") || params.get("source") || params.get("utm_source") || "";
    const referrer = document.referrer || "";
    const source = classifySource(paramSource || (referrer ? new URL(referrer).hostname : ""));

    // Persist the sent-marker regardless of network outcome so every browser
    // reports exactly once.
    localStorage.setItem(REFERRER_SENT_KEY, "1");
    if (source === "direct" && !paramSource && !referrer) return;

    const apiBase = API_BASE.replace(/\/+$/, "");

    void fetch(`${apiBase}/api/stats/referral`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        visitor_key: visitorKey,
        referrer_url: referrer.slice(0, 500),
        landing_path: window.location.pathname.slice(0, 200),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function ReferrerTracker() {
  useEffect(() => {
    captureReferrer();
  }, []);
  return null;
}