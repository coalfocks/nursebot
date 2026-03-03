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

  // Get user IDs
  console.log('📋 1. Finding users...');
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email, role')
    .or('email.eq.coalfocks@gmail.com,email.eq.coalfocks+1@gmail.com');

  if (usersError) {
    console.error('❌ Error fetching users:', usersError);
    return;
  }

  console.log('✅ Users found:', users);
  const superAdminUser = users.find(u => u.email === 'coalfocks@gmail.com');
  const studentUser = users.find(u => u.email === 'coalfocks+1@gmail.com');

  if (!superAdminUser || !studentUser) {
    console.error('❌ Could not find required users');
    return;
  }

  // Get school info
  console.log('\n📋 2. Finding school...');
  const { data: schools, error: schoolsError } = await supabase
    .from('schools')
    .select('id, name')
    .eq('name', 'ATSU-SOMA')
    .limit(1);

  if (schoolsError) {
    console.error('❌ Error fetching schools:', schoolsError);
    return;
  }

  console.log('✅ School found:', schools);
  const school = schools[0];

  // Get rooms
  console.log('\n📋 3. Finding rooms...');
  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, name, school_id')
    .eq('school_id', school.id)
    .limit(10);

  if (roomsError) {
    console.error('❌ Error fetching rooms:', roomsError);
    return;
  }

  console.log(`✅ Found ${rooms.length} rooms:`, rooms);

  // Get existing assignments
  console.log('\n📋 4. Checking existing assignments...');
  const { data: assignments, error: assignmentsError } = await supabase
    .from('assignments')
    .select('*')
    .eq('student_id', studentUser.id)
    .order('scheduled_start', { ascending: false })
    .limit(5);

  if (assignmentsError) {
    console.error('❌ Error fetching assignments:', assignmentsError);
  } else {
    console.log(`✅ Found ${assignments.length} existing assignments:`, assignments);
  }

  // Check assignment schema
  console.log('\n📋 5. Assignment schema columns...');
  const { data: columns, error: columnsError } = await supabase
    .rpc('get_columns', { table_name: 'assignments' });

  if (columnsError) {
    console.error('❌ Could not get columns (function may not exist)');
  } else {
    console.log('✅ Columns:', columns);
  }

  console.log('\n✅ Database exploration complete!');
  console.log('\n📝 Summary:');
  console.log(`  - Superadmin: ${superAdminUser.email} (ID: ${superAdminUser.id})`);
  console.log(`  - Student: ${studentUser.email} (ID: ${studentUser.id})`);
  console.log(`  - School: ${school.name} (ID: ${school.id})`);
  console.log(`  - Available rooms: ${rooms.length}`);
}

exploreDatabase().catch(console.error);
