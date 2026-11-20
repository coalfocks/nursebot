import '@testing-library/jest-dom/vitest';
import { it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DomainPerformance, SafetyReview, PagedRows, CaseTiming, LearnerSummary, RecurringBehaviorThemesPanel } from './AnalyticsPanels';
import { buildLearnerOverview, computeDashboardMetrics, extractRecurringBehaviorThemes } from '../../lib/analyticsMetrics';
import { analyticsFixture } from '../../test/analyticsFixture';

it('shows all six component ranges, includes zero deductions, and labels case elapsed timing', () => {
 const metrics = computeDashboardMetrics([analyticsFixture()], 1);
 render(<><DomainPerformance metrics={metrics} /><CaseTiming metrics={metrics} /></>);
 expect(screen.getByText('Focused information gathering')).toBeInTheDocument();
 expect(screen.getByText('Safety deduction')).toBeInTheDocument();
 expect(screen.getByText('Efficiency deduction')).toBeInTheDocument();
 expect(screen.getAllByText('20 min').length).toBeGreaterThan(0);
 expect(screen.getByText(/Average 20 min · median 20 min · valid n = 1 · completed n = 1/)).toBeInTheDocument();
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

it('shows Start, Complete, duration and exclusion reason in the timing drill-through', () => {
 const metrics = computeDashboardMetrics([analyticsFixture(0), analyticsFixture(1, { caseStartedAt: null })], 2);
 render(<CaseTiming metrics={metrics} />);
 const drill = screen.getByText('Timing by attempt (2)').closest('details')!;
 expect(drill).not.toHaveAttribute('open');
 expect(drill).toHaveTextContent('2026-10-03 10:00:00 UTC');
 expect(drill).toHaveTextContent('2026-10-03 10:20:00 UTC');
 expect(drill).toHaveTextContent(/Case Start was not recorded/);
});
it('renders the learner summary with the one-evaluation label, source links, and labeled untagged feedback', () => {
 const onOpen = vi.fn();
 const overview = buildLearnerOverview([analyticsFixture(0)]);
 render(<LearnerSummary overview={overview} learnerName="Synthetic Learner 1" onOpen={onOpen} />);
 expect(screen.getByText('Based on one evaluation')).toBeInTheDocument();
 expect(screen.getByText('Focused escalation to the senior clinician')).toBeInTheDocument();
 expect(screen.getAllByText('Evaluation feedback').length).toBeGreaterThan(0);
 fireEvent.click(screen.getAllByText('Open evaluation')[0]);
 expect(onOpen).toHaveBeenCalledWith('synthetic-attempt-0/feedback');
 fireEvent.click(screen.getAllByText('Open case')[0]);
 expect(onOpen).toHaveBeenCalledWith('synthetic-attempt-0');
});
it('shows an honest empty state for recurring themes when no behavior keys exist', () => {
 render(<RecurringBehaviorThemesPanel themes={extractRecurringBehaviorThemes([analyticsFixture(0), analyticsFixture(1), analyticsFixture(2)], 3)} />);
 expect(screen.getByText(/No stable behavior keys have been saved/)).toBeInTheDocument();
 expect(screen.getByText(/No behavior meets the 3-learner minimum as a strength/)).toBeInTheDocument();
});
