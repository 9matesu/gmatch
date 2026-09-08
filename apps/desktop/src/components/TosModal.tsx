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
      className="fixed inset-0 z-[99994] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-orbit-fade-in font-sans"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-lg w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col animate-orbit-slide-up text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Terms of Service &amp; Privacy Policy</h2>
              <p className="text-[11px] text-zinc-400">GoonGrid Community &amp; Legal Guidelines</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { playPress(700); onClose(); }}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs text-zinc-300 leading-relaxed divide-y divide-zinc-800/60">
          <div className="space-y-1.5">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-zinc-300" />
              <span>1. Eligibility &amp; Age Requirement</span>
            </h4>
            <p className="text-zinc-400">
              You must be at least <strong>18 years of age</strong> (or the age of majority in your jurisdiction) to access or use GoonGrid. By accessing the platform you represent and warrant that you meet this requirement. If you are under 18, you may not create an account or use the service.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-zinc-300" />
              <span>2. Privacy &amp; Data Protection</span>
            </h4>
            <p className="text-zinc-400">
              GoonGrid is privacy-preserving and local-first by default. We do not sell your personal data to third parties. Identities are pseudonymous and derived from cryptographic keys held on your device. The network stores only the metadata required to operate the service — your public profile, posts, and activity counters.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <EyeOff className="w-4 h-4 text-zinc-300" />
              <span>3. Encryption &amp; Security</span>
            </h4>
            <p className="text-zinc-400">
              Private messages and protected content are encrypted. Your private keys remain on your device and are never transmitted to any central authority or third-party servers.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-semibold text-white">4. User Content &amp; Moderation</h4>
            <p className="text-zinc-400">
              You are solely responsible for content you publish. Strict zero tolerance applies to illegal material, non-consensual intimate imagery, CSAM, harassment, and unauthorized automated spam. Content that violates these guidelines will be blocked.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-semibold text-white">5. Reporting &amp; Enforcement</h4>
            <p className="text-zinc-400">
              Users can report violating posts, messages, and profiles. Reported content is immediately filtered from view while community audit logs record the action.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-semibold text-white flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-zinc-300" />
              <span>6. Audit &amp; Compliance</span>
            </h4>
            <p className="text-zinc-400">
              Administrative and moderation actions are auditable. Logs never contain private keys, plaintext protected content, or authentication secrets.
            </p>
          </div>

          <div className="pt-3 space-y-1.5">
            <h4 className="font-semibold text-white">7. Limitation of Liability</h4>
            <p className="text-zinc-400">
              GoonGrid is provided on an &quot;as-is&quot; and &quot;as-available&quot; basis without warranties of any kind. The software developers and network peers are not liable for content shared by users, to the maximum extent permitted by law.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/30 flex items-center justify-end">
          <button
            type="button"
            onClick={() => { playPress(750); onClose(); }}
            className="px-4 py-2 bg-white hover:bg-zinc-200 text-black font-semibold text-xs rounded-lg transition-all cursor-pointer shadow-sm"
          >
            I Understand &amp; Agree
          </button>
        </div>
      </div>
    </div>
  );
}