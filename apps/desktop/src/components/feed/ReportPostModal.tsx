"use client";

import { playPress } from '../../utils/sounds';
import { Flag, X } from 'lucide-react';
import type { FeedPost } from './GMatchFeed';

const REPORT_REASONS = [
  'Spam or Scam',
  'Inappropriate Content / NSFW',
  'Harassment or Hate Speech',
  'Copyright or Intellectual Property Violation',
  'Other Community Guidelines Violation',
];

interface ReportPostModalProps {
  post: FeedPost;
  onClose: () => void;
  onReport?: (postId: string, reason: string) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ReportPostModal({ post, onClose, onReport, toast }: ReportPostModalProps) {
  const handleReportSubmit = (reason: string) => {
    playPress(700);
    onReport?.(post.id, reason);
    toast?.(`Report submitted: ${reason}. Moderator team notified.`, 'info');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised w-full max-w-sm rounded-t-3xl sm:rounded-3xl border border-border-glass shadow-2xl overflow-hidden animate-orbit-slide-up p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
          <h3 className="text-sm font-extrabold text-retro-fg flex items-center gap-2">
            <Flag className="w-4 h-4 text-red-500" />
            <span>Report Inappropriate Post</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-retro-muted hover:text-retro-fg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-retro-muted leading-relaxed">
          Why are you reporting this post by <strong>{post.author_name}</strong>?
        </p>

        <div className="space-y-2">
          {REPORT_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => handleReportSubmit(reason)}
              className="w-full p-2.5 text-left text-xs font-semibold text-retro-body bg-surface-interactive hover:bg-red-50 hover:text-red-700 rounded-xl border border-border-glass transition-colors cursor-pointer"
            >
              {reason}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
