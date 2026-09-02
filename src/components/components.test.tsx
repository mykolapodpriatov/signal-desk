import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '../../test/a11y';
import { StreamStats } from '../core/streamStats';
import { PerformanceOverlay } from './PerformanceOverlay';

describe('<PerformanceOverlay />', () => {
  it('labels itself so it can be found and announced', () => {
    render(<PerformanceOverlay stats={new StreamStats()} />);

    expect(screen.getByLabelText('Stream performance')).toBeInTheDocument();
  });

  it('shows an em dash for a metric with no value yet', () => {
    // Worker latency before the first round trip is unknown, not zero — a
    // dashboard that shows 0.0ms is claiming a measurement it does not have.
    render(<PerformanceOverlay stats={new StreamStats()} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('reflects the stats it is given', () => {
    vi.useFakeTimers();
    const stats = new StreamStats();
    stats.setBufferSize(512);
    render(<PerformanceOverlay stats={stats} intervalMs={100} />);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByText('512')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('marks dropped ticks as a warning, because they should be zero', () => {
    vi.useFakeTimers();
    const stats = new StreamStats();
    stats.recordDropped(7);
    const { container } = render(
      <PerformanceOverlay stats={stats} intervalMs={100} />,
    );

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const dropped = container.querySelector('.overlay-metric[data-warn]');
    expect(dropped).toBeInTheDocument();
    expect(dropped).toHaveTextContent('7');
    vi.useRealTimers();
  });

  it('updates on a timer, not on every frame', () => {
    // A readout that changes sixty times a second is unreadable, and a
    // component re-rendering per frame to display the frame rate would be a
    // small joke at this project's expense.
    vi.useFakeTimers();
    const stats = new StreamStats();
    render(<PerformanceOverlay stats={stats} intervalMs={500} />);

    stats.setBufferSize(999);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByText('999')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText('999')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('stops its timer when unmounted', () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(
      <PerformanceOverlay stats={new StreamStats()} />,
    );

    unmount();

    expect(clear).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <PerformanceOverlay stats={new StreamStats()} />,
    );

    await expectNoA11yViolations(container);
  });
});
