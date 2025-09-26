import { Bell, LogOut } from 'lucide-react';

interface AdminHeaderProps {
  fullName: string;
  email?: string | null;
  roleLabel?: string;
  onSignOut?: () => void | Promise<void>;
}

const initialsFromName = (name: string) => {
  if (!name) return 'NC';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

export default function AdminHeader({ fullName, email, roleLabel = 'Administrator', onSignOut }: AdminHeaderProps) {
  const handleSignOutClick = () => {
    void onSignOut?.();
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Admin Dashboard</h1>
        <p className="hidden text-sm text-slate-500 sm:block">Monitor student progress, manage rooms, and oversee assignments.</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-slate-900"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 inline-flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
          </span>
        </button>
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-1.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
            {initialsFromName(fullName)}
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-sm font-semibold text-slate-900">{fullName}</p>
            <p className="text-xs text-slate-500">{roleLabel}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOutClick}
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <span className="sr-only">Logged in as {fullName}{email ? ` (${email})` : ''}</span>
      </div>
    </header>
  );
}
