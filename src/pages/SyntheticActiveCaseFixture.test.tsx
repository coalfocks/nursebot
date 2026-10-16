import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import SyntheticActiveCaseFixture, { STORAGE_KEY } from './SyntheticActiveCaseFixture';

describe('synthetic active case fixture', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps a single consultant request identity across submit and retry', () => {
    render(<SyntheticActiveCaseFixture />);
    expect(screen.getByText('No Supabase requests')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send consultant request/i }));
    fireEvent.click(screen.getByRole('button', { name: /retry same request id/i }));
    expect(screen.getByText(/Retry count:/).parentElement).toHaveTextContent('Retry count: 2');
    expect(screen.getAllByText('synthetic-consult-request-001')).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').consultant.requestId).toBe('synthetic-consult-request-001');
  });

  it('shows order, result, chat, and consultant evidence with stable IDs', () => {
    render(<SyntheticActiveCaseFixture />);
    expect(screen.getAllByText(/STAT\/Once CBC — completed/)).toHaveLength(2);
    expect(screen.getByText(/CBC result — linked to order/)).toBeInTheDocument();
    expect(screen.getByText('Student to patient')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send consultant request/i }));
    expect(screen.getByText('Student consultant request')).toBeInTheDocument();
    expect(screen.getByText('Consultant response — contextual')).toBeInTheDocument();
  });
});
