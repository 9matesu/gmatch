"use client";

import { useRef } from 'react';
import { playPress, playWin } from '../../utils/sounds';
import { PlusSquare, X, Upload, Camera } from 'lucide-react';

interface PostCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  media: string[];
  setMedia: (media: string[]) => void;
  caption: string;
  setCaption: (caption: string) => void;
  tags: string[];
  setTags: (tags: string[]) => void;
  onOpenCamera?: () => void;
  onPublish?: (mediaUrls: string[], caption: string, tags: string[]) => Promise<boolean>;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function PostCreatorModal({
  isOpen,
  onClose,
  media,
  setMedia,
  caption,
  setCaption,
  tags,
  setTags,
  onOpenCamera,
  onPublish,
  toast,
}: PostCreatorModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5 - media.length);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setMedia(media.length < 5 ? [...media, reader.result as string] : media);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAddTag = () => {
    const input = tagInputRef.current;
    if (!input) return;
    const clean = input.value.trim().toLowerCase().replace(/^#/, '');
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      input.value = '';
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handlePublish = async () => {
    if (tags.length === 0) {
      toast?.('Tags must be added before uploading post!', 'error');
      return;
    }
    if (media.length === 0) {
      toast?.('Please select at least 1 image or video to post!', 'error');
      return;
    }

    if (onPublish) {
      const ok = await onPublish(media, caption, tags);
      if (!ok) {
        toast?.('Failed to upload post — please try again.', 'error');
        return;
      }
    }

    playWin();
    toast?.('Post published successfully!', 'success');
    onClose();
    setMedia([]);
    setCaption('');
    setTags(['anime', 'art']);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-glass backdrop-blur-2xl text-retro-fg w-full max-w-lg rounded-2xl border border-border-glass shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border-glass flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlusSquare className="w-5 h-5 text-retro-fg" />
            <h3 className="text-sm font-extrabold text-retro-fg">Create New Post</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-retro-muted hover:text-retro-fg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Media preview list & add buttons */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-retro-fg block">
                Media Attachments ({media.length}/5)
              </label>
              <span className="text-[10px] text-retro-muted">Up to 5 images or videos</span>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {media.map((m, idx) => (
                <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-border-glass bg-surface-interactive group">
                  <img src={m} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setMedia(media.filter((_, i) => i !== idx))}
                    className="absolute top-1 right-1 p-0.5 bg-black/70 text-white rounded-full hover:bg-red-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {media.length < 5 && (
                <>
                  {/* Upload File */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-xl border-2 border-dashed border-border-glass hover:border-retro-accent text-retro-muted hover:text-retro-fg flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
                    title="Upload from device"
                  >
                    <Upload className="w-4 h-4" />
                    <span className="text-[9px] font-bold">Add</span>
                  </button>

                  {/* Snap with Camera */}
                  <button
                    type="button"
                    onClick={() => {
                      playPress(800);
                      onOpenCamera?.();
                    }}
                    className="aspect-square rounded-xl border border-border-glass hover:border-retro-accent bg-surface-interactive hover:bg-surface-elevated text-retro-muted hover:text-retro-fg flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
                    title="Take live photo"
                  >
                    <Camera className="w-4 h-4 text-retro-warning" />
                    <span className="text-[9px] font-bold">Snap</span>
                  </button>
                </>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleFilesSelected}
              className="hidden"
            />
          </div>

          {/* Mandatory Tags Section */}
          <div className="space-y-1.5 p-3.5 bg-retro-warning/10 border border-retro-warning/30 rounded-2xl">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-retro-warning flex items-center gap-1.5">
                <span>Required Tags *</span>
                <span className="text-[10px] font-medium text-retro-muted">(Must add at least 1 tag)</span>
              </label>
              <span className="text-[10px] font-black text-retro-warning">{tags.length} added</span>
            </div>

            {/* Tags Badges */}
            <div className="flex flex-wrap gap-1.5 min-h-[32px]">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-1 rounded-full bg-surface-interactive text-retro-fg text-xs font-bold flex items-center gap-1"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-400 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* Add Tag Input */}
            <div className="flex items-center gap-2 mt-1">
              <input
                ref={tagInputRef}
                type="text"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Type a tag (e.g. anime, cyberpunk) and press Enter"
                className="flex-1 bg-surface-raised border border-retro-warning/40 rounded-xl px-3 py-1.5 text-xs text-retro-fg outline-none focus:border-retro-accent"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 chrome-accent text-black rounded-xl text-xs font-bold cursor-pointer"
              >
                Add Tag
              </button>
            </div>
          </div>

          {/* Optional Caption */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-retro-fg block">
              Caption / Description <span className="text-retro-muted font-normal">(Optional)</span>
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write a caption for your post or art piece..."
              rows={3}
              className="w-full bg-surface-interactive border border-border-glass rounded-xl p-3 text-xs text-retro-fg outline-none focus:border-retro-accent transition-colors resize-none"
            />
          </div>
        </div>

        {/* Footer Action */}
        <div className="p-4 border-t border-border-glass bg-surface-interactive flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-4 bg-surface-raised hover:bg-surface-elevated text-retro-body border border-border-glass rounded-xl text-xs font-bold cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handlePublish}
            disabled={tags.length === 0 || media.length === 0}
            className="flex-1 py-2.5 chrome-accent disabled:opacity-40 text-black rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-md"
          >
            Share Post
          </button>
        </div>
      </div>
    </div>
  );
}
