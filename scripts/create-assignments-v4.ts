import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://lvpbwtfvairspufrashl.supabase.co';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔑 Using configuration:');
console.log('   Supabase URL:', supabaseUrl);
console.log('   Anon key exists:', !!anonKey);
console.log('   Service role key exists:', !!serviceRoleKey);

// Anon client for auth operations
const anonClient = createClient(supabaseUrl, anonKey);
// Service role client for admin operations (bypasses RLS)
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function createTestAssignments() {
  console.log('🚀 Creating test assignments...\n');

  // Step 1: Log in as superadmin
  console.log('\n📋 Step 1: Logging in as superadmin...\n');
  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email: 'coalfocks@gmail.com',
    password: 'Pencilninety2!',
  });

  if (authError) {
    console.error('❌ Login failed:', authError);
    return;
  }

  console.log('✅ Logged in as:', authData.user.email);
  console.log('   User ID:', authData.user.id);

  // Step 2: Get student user info
  console.log('\n📋 Step 2: Getting student user info...');
  const { data: users, error: usersError } = await adminClient.auth.admin.listUsers({
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
  console.log('   Role:', student.user_metadata?.role || 'student');

  // Step 3: Get school ID
  console.log('\n📋 Step 3: Getting school ID...\n');
  const { data: schools, error: schoolsError } = await adminClient
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

  // Step 4: Get available rooms for ATSU-SOMA
  console.log('\n📋 Step 4: Getting available rooms...\n');
  const { data: rooms, error: roomsError } = await adminClient
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

  // Step 5: Create assignments with proper spacing
  console.log('\n📋 Step 5: Creating assignments...\n');

  // Calculate start time (now + 10 minutes to give buffer)
  const now = new Date();
  const startTime = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes from now
  const windowDurationMinutes = 40;

  // Select 4 rooms for assignment
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
      assigned_by: authData.user.id, // Use logged-in admin user ID
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

  // Step 6: Insert assignments
  console.log('\n📋 Step 6: Inserting assignments into database...\n');

  const { data: insertedAssignments, error: insertError } = await adminClient
    .from('student_room_assignments')
    .insert(assignments)
    .select();

  if (insertError) {
    console.error('❌ Failed to insert assignments:', insertError);
    return;
  }

  console.log(`✅ Successfully created ${insertedAssignments.length} assignments!`);

  // Step 7: Verify assignments
  console.log('\n📋 Step 7: Verifying assignments...\n');
  const { data: verifiedAssignments, error: verifyError } = await adminClient
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
