import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lvpbwtfvairspufrashl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc3B1ZnJhc2hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg2NDU0MTgsImV4cCI6MjA1NDIyMTQxOH0.1AzQAkaNMovPVJxE16XlLLxV18PtfXtA6goCdtihofc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testEvaluation() {
  console.log('🧪 Testing Evaluation Scoring System\n');
  
  // 1. Check if migration was applied (columns exist)
  console.log('1️⃣ Checking if evaluation columns exist...');
  const { data: testData, error: testError } = await supabase
    .from('student_room_assignments')
    .select('id, communication_score, mdm_score, communication_breakdown, mdm_breakdown, learning_objectives, case_difficulty')
    .limit(1);
  
  if (testError) {
    console.log('❌ Error: Migration not applied or columns do not exist');
    console.log('Error details:', testError);
    console.log('\n🔧 TO FIX: Run the migration');
    console.log('   cd ~/clawd/nursebot');
    console.log('   npx supabase link --project-ref lvpbwtfvairspufrashl');
    console.log('   npx supabase db push');
    return;
  }
  
  console.log('✅ Evaluation columns exist in database\n');
  
  // 2. Find a completed assignment to test with
  console.log('2️⃣ Finding a completed assignment...');
  const { data: assignments, error: assignError } = await supabase
    .from('student_room_assignments')
    .select('id, status, feedback_status, student_id, room_id')
    .in('status', ['completed', 'bedside'])
    .limit(5);
  
  if (assignError || !assignments || assignments.length === 0) {
    console.log('❌ No completed assignments found for testing');
    console.log('   Create a test assignment first');
    return;
  }
  
  console.log(`✅ Found ${assignments.length} completed assignments`);
  console.log('   Test assignment ID:', assignments[0].id);
  console.log('   Feedback status:', assignments[0].feedback_status, '\n');
  
  // 3. Check if evaluation function exists
  console.log('3️⃣ Checking generate-feedback function...');
  const testAssignmentId = assignments[0].id;
  
  // Try to invoke the function
  const { data: funcData, error: funcError } = await supabase.functions.invoke('generate-feedback', {
    body: { assignmentId: testAssignmentId }
  });
  
  if (funcError) {
    console.log('❌ Error invoking function:', funcError);
    console.log('\n🔧 The function might not be deployed or there\'s an error in the code');
    console.log('   Check: cd ~/clawd/nursebot && npx supabase functions logs generate-feedback');
    return;
  }
  
  console.log('✅ Function invoked successfully');
  console.log('Response:', JSON.stringify(funcData, null, 2), '\n');
  
  // 4. Verify the evaluation was saved
  console.log('4️⃣ Verifying evaluation was saved...');
  const { data: savedEval, error: saveError } = await supabase
    .from('student_room_assignments')
    .select('communication_score, mdm_score, learning_objectives, communication_breakdown, mdm_breakdown')
    .eq('id', testAssignmentId)
    .single();
  
  if (saveError) {
    console.log('❌ Error fetching saved evaluation:', saveError);
    return;
  }
  
  console.log('✅ Evaluation saved successfully!');
  console.log('   Communication Score:', savedEval.communication_score);
  console.log('   MDM Score:', savedEval.mdm_score);
  console.log('   Learning Objectives:', savedEval.learning_objectives?.substring(0, 100) + '...');
  console.log('\n✅ ALL TESTS PASSED! Evaluation system is working.');
}

testEvaluation();
