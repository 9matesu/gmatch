"use client";

import { X, ShieldCheck, Lock, FileText, EyeOff, Scale } from 'lucide-react';
import { playPress } from '../utils/sounds';

export function TosModal({
  isOpen = true,
  onClose,
}: {
  isOpen?: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[99994] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-orbit-fade-in font-sans"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border-glass rounded-3xl max-w-lg w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-border-glass flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-black text-retro-fg">Terms of Service &amp; Privacy Policy</h2>
              <p className="text-[10px] text-retro-muted">goonMatch Community &amp; Legal Guidelines</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { playPress(700); onClose(); }}
            className="p-1 rounded-full text-retro-muted hover:text-retro-fg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs text-retro-body leading-relaxed divide-y divide-zinc-100">
          <div className="space-y-1.5">
            <h4 className="font-bold text-retro-fg flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-cyan-300" />
              <span>1. Eligibility &amp; Age Requirement</span>
            </h4>
            <p className="text-retro-muted">
              You must be at least <strong>18 years of age</strong> (or the age of majority in your jurisdiction) to access or use goonMatch. By accessing the platform you represent and warrant that you meet this requirement. If you are under 18, you may not create an account or use the service.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-bold text-retro-fg flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-cyan-300" />
              <span>2. Privacy &amp; Data Protection</span>
            </h4>
            <p className="text-retro-muted">
              goonMatch is privacy-preserving by default. We do not sell your personal data to third parties. Identities are pseudonymous and derived from keys held on your device. The server stores only the metadata required to operate the service — your public profile (name, tags, bio, avatar, posts) and activity counters — along with encrypted content. Your profile picture, name and tags are visible to other community members as you configure them.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-bold text-retro-fg flex items-center gap-1.5">
              <EyeOff className="w-4 h-4 text-cyan-300" />
              <span>3. Encryption &amp; Security</span>
            </h4>
            <p className="text-retro-muted">
              Private messages and protected content are encrypted end-to-end. Your private keys remain on your device and are never transmitted to the server. The operator cannot decrypt or read your private communications. Public posts and profile information are intentionally public.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-bold text-retro-fg">4. User Content &amp; Moderation</h4>
            <p className="text-retro-muted">
              You are solely responsible for content you publish. Strict zero tolerance applies to harassment, hate speech, illegal material, non-consensual intimate imagery, and unauthorized automated spam. Content that violates these guidelines may be removed without prior notice.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-bold text-retro-fg">5. Reporting &amp; Enforcement</h4>
            <p className="text-retro-muted">
              Users can report violating posts, messages and profiles. Reported content is hidden immediately while our team reviews it. Moderators are granted access only to the evidence needed to investigate a report — never unrestricted access to your private content. Every moderation decision is recorded with an actor, timestamp and reason.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-bold text-retro-fg flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-cyan-300" />
              <span>6. Audit &amp; Compliance</span>
            </h4>
            <p className="text-retro-muted">
              Administrative and moderation actions are auditable. Logs never contain private keys, plaintext protected content, or authentication secrets. Evidence and records are retained only as long as needed for moderation and legal compliance, and deleted otherwise.
            </p>
            <p className="text-retro-muted">
              If you delete your account, your identity, profile and uploaded content are permanently removed.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-bold text-retro-fg">7. Limitation of Liability</h4>
            <p className="text-retro-muted">
              goonMatch is provided on an &quot;as-is&quot; and &quot;as-available&quot; basis without warranties of any kind. The operator is not liable for content shared by users or for losses arising from use of the service, to the maximum extent permitted by law.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-border-glass bg-surface-interactive flex items-center justify-end">
          <button
            type="button"
            onClick={() => { playPress(750); onClose(); }}
            className="px-5 py-2 bg-black hover:bg-surface-elevated text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-xs"
          >
            I Understand &amp; Agree
          </button>
        </div>
      </div>
    </div>
  );
}