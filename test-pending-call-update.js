// Test script to update pending call fields and verify real-time updates
// Run this with: node test-pending-call-update.js

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testPendingCallUpdate() {
    try {
        // Get the most recent pending call
        const { data: pendingCalls, error: fetchError } = await supabase
            .from('pending_calls')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1);

        if (fetchError) {
            console.error('Error fetching pending calls:', fetchError);
            return;
        }

        if (!pendingCalls || pendingCalls.length === 0) {
            console.error('No pending calls found');
            return;
        }

        const pendingCall = pendingCalls[0];
        console.log('Using pending call:', {
            id: pendingCall.id,
            employee: pendingCall.employee_name,
            phone: pendingCall.phone,
            appointment_time: pendingCall.appointment_time
        });

        // Test 1: Update the phone field
        console.log('\n📝 Test 1: Updating phone field...');
        const newPhone = '555-' + Math.floor(Math.random() * 9000 + 1000);
        const { data: phoneUpdate, error: phoneError } = await supabase
            .from('pending_calls')
            .update({ phone: newPhone })
            .eq('id', pendingCall.id)
            .select()
            .single();

        if (phoneError) {
            console.error('Error updating phone:', phoneError);
        } else {
            console.log('✅ Updated phone to:', phoneUpdate.phone);
        }

        // Wait 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test 2: Update the appointment_time field
        console.log('\n📝 Test 2: Updating appointment_time field...');
        const newAppointmentTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // Tomorrow
        const { data: appointmentUpdate, error: appointmentError } = await supabase
            .from('pending_calls')
            .update({ appointment_time: newAppointmentTime })
            .eq('id', pendingCall.id)
            .select()
            .single();

        if (appointmentError) {
            console.error('Error updating appointment_time:', appointmentError);
        } else {
            console.log('✅ Updated appointment_time to:', appointmentUpdate.appointment_time);
        }

        // Wait 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test 3: Update multiple fields at once
        console.log('\n📝 Test 3: Updating multiple fields...');
        const { data: multiUpdate, error: multiError } = await supabase
            .from('pending_calls')
            .update({
                phone: '555-9999',
                appointment_time: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // Day after tomorrow
                workflow_state: 'updated_' + Date.now(),
                success_evaluation: 'Test evaluation at ' + new Date().toLocaleTimeString()
            })
            .eq('id', pendingCall.id)
            .select()
            .single();

        if (multiError) {
            console.error('Error updating multiple fields:', multiError);
        } else {
            console.log('✅ Updated multiple fields:', {
                phone: multiUpdate.phone,
                appointment_time: multiUpdate.appointment_time,
                workflow_state: multiUpdate.workflow_state,
                success_evaluation: multiUpdate.success_evaluation
            });
        }

        console.log('\n🎉 Test complete! Check the monitor.html page to verify:');
        console.log('1. Phone and appointment fields should update without becoming blank');
        console.log('2. The call info panel should flash blue when updates occur');
        console.log(`3. Navigate to: /monitor.html?id=${pendingCall.id}`);

    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Run the test
testPendingCallUpdate();