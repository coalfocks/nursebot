import { ReactNode, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import { useAuthStore } from '../../stores/authStore';

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const { profile, user, signOut } = useAuthStore();

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Failed to sign out', error);
    }
  }, [signOut, navigate]);

  if (!profile?.is_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  const roleLabel = profile?.role
    ? profile.role.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Administrator';

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar />
      <div className="flex flex-1 flex-col">
        <AdminHeader
          fullName={profile.full_name}
          email={user?.email}
          roleLabel={roleLabel}
          onSignOut={handleSignOut}
        />
        <main className="flex-1 overflow-y-auto bg-slate-50">{children}</main>
      </div>
    </div>
  );
}
