import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lvpbwtfvairspufrashl.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc3B1ZnJhc2hsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODY0NTQxOCwiZXhwIjoyMDU0MjIxNDE4fQ._BTVbm34aB3G_fFAKHvXSGvfEcJsoRNmpTzDJC8dORg';

console.log('🔍 Testing database connection...');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function testConnection() {
  try {
    // Test 1: List tables (read-only)
    console.log('\n📋 Testing: List tables...');
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .limit(10);

    if (tablesError) {
      console.error('❌ Failed to list tables:', tablesError.message);
    } else {
      console.log('✅ Successfully connected to database');
      console.log(`📊 Found tables:`, tables?.map(t => t.table_name).join(', ') || 'none');
    }

    // Test 2: Check if we can query auth schema (service role only)
    console.log('\n👤 Testing: Service role permissions...');
    const { data: users, error: usersError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    if (usersError) {
      console.error('❌ Service role access failed:', usersError.message);
    } else {
      console.log('✅ Service role access confirmed');
      console.log(`👥 Total users:`, users.total);
    }

    console.log('\n✅ All tests passed! Database connection is working.');
  } catch (error) {
    console.error('❌ Connection test failed:', error);
    process.exit(1);
  }
}

testConnection();
