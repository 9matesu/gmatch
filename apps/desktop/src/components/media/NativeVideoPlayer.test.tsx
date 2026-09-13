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
    expect(screen.getByText('HD Video')).toBeInTheDocument();
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
  });
});
