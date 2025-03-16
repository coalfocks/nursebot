import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import Navbar from '../components/Navbar';
import { Loader2, Save, Clock, AlertTriangle } from 'lucide-react';

export default function ProfileSettings() {
  const { user, profile, loadUser } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({
    full_name: '',
    study_year: 1,
    specialization_interest: '',
    phone_number: '',
    sms_consent: false,
  });

  const [phoneError, setPhoneError] = useState('');
  
  // List of medical specializations
  const specializations = [
    'Anesthesiology',
    'Cardiology',
    'Dermatology',
    'Emergency Medicine',
    'Endocrinology',
    'Family Medicine',
    'Gastroenterology',
    'General Surgery',
    'Hematology',
    'Infectious Disease',
    'Internal Medicine',
    'Neurology',
    'Obstetrics and Gynecology',
    'Oncology',
    'Ophthalmology',
    'Orthopedic Surgery',
    'Otolaryngology',
    'Pediatrics',
    'Psychiatry',
    'Pulmonology',
    'Radiology',
    'Rheumatology',
    'Urology',
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
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : 
              name === 'study_year' ? parseInt(value) : value,
    });

    // Clear phone error when user types
    if (name === 'phone_number') {
      setPhoneError('');
    }
  };

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
    if (!user) return;
    
    // Validate phone number if provided
    if (formData.phone_number && !validatePhoneNumber(formData.phone_number)) {
      setPhoneError('Please enter a valid phone number (e.g., +1 123-456-7890)');
      return;
    }
    
    // Validate SMS consent - must have phone number if consent is true
    if (formData.sms_consent && !formData.phone_number) {
      setPhoneError('Phone number is required to receive SMS notifications');
      return;
    }
    
    setSaving(true);
    setMessage(null);
    
    try {
      // Format phone number for storage
      const formattedPhoneNumber = formData.phone_number ? formatPhoneNumber(formData.phone_number) : null;
      
      // Only allow updating own profile
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
        .eq('id', user.id); // Ensure we can only update our own profile
      
      if (error) throw error;
      
      await loadUser(); // Reload user data
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (error: any) {
      console.error('Error updating profile:', error);
      setMessage({ type: 'error', text: error.message || 'Failed to update profile' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  // Get the user's local timezone
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">Profile Settings</h1>
          
          {message && (
            <div className={`mb-6 p-4 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
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
                <option value={1}>Year 1</option>
                <option value={2}>Year 2</option>
                <option value={3}>Year 3</option>
                <option value={4}>Year 4</option>
                <option value={5}>Year 5</option>
                <option value={6}>Year 6</option>
              </select>
            </div>
            
            <div>
              <label htmlFor="specialization_interest" className="block text-sm font-medium text-gray-700">
                Specialization Interest
              </label>
              <select
                id="specialization_interest"
                name="specialization_interest"
                value={formData.specialization_interest}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">Select a specialization</option>
                {specializations.map((specialization) => (
                  <option key={specialization} value={specialization}>
                    {specialization}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label htmlFor="phone_number" className="block text-sm font-medium text-gray-700">
                Phone Number (for SMS notifications)
              </label>
              <input
                type="tel"
                id="phone_number"
                name="phone_number"
                value={formData.phone_number}
                onChange={handleChange}
                placeholder="+1 (123) 456-7890"
                className={`mt-1 block w-full rounded-md ${phoneError ? 'border-red-300' : 'border-gray-300'} shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm`}
              />
              {phoneError && (
                <p className="mt-1 text-sm text-red-600">{phoneError}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Enter your phone number to receive SMS notifications when assignments become effective.
              </p>
            </div>
            
            <div className="relative flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="sms_consent"
                  name="sms_consent"
                  type="checkbox"
                  checked={formData.sms_consent}
                  onChange={handleChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="sms_consent" className="font-medium text-gray-700">
                  SMS Notifications Consent
                </label>
                <p className="text-gray-500">
                  I consent to receive SMS notifications about my assignments. Message and data rates may apply.
                </p>
              </div>
            </div>
            
            {!formData.phone_number && formData.sms_consent && (
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
            
            <div className="flex items-center text-sm text-gray-500 mt-4">
              <Clock className="w-4 h-4 mr-1" />
              <span>Your timezone: {timezone}</span>
            </div>
            
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}