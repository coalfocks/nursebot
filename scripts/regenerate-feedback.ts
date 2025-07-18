import { createClient } from '@supabase/supabase-js';
import * as readline from 'readline';

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-feedback`;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface Assignment {
  id: string;
  status: string;
  feedback_status: string;
  student_id: string;
  room_id: number;
  created_at: string;
}

async function getAllCompletedAssignments(): Promise<Assignment[]> {
  console.log('🔍 Fetching all completed assignments...');
  
  const { data: assignments, error } = await supabase
    .from('student_room_assignments')
    .select('id, status, feedback_status, student_id, room_id, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching assignments:', error);
    throw error;
  }

  console.log(`📋 Found ${assignments.length} completed assignments`);
  return assignments;
}

async function regenerateFeedback(assignmentId: string): Promise<void> {
  console.log(`🔄 Regenerating feedback for assignment ${assignmentId}...`);
  
  try {
    // Reset feedback status to pending before regenerating
    const { error: resetError } = await supabase
      .from('student_room_assignments')
      .update({
        feedback_status: 'pending',
        feedback_error: null,
        nurse_feedback: null,
        feedback_generated_at: null
      })
      .eq('id', assignmentId);

    if (resetError) {
      console.error(`❌ Error resetting feedback status for ${assignmentId}:`, resetError);
      throw resetError;
    }

    // Call the edge function to generate feedback
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ assignmentId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    
    if (result.success) {
      console.log(`✅ Successfully regenerated feedback for assignment ${assignmentId}`);
    } else {
      console.error(`❌ Failed to regenerate feedback for assignment ${assignmentId}:`, result.error);
    }
  } catch (error) {
    console.error(`❌ Error regenerating feedback for assignment ${assignmentId}:`, error);
    throw error;
  }
}

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  try {
    console.log('🚀 Starting feedback regeneration script...\n');
    
    // Get all completed assignments
    const assignments = await getAllCompletedAssignments();
    
    if (assignments.length === 0) {
      console.log('ℹ️  No completed assignments found. Exiting.');
      return;
    }

    console.log(`\n📊 Assignment summary:`);
    console.log(`   Total completed assignments: ${assignments.length}`);
    
    // Group by feedback status
    const statusCounts = assignments.reduce((acc, assignment) => {
      acc[assignment.feedback_status] = (acc[assignment.feedback_status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   Feedback status '${status}': ${count}`);
    });

    // Ask for confirmation
    console.log(`\n⚠️  This will regenerate feedback for ALL ${assignments.length} completed assignments.`);
    console.log('   This may take a while and will use OpenAI API credits.');
    
    const confirmation = await askQuestion('Continue? (y/N): ');
    if (confirmation.toLowerCase() !== 'y') {
      console.log('❌ Aborted by user.');
      return;
    }

    console.log('\n🔄 Starting feedback regeneration...\n');
    
    // Process assignments with a delay to avoid rate limiting
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < assignments.length; i++) {
      const assignment = assignments[i];
      
      try {
        await regenerateFeedback(assignment.id);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`❌ Failed to process assignment ${assignment.id}:`, error);
      }
      
      // Add a small delay between requests to avoid overwhelming the system
      if (i < assignments.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Show progress
      const progress = ((i + 1) / assignments.length * 100).toFixed(1);
      console.log(`📈 Progress: ${i + 1}/${assignments.length} (${progress}%)`);
    }

    console.log('\n🎉 Feedback regeneration completed!');
    console.log(`✅ Successfully processed: ${successCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);