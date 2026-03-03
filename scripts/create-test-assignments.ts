import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lvpbwtfvairspufrashl.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc3B1ZnJhc2hsIiwicm9sZSI6InNlcnZpY2V9yb2UiLCJpYXQiOjE3Mzg2NDU0MTgsImV4cCI6MjA1NDIyMTQxOH0.1AzQAkaNMovPVJxE16XlLLxV18PtfXtA6goCdtihofc';

console.log('🔑 Configuration loaded');
console.log('   Supabase URL:', supabaseUrl);
console.log('   Anon key: exists');

// Use anon client for database operations
const supabase = createClient(supabaseUrl, anonKey);

async function createTestAssignments() {
  console.log('🚀 Creating test assignments...\n');

  // Hardcoded IDs from previous exploration
  const studentId = '0d6956fc-9376-45f6-88f8-589f91d7901a'; // coalfocks+1@gmail.com
  const schoolId = '14122901-c0f8-4b4e-adc7-6d385f3bba76'; // ATSU-SOMA
  const adminUserId = '53d0305f-1375-46ef-a6ed-95fcfb7b8d30'; // coalfocks@gmail.com

  console.log('\n📋 Using known IDs...');
  console.log('   Student ID:', studentId);
  console.log('   School ID:', schoolId);
  console.log('   Admin ID:', adminUserId);

  // Step 1: Get available rooms
  console.log('\n📋 Step 1: Getting available rooms...\n');
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

  // Step 2: Create assignments with proper spacing
  console.log('\n📋 Step 2: Creating assignments...\n');

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
      student_id: studentId,
      room_id: selectedRooms[i].id,
      school_id: schoolId,
      assigned_by: adminUserId, // Use admin user ID directly
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

  // Step 3: Insert assignments
  console.log('\n📋 Step 3: Inserting assignments into database...\n');

  const { data: insertedAssignments, error: insertError } = await supabase
    .from('student_room_assignments')
    .insert(assignments)
    .select();

  if (insertError) {
    console.error('❌ Failed to insert assignments:', insertError);
    return;
  }

  console.log(`✅ Successfully created ${insertedAssignments.length} assignments!`);

  // Step 4: Verify assignments
  console.log('\n📋 Step 4: Verifying assignments...\n');
  const { data: verifiedAssignments, error: verifyError } = await supabase
    .from('student_room_assignments')
    .select('*')
    .eq('student_id', studentId)
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
