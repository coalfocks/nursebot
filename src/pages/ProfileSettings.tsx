import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import Navbar from '../components/Navbar';
import AdminLayout from '../components/admin/AdminLayout';
import { Loader2, Save, Clock, AlertTriangle } from 'lucide-react';
import { hasAdminAccess } from '../lib/roles';

export default function ProfileSettings() {
  const { user, profile, loadUser } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    full_name: '',
    study_year: 1,
    specialization_interest: '',
    phone_number: '',
    sms_consent: false,
  });

  const [phoneError, setPhoneError] = useState('');

  const caseDesignations = [
    'Internal Medicine',
    'OB/GYN',
    'Surgery',
    'Psychiatry',
    'Pediatrics',
    'Emergency Medicine',
    'Family Medicine',
  ];

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        study_year: profile.study_year || 1,
        specialization_interest: profile.specialization_interest || '',
        phone_number: profile.phone_number || '',
        sms_consent: profile.sms_consent || false,
      });
      setLoading(false);
    }
  }, [user, profile, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : name === 'study_year'
          ? parseInt(value, 10)
          : value,
    }));

    if (name === 'phone_number') {
      setPhoneError('');
    }
  };

  const validatePhoneNumber = (phone: string): boolean => {
    if (!phone) return true;
    const phoneRegex = /^\+?1?\s*\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})$/;
    return phoneRegex.test(phone);
  };

  const formatPhoneNumber = (phone: string): string => {
    if (!phone) return '';
    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.length === 10) {
      return `+1${digitsOnly}`;
    }
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      return `+${digitsOnly}`;
    }
    return phone;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (formData.phone_number && !validatePhoneNumber(formData.phone_number)) {
      setPhoneError('Please enter a valid phone number (e.g., +1 123-456-7890)');
      return;
    }

    if (formData.sms_consent && !formData.phone_number) {
      setPhoneError('Phone number is required to receive SMS notifications');
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const formattedPhoneNumber = formData.phone_number ? formatPhoneNumber(formData.phone_number) : null;

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          study_year: formData.study_year,
          specialization_interest: formData.specialization_interest || null,
          phone_number: formattedPhoneNumber,
          sms_consent: formData.sms_consent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;

      await loadUser();
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (error: any) {
      console.error('Error updating profile:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    if (hasAdminAccess(profile)) {
      return (
        <AdminLayout>
          <div className="flex h-full items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        </AdminLayout>
      );
    }

    return (
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const pageContent = (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="bg-white shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Profile Settings</h1>

        {message && (
          <div
            className={`mb-6 p-4 rounded-md ${
              message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
              Full Name
            </label>
            <input
              type="text"
              id="full_name"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="study_year" className="block text-sm font-medium text-gray-700">
              Year of Study
            </label>
            <select
              id="study_year"
              name="study_year"
              value={formData.study_year}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              {[1, 2, 3, 4, 5, 6].map((year) => (
                <option key={year} value={year}>
                  Year {year}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="specialization_interest" className="block text-sm font-medium text-gray-700">
              Case Designation
            </label>
            <select
              id="specialization_interest"
              name="specialization_interest"
              value={formData.specialization_interest}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="">Select designation</option>
              {caseDesignations.map((designation) => (
                <option key={designation} value={designation}>
                  {designation}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="phone_number" className="block text-sm font-medium text-gray-700">
              Phone Number <span className="text-gray-500 text-xs">(optional)</span>
            </label>
            <input
              type="tel"
              id="phone_number"
              name="phone_number"
              value={formData.phone_number}
              onChange={handleChange}
              className={`mt-1 block w-full rounded-md border ${
                phoneError
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
              } shadow-sm sm:text-sm`}
              placeholder="e.g., +1 123-456-7890"
            />
            {phoneError && <p className="mt-1 text-sm text-red-600">{phoneError}</p>}
          </div>

          <div className="relative flex items-start">
            <div className="flex items-center h-5">
              <input
                id="sms_consent"
                name="sms_consent"
                type="checkbox"
                checked={formData.sms_consent}
                onChange={handleChange}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </div>
            <div className="ml-3 text-sm">
              <label htmlFor="sms_consent" className="font-medium text-gray-700">
                Receive SMS notifications
              </label>
              <p className="text-gray-500">
                We will send reminders when new room assignments are ready or when responses are due.
              </p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center">
              <Clock className="w-5 h-5 text-gray-400 mr-3" />
              <div>
                <p className="text-sm font-medium text-gray-900">Timezone</p>
                <p className="text-sm text-gray-500">
                  Notifications and due dates are shown in your local timezone: {timezone}
                </p>
              </div>
            </div>
          </div>

          {message?.type === 'error' && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="flex">
                <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden="true" />
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error updating profile</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{message.text}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (hasAdminAccess(profile)) {
    return <AdminLayout>{pageContent}</AdminLayout>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      {pageContent}
    </div>
  );
}
