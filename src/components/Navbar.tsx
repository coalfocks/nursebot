import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Stethoscope, Menu, X, LogOut, User, Settings, Book, UserCog } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { hasAdminAccess } from '../lib/roles';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { profile, signOut } = useAuthStore();
  const showAdminLinks = hasAdminAccess(profile);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link to="/dashboard" className="flex items-center">
                <Stethoscope className="h-8 w-8 text-blue-600" />
                <span className="ml-2 text-lg font-semibold text-gray-900">NurseConnect</span>
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              <Link
                to="/dashboard"
                className={`${
                  location.pathname === '/dashboard' 
                    ? 'border-blue-500 text-gray-900' 
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
              >
                EMR
              </Link>
              <Link
                to="/cases"
                className={`${
                  location.pathname === '/cases' 
                    ? 'border-blue-500 text-gray-900' 
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
              >
                <Book className="h-4 w-4 mr-1" />
                Secure Chat
              </Link>
              {showAdminLinks && (
                <>
                  <Link
                    to="/admin"
                    className={`${
                      location.pathname === '/admin' 
                        ? 'border-blue-500 text-gray-900' 
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    Room Management
                  </Link>
                  <Link
                    to="/admin/assignments"
                    className={`${
                      location.pathname === '/assignment-manager' 
                        ? 'border-blue-500 text-gray-900' 
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                  >
                    <User className="h-4 w-4 mr-1" />
                    Case Assignments
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center">
            <div className="relative">
              <div className="flex items-center">
                <div className="flex items-center">
                  <Link
                    to="/profile"
                    className={`flex items-center max-w-xs text-sm bg-white focus:outline-none p-2 rounded-full hover:bg-gray-100 mr-2 ${location.pathname === '/profile' ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <UserCog className="h-5 w-5 text-gray-600" />
                    <span className="ml-2 text-gray-700">{profile?.full_name}</span>
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                    title="Sign out"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="-mr-2 flex items-center sm:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              <span className="sr-only">Open main menu</span>
              {mobileMenuOpen ? (
                <X className="block h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="block h-6 w-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="sm:hidden">
          <div className="pt-2 pb-3 space-y-1">
            <Link
              to="/dashboard"
              className={`${
                location.pathname === '/dashboard'
                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                  : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
              } block pl-3 pr-4 py-2 border-l-4 text-base font-medium`}
            >
              Dashboard
            </Link>
            <Link
              to="/cases"
              className={`${
                location.pathname === '/cases'
                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                  : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
              } block pl-3 pr-4 py-2 border-l-4 text-base font-medium flex items-center`}
            >
              <Book className="h-4 w-4 mr-2" />
              My Cases
            </Link>
            <Link
              to="/profile"
              className={`${
                location.pathname === '/profile'
                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                  : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
              } block pl-3 pr-4 py-2 border-l-4 text-base font-medium flex items-center`}
            >
              <UserCog className="h-4 w-4 mr-2" />
              Profile Settings
            </Link>
            {showAdminLinks && (
              <>
                <Link
                  to="/admin"
                  className={`${
                    location.pathname === '/admin'
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                  } block pl-3 pr-4 py-2 border-l-4 text-base font-medium flex items-center`}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Room Management
                </Link>
                <Link
                  to="/assignment-manager"
                  className={`${
                    location.pathname === '/assignment-manager'
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
                  } block pl-3 pr-4 py-2 border-l-4 text-base font-medium flex items-center`}
                >
                  <User className="h-4 w-4 mr-2" />
                  Case Assignments
                </Link>
              </>
            )}
          </div>
          <div className="pt-4 pb-3 border-t border-gray-200">
            <div className="flex items-center px-4">
              <div className="flex-shrink-0">
                <User className="h-10 w-10 text-gray-400 bg-gray-100 rounded-full p-2" />
              </div>
              <div className="ml-3">
                <div className="text-base font-medium text-gray-800">{profile?.full_name}</div>
                <div className="text-sm font-medium text-gray-500">Year {profile?.study_year}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <button
                onClick={handleSignOut}
                className="block px-4 py-2 text-base font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 w-full text-left"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
