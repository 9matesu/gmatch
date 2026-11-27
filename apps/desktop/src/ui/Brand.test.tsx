// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Brand } from './Brand';
import { LOGO } from './tokens';

describe('Brand', () => {
  it('renders one mark + wordmark lockup from the token asset', () => {
    const { container } = render(<Brand />);
    const mark = container.querySelector('img');
    expect(mark, 'a mark must render').not.toBeNull();
    expect(mark?.getAttribute('src')).toBe(LOGO.markSrc);
    expect(mark?.className).toContain('w-(--logo-mark-size)');
    expect(screen.getByText('gMatch')).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('gap-(--logo-gap)');
  });

  it('keeps the compact and hero variants on the same lockup contract', () => {
    const { container: compact } = render(<Brand size="compact" />);
    expect(compact.querySelector('img')?.className).toContain('w-(--logo-mark-size-sm)');
    expect(screen.getByText('gMatch')).toBeInTheDocument();

    const { container: hero } = render(<Brand size="hero" />);
    expect(hero.querySelector('img')?.className).toContain('w-(--logo-mark-size-hero)');
  });

  it('announces the mark alone by the brand name, never a bare image', () => {
    render(<Brand markOnly />);
    expect(screen.getByRole('img', { name: 'gMatch' })).toBeInTheDocument();
    expect(screen.queryByText('gMatch')).toBeNull();
  });
});
