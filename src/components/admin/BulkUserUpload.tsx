import { useState, useRef } from 'react';
import { Upload, X, Check, AlertCircle, Loader2, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface BulkUserUploadProps {
  onSuccess?: (count: number) => void;
}

interface CsvRow {
  school: string;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const parseCSV = (text: string): CsvRow[] => {
    const lines = text.split('\n').filter((line) => line.trim());
    if (lines.length < 2) {
      throw new Error('CSV must have at least a header row and one data row');
    }

    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
    const data: CsvRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim().replace(/"/g, ''));
      const row: Record<string, string> = {};

      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });

      // Validate required fields
      if (!row.school || !row.name || !row.email || !row.password || !row.specialty) {
        throw new Error(
          `Row ${i + 1}: Missing required fields (school, name, email, password, specialty)`,
        );
      }

      // Validate specialty
      if (!SPECIALTIES.includes(row.specialty)) {
        throw new Error(
          `Row ${i + 1}: Invalid specialty "${row.specialty}". Must be one of: ${SPECIALTIES.join(', ')}`,
        );
      }

      data.push(row as CsvRow);
    }

    return data;
  };

  const handleUpload = async () => {
    if (!file) return;

    setProcessing(true);
    setError(null);
    setResults(null);

    try {
      const text = await file.text();
      const users = parseCSV(text);

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
    const headers = ['school', 'name', 'email', 'password', 'specialty'];
    const sampleData = [
      'Harvard Medical School,John Doe,john.doe@example.com,Password123,Internal Medicine',
      'Stanford Medicine,Jane Smith,jane.smith@example.com,Password123,Pediatrics',
      'Johns Hopkins,Bob Johnson,bob.johnson@example.com,Password123,Emergency Medicine',
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
              }}
              className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            {/* Template Download */}
            <div className="rounded-md bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <Download className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-blue-900">CSV Template</h3>
                  <p className="mt-1 text-xs text-blue-700">
                    Download a template file to see the required format. Required fields: school, name,
                    email, password, specialty
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
