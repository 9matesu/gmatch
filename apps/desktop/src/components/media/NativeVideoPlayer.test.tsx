// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NativeVideoPlayer } from './NativeVideoPlayer';

describe('NativeVideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
  });

  it('renders video element with resolved src and controls', () => {
    const { container } = render(
      <NativeVideoPlayer src="https://example.com/test.mp4" />
    );

    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', 'https://example.com/test.mp4');
    expect(screen.getByLabelText(/play video/i)).toBeInTheDocument();
    // No quality badge: the timeline's author overlay owns the top strip.
    expect(screen.queryByText(/hd video/i)).toBeNull();
  });

  it('toggles play when play button is clicked', async () => {
    render(<NativeVideoPlayer src="https://example.com/test.mp4" />);

    const playBtn = screen.getByLabelText(/play video/i);
    await userEvent.click(playBtn);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('cycles playback speeds when speed button is clicked', async () => {
    render(<NativeVideoPlayer src="https://example.com/test.mp4" />);

    const speedBtn = screen.getByTitle('Playback Speed');
    expect(speedBtn).toHaveTextContent('1x');
    await userEvent.click(speedBtn);
    expect(speedBtn).toHaveTextContent('1.25x');
    await userEvent.click(speedBtn);
    expect(speedBtn).toHaveTextContent('1.5x');
  });

  it('toggles loop when loop button is clicked', async () => {
    render(<NativeVideoPlayer src="https://example.com/test.mp4" loop={false} />);

    const loopBtn = screen.getByTitle(/loop/i);
    await userEvent.click(loopBtn);
    expect(screen.getByTitle('Loop is On')).toBeInTheDocument();
  });

  it('handles video error and displays retry CTA', () => {
    const { container } = render(
      <NativeVideoPlayer src="https://example.com/invalid.mp4" />
    );

    const video = container.querySelector('video')!;
    fireEvent.error(video);

    expect(screen.getByText('Unable to load video source')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('fires onExpand when expand button is clicked', async () => {
    const onExpand = vi.fn();
    render(<NativeVideoPlayer src="https://example.com/test.mp4" onExpand={onExpand} />);

    const expandBtn = screen.getByTitle(/expand to fullscreen/i);
    await userEvent.click(expandBtn);
    expect(onExpand).toHaveBeenCalledTimes(1);

    const bottomExpandBtn = screen.getByTitle(/expand to lightbox/i);
    await userEvent.click(bottomExpandBtn);
    expect(onExpand).toHaveBeenCalledTimes(2);
  });

  it('keeps control bar visible when alwaysShowControls is true even on mouse leave', () => {
    const { container } = render(
      <NativeVideoPlayer src="https://example.com/test.mp4" alwaysShowControls={true} />
    );

    const playerRoot = container.firstChild as HTMLElement;
    fireEvent.mouseLeave(playerRoot);

    const bottomControls = container.querySelector('.bg-gradient-to-t');
    expect(bottomControls).toHaveClass('opacity-100');
  });

  it('toggles play when clicking video canvas directly', async () => {
    const { container } = render(<NativeVideoPlayer src="https://example.com/test.mp4" />);
    const video = container.querySelector('video')!;

    await userEvent.click(video);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('triggers onDoubleTapLike when double-clicking video canvas', async () => {
    const onDoubleTap = vi.fn();
    const { container } = render(
      <NativeVideoPlayer src="https://example.com/test.mp4" onDoubleTapLike={onDoubleTap} />
    );
    const video = container.querySelector('video')!;

    await userEvent.dblClick(video);
    expect(onDoubleTap).toHaveBeenCalled();
  });

  it('resolves a bare object id poster through resolveMediaUrl (not a raw uuid)', () => {
    const uuid = 'e66d0889-8c2a-4bd3-84d5-a7a29273db0f';
    const { container } = render(
      <NativeVideoPlayer src="https://example.com/test.mp4" poster={uuid} />
    );
    const video = container.querySelector('video')!;
    const poster = video.getAttribute('poster') || '';
    expect(poster).not.toBe(uuid);
    expect(poster).toContain(`/api/objects/${uuid}`);
  });

  it('omits the poster attribute when no poster is given', () => {
    const { container } = render(<NativeVideoPlayer src="https://example.com/test.mp4" />);
    const video = container.querySelector('video')!;
    expect(video.hasAttribute('poster')).toBe(false);
  });
});
