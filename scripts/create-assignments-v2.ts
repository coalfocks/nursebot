import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lvpbwtfvairspufrashl.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc2hsIiwicm9sZSI6InNlcnZpY2V9yb2UiLCJpYXQiOjE3Mzg2NDU0NDE0LCJleHAiOjI1NDIyMjE0MTQ4fQ._BTVbm34aB3G_fFAKHvXSGvfEcJsoRNmpTzDJC8dORg';

// Use service role key for admin operations
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function createTestAssignments() {
  console.log('🚀 Creating test assignments with service role key...\n');

  // Step 1: Get student user info
  console.log('\n📋 Step 1: Getting student user info...\n');
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (usersError) {
    console.error('❌ Failed to fetch users:', usersError);
    return;
  }

  const student = users.users.find(u => u.email === 'coalfocks+1@gmail.com');
  if (!student) {
    console.error('❌ Student user not found');
    return;
  }

  console.log('✅ Student found:', student.email);
  console.log('   User ID:', student.id);

  // Step 2: Get school ID
  console.log('\n📋 Step 2: Getting school ID...\n');
  const { data: schools, error: schoolsError } = await supabase
    .from('schools')
    .select('id')
    .eq('slug', 'atsu-soma')
    .single();

  if (schoolsError || !schools) {
    console.error('❌ Failed to fetch school:', schoolsError);
    return;
  }

  const schoolId = schools.id;
  console.log('✅ School ID:', schoolId);

  // Step 3: Get available rooms for ATSU-SOMA
  console.log('\n📋 Step 3: Getting available rooms...\n');
  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, room_number')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('id', { ascending: true });

  if (roomsError) {
    console.error('❌ Failed to fetch rooms:', roomsError);
    return;
  }

  console.log(`✅ Found ${rooms.length} available rooms:`, rooms.map(r => r.room_number).join(', '));

  // Step 4: Create assignments with proper spacing
  console.log('\n📋 Step 4: Creating assignments...\n');

  // Calculate start time (now + 10 minutes to give buffer)
  const now = new Date();
  const startTime = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes from now
  const windowDurationMinutes = 40;

  // Select 4 rooms for the assignment
  const selectedRooms = rooms.slice(0, 4);
  console.log(`   Selected rooms:`, selectedRooms.map(r => r.room_number).join(', '));

  const assignments = [];
  for (let i = 0; i < selectedRooms.length; i++) {
    // Calculate times with at least 10 minutes apart
    const roomStartTime = new Date(startTime.getTime() + (i * 10 * 60 * 1000)); // Each room 10 min apart
    const roomEndTime = new Date(roomStartTime.getTime() + (windowDurationMinutes / selectedRooms.length) * 60 * 1000);

    const assignment = {
      student_id: student.id,
      room_id: selectedRooms[i].id,
      school_id: schoolId,
      assigned_by: '53d0305f-1375-46ef-a6ed-95fcfb7b8d30', // Hardcoded superadmin user ID
      status: 'pending',
      effective_date: roomStartTime.toISOString(),
      window_start: roomStartTime.toISOString(),
      window_end: roomEndTime.toISOString(),
    };

    assignments.push(assignment);

    console.log(`   ✓ Room ${selectedRooms[i].room_number}:`);
    console.log(`     Start: ${roomStartTime.toLocaleTimeString()} (UTC)`);
    console.log(`     End:   ${roomEndTime.toLocaleTimeString()} (UTC)`);
    console.log(`     Duration: ${Math.round((roomEndTime.getTime() - roomStartTime.getTime()) / 60000)} minutes`);
  }

  // Step 5: Insert assignments
  console.log('\n📋 Step 5: Inserting assignments into database...\n');

  const { data: insertedAssignments, error: insertError } = await supabase
    .from('student_room_assignments')
    .insert(assignments)
    .select();

  if (insertError) {
    console.error('❌ Failed to insert assignments:', insertError);
    return;
  }

  console.log(`✅ Successfully created ${insertedAssignments.length} assignments!`);

  // Step 6: Verify assignments
  console.log('\n📋 Step 6: Verifying assignments...\n');
  const { data: verifiedAssignments, error: verifyError } = await supabase
    .from('student_room_assignments')
    .select('*')
    .eq('student_id', student.id)
    .order('effective_date', { ascending: true });

  if (verifyError) {
    console.error('❌ Failed to verify assignments:', verifyError);
    return;
  }

  console.log(`✅ Found ${verifiedAssignments.length} assignments in database for student`);

  // Calculate time differences
  console.log('\n📊 Time Spacing Analysis:');
  for (let i = 0; i < verifiedAssignments.length - 1; i++) {
    const current = new Date(verifiedAssignments[i].window_start);
    const next = new Date(verifiedAssignments[i + 1].window_start);
    const diffMinutes = (next.getTime() - current.getTime()) / 60000;

    console.log(`   Room ${verifiedAssignments[i].room_id} → Next room: ${diffMinutes} minutes apart ${diffMinutes >= 10 ? '✅' : '❌'}`);

    if (diffMinutes < 10) {
      console.error(`   ERROR: Rooms are only ${diffMinutes} minutes apart!`);
    }
  }

  // Check window coverage
  const firstStart = new Date(verifiedAssignments[0].window_start);
  const lastEnd = new Date(verifiedAssignments[verifiedAssignments.length - 1].window_end);
  const totalWindowMinutes = (lastEnd.getTime() - firstStart.getTime()) / 60000;

  console.log(`\n📊 Window Analysis:`);
  console.log(`   Total window: ${totalWindowMinutes} minutes (requested: ${windowDurationMinutes})`);
  console.log(`   First room starts: ${firstStart.toLocaleTimeString()} (UTC)`);
  console.log(`   Last room ends:   ${lastEnd.toLocaleTimeString()} (UTC)`);
  console.log(`   Within 40min window: ${totalWindowMinutes <= windowDurationMinutes ? '✅' : '❌'}`);

  console.log('\n✅ Assignment creation complete!');
}

createTestAssignments().catch(console.error);
