import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lvpbwtfvairspufrashl.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc2hsIiwicm9sZSI6InNlcnZpY2V9yb2UiLCJpYXQiOjE3Mzg2NDU0NDE4LCJleHAiOjI1NDIyMjE0MTQ4fQ._BTVbm34aB3G_fFAKHvXSGvfEcJsoRNmpTzDJC8dORg';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function exploreSchema() {
  console.log('🔍 Exploring database schema...\n');

  // Try to list tables in a different way
  try {
    console.log('\n📋 Testing query to different potential table names...\n');

    // Try common table names
    const potentialTables = [
      'student_assignments',
      'student_assignments_room',
      'assignments',
      'room_assignments',
      'scheduled_assignments',
      'assignment_rooms'
    ];

    for (const tableName of potentialTables) {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);

      if (error) {
        console.log(`  ❌ ${tableName}: ${error.message}`);
      } else {
        console.log(`  ✅ ${tableName}: Found! (sample: ${data?.length || 0} rows)`);
      }
    }
  } catch (error) {
    console.log('❌ Error exploring schema:', error);
  }
}

exploreSchema().catch(console.error);
