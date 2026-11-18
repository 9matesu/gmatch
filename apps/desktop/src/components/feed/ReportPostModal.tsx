"use client";

import { playPress } from '../../utils/sounds';
import { Modal } from '../../ui/kit';
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
    <Modal title="Report post" onClose={onClose}>
      <p className="text-xs text-retro-muted leading-relaxed">
        Why are you reporting this post by <strong>{post.author_name}</strong>?
      </p>

      <div className="space-y-2">
        {REPORT_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => handleReportSubmit(reason)}
            className="w-full p-2.5 text-left text-xs font-semibold text-retro-fg bg-glass-w5 hover:bg-glass-w12 rounded-lg border border-edge transition-colors cursor-pointer"
          >
            {reason}
          </button>
        ))}
      </div>
    </Modal>
  );
}
