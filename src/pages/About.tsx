import { Link } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import { buildInfo } from '../lib/buildInfo';
import { EMR_LABEL } from '../lib/terminology';

export default function About() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <section className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <Link
          to="/dashboard"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to dashboard
        </Link>
        <div className="flex items-start gap-3">
          <Info className="mt-1 h-6 w-6 text-blue-600" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">About NurseConnect</h1>
            <p className="mt-2 text-sm text-slate-600">
              Medical education simulation with an Electronic Medical Record ({EMR_LABEL}).
            </p>
          </div>
        </div>
        <dl className="mt-8 divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm">
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between">
            <dt className="font-medium text-slate-600">Build identifier</dt>
            <dd data-testid="build-identifier" className="font-mono text-slate-900">
              {buildInfo.identifier}
            </dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between">
            <dt className="font-medium text-slate-600">Deployment timestamp</dt>
            <dd data-testid="deployment-timestamp" className="font-mono text-slate-900">
              {buildInfo.deploymentTimestamp}
            </dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between">
            <dt className="font-medium text-slate-600">EMR route</dt>
            <dd className="font-mono text-slate-900">/ehr (legacy-compatible)</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

