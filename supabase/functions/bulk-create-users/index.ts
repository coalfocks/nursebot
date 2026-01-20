import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

interface CsvUser {
  school: string;
  name: string;
  email: string;
  password: string;
  specialty: string;
}

interface BulkCreateRequest {
  users: CsvUser[];
}

interface CreateResult {
  success: boolean;
  email: string;
  error?: string;
  userId?: string;
  skipped?: boolean;
}

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

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
    const { users }: BulkCreateRequest = await req.json();

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

    const results: CreateResult[] = [];

    for (const user of users) {
      const { school, name, email, password, specialty } = user;

      // Validate required fields
      if (!school || !name || !email || !password || !specialty) {
        results.push({
          success: false,
          email: email || 'unknown',
          error: 'Missing required fields: school, name, email, password, and specialty are required',
        });
        continue;
      }

      try {
        // Check if user already exists by email
        const { data: existingUser, error: checkError } = await supabaseAdmin
          .from('profiles')
          .select('id, email')
          .ilike('email', email.trim())
          .maybeSingle();

        if (checkError) {
          results.push({
            success: false,
            email,
            error: `Error checking for existing user: ${checkError.message}`,
          });
          continue;
        }

        if (existingUser) {
          results.push({
            success: true,
            email,
            skipped: true,
            userId: existingUser.id,
          });
          continue;
        }

        // Look up school by name
        const { data: schoolData, error: schoolError } = await supabaseAdmin
          .from('schools')
          .select('id')
          .ilike('name', school.trim())
          .single();

        if (schoolError || !schoolData) {
          results.push({
            success: false,
            email,
            error: `School "${school}" not found`,
          });
          continue;
        }

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
        const { error: profileError } = await supabaseAdmin.from('profiles').insert([
          {
            id: authData.user.id,
            email,
            full_name: name.trim(),
            study_year: 1,
            specialization_interest: specialty.trim(),
            phone_number: null,
            sms_consent: false,
            role: 'student',
            school_id: schoolData.id,
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

    const successCount = results.filter((r) => r.success && !r.skipped).length;
    const skippedCount = results.filter((r) => r.skipped).length;
    const failureCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        message: `Created ${successCount} user(s) successfully. ${skippedCount} skipped (already exist). ${failureCount} failed.`,
        results,
        summary: {
          total: results.length,
          success: successCount,
          skipped: skippedCount,
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
