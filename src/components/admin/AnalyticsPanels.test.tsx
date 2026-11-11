import '@testing-library/jest-dom/vitest';
import { it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DomainPerformance, SafetyReview, PagedRows, CaseTiming } from './AnalyticsPanels';
import { computeDashboardMetrics } from '../../lib/analyticsMetrics';
import { analyticsFixture } from '../../test/analyticsFixture';

it('shows all six component ranges, includes zero deductions, and labels case elapsed timing', () => {
 const metrics = computeDashboardMetrics([analyticsFixture()], 1);
 render(<><DomainPerformance metrics={metrics} /><CaseTiming metrics={metrics} /></>);
 expect(screen.getByText('Focused information gathering')).toBeInTheDocument();
 expect(screen.getByText('Safety deduction')).toBeInTheDocument();
 expect(screen.getByText('Efficiency deduction')).toBeInTheDocument();
 expect(screen.getByText('20 min')).toBeInTheDocument();
 expect(screen.getByText(/including pauses/)).toBeInTheDocument();
});
it('names the learner/case for critical safety review and opens the right assignment', () => {
 const onOpen = vi.fn();
 render(<SafetyReview rows={[analyticsFixture(0, { safetyResult: { level: 'critical', rationale: 'Synthetic harmful order flagged' } }), analyticsFixture(1)]} onOpen={onOpen} />);
 expect(screen.getByText(/Synthetic Learner 1 · Room 202/)).toBeInTheDocument();
 expect(screen.getByText('critical')).toBeInTheDocument();
 expect(screen.queryByText('Synthetic Learner 2')).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('Review attempt')); expect(onOpen).toHaveBeenCalledWith('synthetic-attempt-0');
});
it('keeps long lists bounded without dropping later rows', () => {
 render(<PagedRows rows={Array.from({ length: 26 }, (_, index) => index)} label="test rows" pageSize={25}>{(page) => <>{page.map((row) => <p key={row}>Row {row}</p>)}</>}</PagedRows>);
 expect(screen.queryByText('Row 25')).not.toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('Next test rows'));
 expect(screen.getByText('Row 25')).toBeInTheDocument();
 expect(screen.queryByText('Row 0')).not.toBeInTheDocument();
});
