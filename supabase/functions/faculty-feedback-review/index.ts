import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';
import { corsHeaders } from '../_shared/cors.ts';

const missingArtifacts = () => ({
  available: false,
  reason: 'Saved evaluation artifacts are unavailable: public.faculty_evaluation_versions is missing. Apply migration 20261026215927_isolated_evaluation_versions.sql before enabling stored artifact review.',
});

const isMissingTable = (error: { code?: string; message?: string } | null) =>
  error?.code === '42P01' || error?.code === 'PGRST205' || error?.message?.toLowerCase().includes('faculty_evaluation_versions');

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Authentication is required');

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(url, serviceRoleKey);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) throw new Error('Authentication is required');

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !['school_admin', 'super_admin'].includes(profile.role)) throw new Error('Administrator access is required');

    const body = await request.json() as { action?: string; assignment_id?: string; evaluation_id?: string };
    if (body.action === 'evaluation_history') {
      const result = await admin
        .from('faculty_evaluation_versions')
        .select('id, assignment_id, version, status, prompt_version, model, generator_revision, evaluator_config_revision, created_at, completed_at, error')
        .eq('assignment_id', body.assignment_id ?? '')
        .order('version', { ascending: false });
      if (isMissingTable(result.error)) return json({ action: body.action, assignment_id: body.assignment_id, ...missingArtifacts() });
      if (result.error) throw result.error;
      return json({ action: body.action, available: true, evaluations: result.data ?? [] });
    }

    if (body.action === 'download_evaluation') {
      const result = await admin
        .from('faculty_evaluation_versions')
        .select('id, assignment_id, version, status, prompt_version, model, generator_revision, evaluator_config_revision, created_at, completed_at, artifacts')
        .eq('id', body.evaluation_id ?? '')
        .maybeSingle();
      if (isMissingTable(result.error)) return json({ action: body.action, evaluation_id: body.evaluation_id, ...missingArtifacts() });
      if (result.error) throw result.error;
      if (!result.data || result.data.status !== 'completed' || !result.data.artifacts) throw new Error('The selected saved evaluation has no completed artifacts.');
      return json({ action: body.action, available: true, evaluation: result.data });
    }

    return json({ error: 'Unsupported review action' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to read saved evaluation' }, 400);
  }
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
