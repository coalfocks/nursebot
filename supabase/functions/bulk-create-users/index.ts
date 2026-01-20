import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

interface CsvUser {
  email: string;
  password: string;
  full_name: string;
  study_year: string;
  specialization_interest: string;
  phone_number?: string;
  sms_consent?: string;
}

interface BulkCreateRequest {
  users: CsvUser[];
  schoolId: string;
}

interface CreateResult {
  success: boolean;
  email: string;
  error?: string;
  userId?: string;
}

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

function parseStudyYear(year: string): number {
  const yearMap: Record<string, number> = {
    'MS-1': 1,
    'MS-2': 2,
    'MS-3': 3,
    'MS-4': 4,
    'PGY-1': 5,
    'PGY-2': 6,
  };
  return yearMap[year] || parseInt(year, 10) || 1;
}

function parseSmsConsent(consent: string = ''): boolean {
  return consent.toLowerCase() === 'true' || consent.toLowerCase() === 'yes' || consent === '1';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }

  try {
    const { users, schoolId }: BulkCreateRequest = await req.json();

    if (!users || !Array.isArray(users) || users.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Users array is required and must not be empty' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (!schoolId) {
      return new Response(
        JSON.stringify({ error: 'schoolId is required' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    // Verify school exists
    const { data: school, error: schoolError } = await supabaseAdmin
      .from('schools')
      .select('id')
      .eq('id', schoolId)
      .single();

    if (schoolError || !school) {
      return new Response(
        JSON.stringify({ error: 'Invalid school ID' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    const results: CreateResult[] = [];

    for (const user of users) {
      const { email, password, full_name, study_year, specialization_interest, phone_number, sms_consent } =
        user;

      // Validate required fields
      if (!email || !password || !full_name) {
        results.push({
          success: false,
          email: email || 'unknown',
          error: 'Missing required fields: email, password, and full_name are required',
        });
        continue;
      }

      try {
        // Create auth user
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

        if (authError) {
          results.push({
            success: false,
            email,
            error: authError.message,
          });
          continue;
        }

        if (!authData.user) {
          results.push({
            success: false,
            email,
            error: 'Failed to create user',
          });
          continue;
        }

        // Create profile
        const parsedStudyYear = parseStudyYear(study_year);
        const parsedSmsConsent = parseSmsConsent(sms_consent);
        const formattedPhoneNumber = phone_number?.trim() || null;

        const { error: profileError } = await supabaseAdmin.from('profiles').insert([
          {
            id: authData.user.id,
            email,
            full_name: full_name.trim(),
            study_year: parsedStudyYear,
            specialization_interest: specialization_interest?.trim() || null,
            phone_number: formattedPhoneNumber,
            sms_consent: parsedSmsConsent,
            role: 'student',
            school_id: schoolId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);

        if (profileError) {
          // Rollback auth user if profile creation fails
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
          results.push({
            success: false,
            email,
            error: `Profile creation failed: ${profileError.message}`,
          });
          continue;
        }

        results.push({
          success: true,
          email,
          userId: authData.user.id,
        });
      } catch (err: unknown) {
        results.push({
          success: false,
          email,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        message: `Created ${successCount} user(s) successfully. ${failureCount} failed.`,
        results,
        summary: {
          total: results.length,
          success: successCount,
          failed: failureCount,
        },
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (err: unknown) {
    console.error('Bulk create users error:', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal server error',
        results: [],
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
