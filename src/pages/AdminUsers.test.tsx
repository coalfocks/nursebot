import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminUsers from './AdminUsers';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('../components/admin/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../stores/authStore', () => ({ useAuthStore: () => ({ profile: { id: 'super-1', role: 'super_admin' } }) }));
vi.mock('../lib/roles', () => ({ isSuperAdmin: (profile: { role?: string }) => profile?.role === 'super_admin' }));
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke } } }));

const initialList = {
  users: [],
  schools: [{ id: 'school-1', name: 'Existing School', slug: 'existing-school' }],
  audit: [],
};

describe('AdminUsers school creation', () => {
  beforeEach(() => {
    invoke.mockReset();
    let created = false;
    invoke.mockImplementation(async (_functionName: string, options: { body?: { action?: string } }) => {
      if (options.body?.action === 'create_school') {
        created = true;
        return { data: { school: { id: 'new-school', name: 'North Valley College', slug: 'north-valley-college' } }, error: null };
      }
      if (options.body?.action === 'invite') return { data: { message: 'Invitation sent' }, error: null };
      return {
        data: {
          ...initialList,
          schools: created
            ? [...initialList.schools, { id: 'new-school', name: 'North Valley College', slug: 'north-valley-college' }]
            : initialList.schools,
        },
        error: null,
      };
    });
  });

  it('creates a school, refreshes the list, and preselects it for the admin invitation', async () => {
    render(<AdminUsers />);

    fireEvent.click(await screen.findByRole('button', { name: /create school/i }));
    fireEvent.change(screen.getByLabelText('School name'), { target: { value: ' North   Valley College ' } });
    expect(screen.getByText('north-valley-college')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create and add admin/i }));

    expect(await screen.findByRole('dialog', { name: 'Invite educator/admin' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('North Valley College').length).toBeGreaterThan(0));
    expect(screen.getByRole('combobox', { name: 'Institution' })).toHaveValue('new-school');
    expect(invoke).toHaveBeenCalledWith('admin-user-management', {
      body: { action: 'create_school', name: ' North   Valley College ' },
    });

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.edu' } });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'School Admin' } });
    fireEvent.click(screen.getByRole('button', { name: /send one-time invite/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('admin-user-management', {
      body: {
        action: 'invite',
        email: 'admin@example.edu',
        full_name: 'School Admin',
        role: 'school_admin',
        school_id: 'new-school',
      },
    }));
  });

  it('shows a clear duplicate school error from the server', async () => {
    invoke.mockImplementation(async (_functionName: string, options: { body?: { action?: string } }) => {
      if (options.body?.action === 'create_school') {
        return {
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: new Response(JSON.stringify({ error: 'A school with this name or URL slug already exists', code: 'DUPLICATE_SCHOOL' }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            }),
          },
        };
      }
      return { data: initialList, error: null };
    });
    render(<AdminUsers />);

    fireEvent.click(await screen.findByRole('button', { name: /create school/i }));
    fireEvent.change(screen.getByLabelText('School name'), { target: { value: 'Existing School' } });
    fireEvent.click(screen.getByRole('button', { name: /create and add admin/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A school with this name or URL slug already exists');
    expect(screen.queryByRole('dialog', { name: 'Invite educator/admin' })).not.toBeInTheDocument();
  });
});
