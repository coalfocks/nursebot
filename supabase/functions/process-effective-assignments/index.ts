import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import twilio from 'npm:twilio@5.5.1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
function handleCors(req) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
}
async function sendSmsNotification(userId, message, supabase) {
  try {
    const { data: profile, error: profileError } = await supabase.from('profiles').select('phone_number, sms_consent').eq('id', userId).single();
    if (profileError || !profile) {
      console.error('Error fetching user profile:', profileError);
      return false;
    }
    if (!profile.sms_consent || !profile.phone_number) {
      console.log(`User ${userId} has not consented to SMS notifications or has no phone number`);
      return false;
    }
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');
    if (!accountSid || !authToken || !twilioPhoneNumber) {
      console.log(accountSid);
      console.log(authToken);
      console.log(twilioPhoneNumber);
      console.error('Twilio configuration is missing');
      return false;
    }
    const client = twilio(accountSid, authToken);
    await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: profile.phone_number
    });
    return true;
  } catch (error) {
    console.error('Error sending SMS notification:', error);
    return false;
  }
}
async function sendAssignmentEffectiveNotification(assignmentId, supabase) {
  try {
    const { data, error: assignmentError } = await supabase.from('student_room_assignments').select(`student_id, room:room_id ( room_number )`).eq('id', assignmentId).single();
    if (assignmentError || !data) {
      console.error('Error fetching assignment details:', assignmentError);
      return false;
    }
    const message = `You have a message waiting for you from a nurse in Room ${data.room.room_number} on Nurse Connect.`;
    return await sendSmsNotification(data.student_id, message, supabase);
  } catch (error) {
    console.error('Error sending assignment effective notification:', error);
    return false;
  }
}
Deno.serve(async (req)=>{
  try {
    const corsResponse = handleCors(req);
    if (corsResponse) return corsResponse;
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);
    const now = new Date().toISOString();
    console.log('NOW:', now);
    console.log('AFTER:', new Date(Date.now() - 60000).toISOString());
    const { data: effectiveAssignments, error: effectiveError } = await supabase.from('student_room_assignments').select('id').in('status', [
      'assigned',
      'in_progress'
    ]).not('effective_date', 'is', null).lte('effective_date', now).gt('effective_date', new Date(Date.now() - 120000).toISOString()).is('notification_sent', null);
    if (effectiveError) throw effectiveError;
    for (const assignment of effectiveAssignments || []){
      const success = await sendAssignmentEffectiveNotification(assignment.id, supabase);
      if (success) {
        await supabase.from('student_room_assignments').update({
          notification_sent: true,
          notification_sent_at: now
        }).eq('id', assignment.id);
      }
    }
    const { data: completedAssignments, error: completedError } = await supabase.from('student_room_assignments').select('id').in('status', [
      'assigned',
      'in_progress'
    ]).not('effective_date', 'is', null).lte('effective_date', new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if (completedError) throw completedError;
    for (const assignment of completedAssignments || []){
      await supabase.from('student_room_assignments').update({
        status: 'completed',
        updated_at: now,
        feedback_status: 'pending'
      }).eq('id', assignment.id);
    }
    return new Response(JSON.stringify({
      success: true,
      effectiveProcessed: effectiveAssignments?.length || 0,
      completedProcessed: completedAssignments?.length || 0
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
