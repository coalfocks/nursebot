import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  GraduationCap,
  School,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
} from 'lucide-react';

interface AdminSidebarProps {
  collapsed?: boolean;
  onToggle?: (collapsed: boolean) => void;
}

const classNames = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export default function AdminSidebar({ collapsed: collapsedProp, onToggle }: AdminSidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = collapsedProp ?? internalCollapsed;

  const handleToggle = () => {
    const next = !collapsed;
    setInternalCollapsed(next);
    onToggle?.(next);
  };

  const navItems = [
    { label: 'Overview', to: '/dashboard', icon: LayoutDashboard },
    { label: 'EHR', to: '/ehr', icon: Activity },
    { label: 'Case Assignments', to: '/admin/assignments', icon: FileText },
    { label: 'Students', to: '/cases', icon: GraduationCap },
    { label: 'Rooms', to: '/admin/rooms', icon: School },
    { label: 'Profile Settings', to: '/profile', icon: Settings },
  ];

  return (
    <aside
      className={classNames(
        'flex flex-col h-screen border-r border-slate-200 bg-white transition-all duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white font-semibold">
              NC
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">NurseConnect</p>
              <p className="text-xs text-slate-500">Admin Workspace</p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={handleToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-100"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
      <nav className="flex-1 px-2 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  classNames(
                    'flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    collapsed && 'justify-center'
                  )
                }
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span className="ml-3">{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
