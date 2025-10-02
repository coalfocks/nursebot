import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { useSchools } from '../hooks/useSchools';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [studyYear, setStudyYear] = useState(1);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [schoolId, setSchoolId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signUp } = useAuthStore();
  const navigate = useNavigate();
  const { schools, loading: schoolsLoading, error: schoolsError } = useSchools();

  useEffect(() => {
    if (!schoolsLoading && schools.length > 0 && !schoolId) {
      setSchoolId(schools[0].id);
    }
  }, [schoolsLoading, schools, schoolId]);

  const validatePhoneNumber = (phone: string): boolean => {
    if (!phone) return true; // Phone is optional
    
    // Basic validation for US phone numbers (10 digits, optionally with country code)
    const phoneRegex = /^\+?1?\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})$/;
    return phoneRegex.test(phone);
  };

  const formatPhoneNumber = (phone: string): string => {
    if (!phone) return '';
    
    // Remove all non-digit characters
    const digitsOnly = phone.replace(/\D/g, '');
    
    // Format as +1XXXXXXXXXX if it's a 10-digit US number
    if (digitsOnly.length === 10) {
      return `+1${digitsOnly}`;
    }
    
    // If it already has a country code (11 digits starting with 1)
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      return `+${digitsOnly}`;
    }
    
    // Otherwise return as is
    return phone;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validate phone number if provided
    if (phoneNumber && !validatePhoneNumber(phoneNumber)) {
      setError('Please enter a valid phone number (e.g., +1 123-456-7890)');
      setLoading(false);
      return;
    }
    
    // Validate SMS consent - must have phone number if consent is true
    if (smsConsent && !phoneNumber) {
      setError('Phone number is required to receive SMS notifications');
      setLoading(false);
      return;
    }

    if (!schoolId) {
      setError('Please select a school to continue');
      setLoading(false);
      return;
    }

    try {
      // Format phone number for storage
      const formattedPhoneNumber = phoneNumber ? formatPhoneNumber(phoneNumber) : null;
      
      await signUp(email, password, fullName, studyYear, formattedPhoneNumber, smsConsent, schoolId);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
          Create your student account
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Join Nurse Althea
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {schoolsError && (
            <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-6">
              <div className="flex">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <div className="ml-3">
                  <p className="text-sm text-amber-700">{schoolsError}</p>
                </div>
              </div>
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
                Full Name
              </label>
              <div className="mt-1">
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-500" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400 hover:text-gray-500" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="studyYear" className="block text-sm font-medium text-gray-700">
                Education Year
              </label>
              <div className="mt-1">
                <select
                  id="studyYear"
                  name="studyYear"
                  required
                  value={studyYear}
                  onChange={(e) => setStudyYear(Number(e.target.value))}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                >
                  <option value={1}>MS-1</option>
                  <option value={2}>MS-2</option>
                  <option value={3}>MS-3</option>
                  <option value={4}>MS-4</option>
                  <option value={5}>PGY-1</option>
                  <option value={6}>PGY-2</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="school" className="block text-sm font-medium text-gray-700">
                School
              </label>
              <select
                id="school"
                name="school"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                disabled={schoolsLoading || schools.length === 0}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-50 disabled:text-gray-500"
              >
                {schoolsLoading && <option value="">Loading schools…</option>}
                {!schoolsLoading && schools.length === 0 && <option value="">No schools available</option>}
                {!schoolsLoading && schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700">
                Phone Number (for SMS notifications)
              </label>
              <div className="mt-1">
                <input
                  id="phoneNumber"
                  name="phoneNumber"
                  type="tel"
                  autoComplete="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 (123) 456-7890"
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Optional. Enter your phone number to receive SMS notifications.
              </p>
            </div>

            <div className="relative flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="smsConsent"
                  name="smsConsent"
                  type="checkbox"
                  checked={smsConsent}
                  onChange={(e) => setSmsConsent(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="smsConsent" className="font-medium text-gray-700">
                  SMS Notifications Consent
                </label>
                <p className="text-gray-500">
                  I consent to receive SMS notifications about my assignments. Message and data rates may apply.
                </p>
              </div>
            </div>

            {!phoneNumber && smsConsent && (
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <AlertTriangle className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-700">
                      You must provide a phone number to receive SMS notifications.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Creating account...' : 'Create account'}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-gray-500">Already have an account?</span>
              </div>
            </div>

            <div className="mt-6">
              <Link
                to="/login"
                className="flex w-full justify-center rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
