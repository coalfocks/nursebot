import { useState, useRef } from 'react';
import { Upload, X, Check, AlertCircle, Loader2, Download, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSchools } from '../../hooks/useSchools';
import type { Database } from '../../lib/database.types';

interface BulkUserUploadProps {
  onSuccess?: (count: number) => void;
}

interface CsvRow {
  school?: string;
  name: string;
  email: string;
  password: string;
  specialty: string;
}

interface UploadResult {
  success: boolean;
  email: string;
  error?: string;
  userId?: string;
  skipped?: boolean;
}

interface BulkCreateResponse {
  message: string;
  results: UploadResult[];
  summary: {
    total: number;
    success: number;
    skipped: number;
    failed: number;
  };
}

export default function BulkUserUpload({ onSuccess }: BulkUserUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<BulkCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [schoolWarning, setSchoolWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // School selection state
  const [selectedSchool, setSelectedSchool] = useState<Database['public']['Tables']['schools']['Row'] | null>(null);
  const [schoolSearch, setSchoolSearch] = useState('');

  // Fetch available schools
  const { schools, loading: schoolsLoading } = useSchools();

  const SPECIALTIES = [
    'Internal Medicine',
    'OB/GYN',
    'Surgery',
    'Psychiatry',
    'Pediatrics',
    'Emergency Medicine',
    'Family Medicine',
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        setError('Please upload a CSV file');
        return;
      }
      setFile(selectedFile);
      setError(null);
      setResults(null);
    }
  };

  const parseCSV = (text: string, schoolName?: string): { users: CsvRow[]; warning?: string } => {
    const lines = text.split('\n').filter((line) => line.trim());
    if (lines.length < 2) {
      throw new Error('CSV must have at least a header row and one data row');
    }

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
    const requiredHeaders = ['name', 'email', 'password', 'specialty'];
    const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
    if (missingHeaders.length > 0) {
      throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
    }

    const rows = lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, '').trim());
      const row: Record<string, string> = {};
      values.forEach((value, index) => {
        row[headers[index]] = value;
      });
      return row;
    });

    const users: CsvRow[] = [];
    const mismatchedSchools = new Set<string>();

    for (const [index, row] of rows.entries()) {
      // Validate required fields
      if (!row.name || !row.email || !row.password || !row.specialty) {
        throw new Error(
          `Row ${index + 2}: Missing required fields (name, email, password, specialty)`,
        );
      }

      // Validate specialty
      if (!SPECIALTIES.includes(row.specialty)) {
        throw new Error(
          `Row ${index + 2}: Invalid specialty "${row.specialty}". Must be one of: ${SPECIALTIES.join(', ')}`,
        );
      }

      const resolvedSchool = row.school?.trim() || schoolName;
      if (row.school && schoolName && row.school.trim() !== schoolName.trim()) {
        mismatchedSchools.add(row.school.trim());
      }

      users.push({
        school: resolvedSchool,
        name: row.name,
        email: row.email,
        password: row.password,
        specialty: row.specialty,
      });
    }

    const warning =
      mismatchedSchools.size > 0
        ? `CSV includes school names that do not match the selected school: ${[...mismatchedSchools]
            .slice(0, 3)
            .join(', ')}${mismatchedSchools.size > 3 ? '…' : ''}`
        : null;

    return { users, warning };
  };

  const handleUpload = async () => {
    if (!file) return;
    if (!selectedSchool) {
      setError('Please select a school before uploading users');
      return;
    }

    setProcessing(true);
    setError(null);
    setResults(null);
    setSchoolWarning(null);

    try {
      const text = await file.text();
      const { users, warning } = parseCSV(text, selectedSchool.name);
      setSchoolWarning(warning);

      const { data, error } = await supabase.functions.invoke<BulkCreateResponse>('bulk-create-users', {
        body: {
          users,
        },
      });

      if (error) {
        throw new Error(error.message || 'Failed to create users');
      }

      if (!data) {
        throw new Error('No response from server');
      }

      setResults(data);
      if (data.summary.success > 0 && onSuccess) {
        onSuccess(data.summary.success);
      }

      // Reset file input
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to process CSV file');
    } finally {
      setProcessing(false);
    }
  };

  const downloadTemplate = () => {
    if (!selectedSchool) {
      setError('Please select a school before downloading the template');
      return;
    }

    const headers = ['school', 'name', 'email', 'password', 'specialty'];
    const sampleData = [
      `${selectedSchool.name},John Doe,john.doe@example.com,Password123,Internal Medicine`,
      `${selectedSchool.name},Jane Smith,jane.smith@example.com,Password123,Pediatrics`,
      `${selectedSchool.name},Bob Johnson,bob.johnson@example.com,Password123,Emergency Medicine`,
    ];
    const csvContent = [headers.join(','), ...sampleData].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter schools based on search
  const filteredSchools = schools.filter(school =>
    school.name.toLowerCase().includes(schoolSearch.toLowerCase())
  );

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
      >
        Bulk Upload Users
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="relative w-full max-w-2xl rounded-lg bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Bulk Upload Users</h2>
              <p className="text-sm text-gray-500">Upload a CSV file to create multiple users at once</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setFile(null);
                setResults(null);
                setError(null);
                setSchoolWarning(null);
              }}
              className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            {/* School Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700">School <span className="text-red-500">*</span></label>
              <div className="mt-1 relative">
                {schoolsLoading ? (
                  <Loader2 className="absolute left-3 top-1/2 h-4 w-4 text-gray-400 animate-spin" />
                ) : (
                  <Search className="absolute left-3 top-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                )}
                <input
                  type="text"
                  placeholder="Search schools..."
                  value={schoolSearch}
                  onChange={(e) => setSchoolSearch(e.target.value)}
                  disabled={schoolsLoading}
                  className="block w-full rounded-md border border-gray-300 pl-10 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>
              {filteredSchools.length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md">
                  {filteredSchools.map(school => (
                    <button
                      key={school.id}
                      type="button"
                      onClick={() => {
                        setSelectedSchool(school);
                        setSchoolSearch('');
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${
                        selectedSchool?.id === school.id ? 'bg-blue-50 text-blue-900' : 'text-gray-900'
                      }`}
                    >
                      <div className="font-medium">{school.name}</div>
                      {school.timezone && (
                        <div className="text-xs text-gray-500">{school.timezone}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {selectedSchool && (
                <div className="mt-2 flex items-center gap-2 text-sm text-green-700">
                  <Check className="h-4 w-4" />
                  <span>Selected: {selectedSchool.name}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedSchool(null)}
                    className="ml-2 text-red-600 hover:text-red-800 text-xs"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Template Download */}
            <div className="rounded-md bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <Download className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-blue-900">CSV Template</h3>
                  <p className="mt-1 text-xs text-blue-700">
                    Download a template file to see the required format. Required fields: name, email,
                    password, specialty. Users will be created under the selected school.
                  </p>
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Download Template
                  </button>
                </div>
              </div>
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Select CSV File</label>
              <div className="mt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              {file && (
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                  <Check className="h-4 w-4 text-green-500" />
                  <span>{file.name}</span>
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  <div className="text-sm text-red-700">{error}</div>
                </div>
              </div>
            )}

            {schoolWarning && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                  <div className="text-sm text-amber-800">{schoolWarning}</div>
                </div>
              </div>
            )}

            {/* Results */}
            {results && (
              <div
                className={`rounded-md border p-4 ${
                  results.summary.failed === 0
                    ? 'border-green-200 bg-green-50'
                    : 'border-amber-200 bg-amber-50'
                }`}
              >
                <div className="flex items-start gap-2">
                  {results.summary.failed === 0 ? (
                    <Check className="h-5 w-5 text-green-600 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <p
                      className={`text-sm font-medium ${
                        results.summary.failed === 0 ? 'text-green-900' : 'text-amber-900'
                      }`}
                    >
                      {results.message}
                    </p>

                    {/* Summary Report */}
                    <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
                      <p className="text-xs font-semibold text-gray-900 mb-2">Summary Report:</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-green-500" />
                          <span className="text-gray-700">Created: <strong>{results.summary.success}</strong></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-blue-500" />
                          <span className="text-gray-700">Skipped: <strong>{results.summary.skipped}</strong></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-red-500" />
                          <span className="text-gray-700">Failed: <strong>{results.summary.failed}</strong></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-gray-400" />
                          <span className="text-gray-700">Total: <strong>{results.summary.total}</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Skipped entries */}
                    {results.summary.skipped > 0 && (
                      <div className="mt-3 max-h-40 overflow-y-auto">
                        <p className="text-xs font-medium text-blue-900">Skipped (already exist):</p>
                        <ul className="mt-1 text-xs text-blue-700 space-y-1">
                          {results.results
                            .filter((r) => r.skipped)
                            .map((r, i) => (
                              <li key={i}>{r.email}</li>
                            ))}
                        </ul>
                      </div>
                    )}

                    {/* Failed entries */}
                    {results.summary.failed > 0 && (
                      <div className="mt-3 max-h-40 overflow-y-auto">
                        <p className="text-xs font-medium text-amber-900">Failed uploads:</p>
                        <ul className="mt-1 text-xs text-amber-700 space-y-1">
                          {results.results
                            .filter((r) => !r.success && !r.skipped)
                            .map((r, i) => (
                              <li key={i}>
                                {r.email}: {r.error}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setFile(null);
                setResults(null);
                setError(null);
              }}
              disabled={processing}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || processing}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Upload & Create Users
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
