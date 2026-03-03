import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lvpbwtfvairspufrashl.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc3B1ZnJhc2hsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODY0NTQxOCwiZXhwIjoyMDU0MjIxNDE4fQ._BTVbm34aB3G_fFAKHvXSGvfEcJsoRNmpTzDJC8dORg';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function exploreDatabase() {
  console.log('🔍 Exploring database structure...\n');

  // Get user IDs from auth
  console.log('📋 1. Finding users from auth...');
  const { data: allUsers, error: allUsersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (allUsersError) {
    console.error('❌ Error fetching users:', allUsersError);
    return;
  }

  const coalFocks = allUsers.users.find(u => u.email === 'coalfocks@gmail.com');
  const coalFocksStudent = allUsers.users.find(u => u.email === 'coalfocks+1@gmail.com');

  if (coalFocks) {
    console.log(`✅ Found superadmin: ${coalFocks.email} (ID: ${coalFocks.id})`);
  }
  if (coalFocksStudent) {
    console.log(`✅ Found student: ${coalFocksStudent.email} (ID: ${coalFocksStudent.id})`);
  }

  if (!coalFocks || !coalFocksStudent) {
    console.error('❌ Could not find required users');
    return;
  }

  // List tables to understand structure
  console.log('\n📋 2. Listing public tables...');
  const { data: tables, error: tablesError } = await supabase
    .rpc('get_tables');

  if (tablesError) {
    // Try manual query
    console.log('⚠️  Could not use RPC, trying alternative...');
  } else {
    console.log('✅ Tables:', tables);
  }

  // Get school info
  console.log('\n📋 3. Finding schools...');
  const { data: schools, error: schoolsError } = await supabase
    .from('schools')
    .select('*')
    .ilike('name', '%ATSU%')
    .limit(5);

  if (schoolsError) {
    console.error('❌ Error fetching schools:', schoolsError);
    console.log('   (schools table might not exist or be named differently)');
  } else {
    console.log(`✅ Found ${schools.length} schools:`, schools);
  }

  // Get rooms
  console.log('\n📋 4. Finding rooms...');
  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('*')
    .limit(5);

  if (roomsError) {
    console.error('❌ Error fetching rooms:', roomsError);
    console.log('   (rooms table might not exist or be named differently)');
  } else {
    console.log(`✅ Found ${rooms.length} rooms:`, rooms);
  }

  // Get assignments
  console.log('\n📋 5. Finding assignments...');
  const { data: assignments, error: assignmentsError } = await supabase
    .from('assignments')
    .select('*')
    .limit(5);

  if (assignmentsError) {
    console.error('❌ Error fetching assignments:', assignmentsError);
    console.log('   (assignments table might not exist or be named differently)');
  } else {
    console.log(`✅ Found ${assignments.length} assignments:`, assignments);
  }

  console.log('\n✅ Database exploration complete!');
}

exploreDatabase().catch(console.error);
