// Test script to insert/update IVR events for testing real-time updates
// Run this with: node test-ivr-updates.js

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testIvrUpdates() {
    try {
        // Get a call_id from a recent call session
        const { data: sessions, error: sessionsError } = await supabase
            .from('call_sessions')
            .select('id, call_id, pending_call_id')
            .order('created_at', { ascending: false })
            .limit(1);

        if (sessionsError) {
            console.error('Error fetching call sessions:', sessionsError);
            return;
        }

        if (!sessions || sessions.length === 0) {
            console.error('No call sessions found');
            return;
        }

        const session = sessions[0];
        console.log('Using call session:', session);

        // Test 1: Insert a new IVR event
        console.log('\n📝 Test 1: Inserting new IVR event...');
        const { data: insertedEvent, error: insertError } = await supabase
            .from('ivr_events')
            .insert({
                call_id: session.call_id,
                action_type: 'speak',
                action_value: 'Testing real-time update',
                transcript: 'This is a test transcript for real-time monitoring',
                ai_reply: 'AI responded with this test message',
                timing_ms: Math.floor(Math.random() * 5000),
                executed: false
            })
            .select()
            .single();

        if (insertError) {
            console.error('Error inserting IVR event:', insertError);
        } else {
            console.log('✅ Inserted IVR event:', insertedEvent);
            
            // Wait 2 seconds then update it
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Test 2: Update the event
            console.log('\n📝 Test 2: Updating IVR event...');
            const { data: updatedEvent, error: updateError } = await supabase
                .from('ivr_events')
                .update({
                    executed: true,
                    transcript: 'Updated transcript - event has been executed',
                    ai_reply: 'AI confirmed execution'
                })
                .eq('id', insertedEvent.id)
                .select()
                .single();

            if (updateError) {
                console.error('Error updating IVR event:', updateError);
            } else {
                console.log('✅ Updated IVR event:', updatedEvent);
            }
        }

        // Test 3: Insert multiple events rapidly
        console.log('\n📝 Test 3: Inserting multiple events rapidly...');
        const actions = ['listen', 'speak', 'dtmf', 'transfer'];
        
        for (let i = 0; i < 4; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const { data: event, error } = await supabase
                .from('ivr_events')
                .insert({
                    call_id: session.call_id,
                    action_type: actions[i],
                    action_value: `Test value ${i + 1}`,
                    transcript: `Test transcript ${i + 1}: Real-time update test in progress`,
                    ai_reply: `AI response ${i + 1}`,
                    timing_ms: Math.floor(Math.random() * 10000),
                    executed: Math.random() > 0.5
                })
                .select()
                .single();

            if (error) {
                console.error(`Error inserting event ${i + 1}:`, error);
            } else {
                console.log(`✅ Inserted event ${i + 1}:`, event.action_type);
            }
        }

        console.log('\n🎉 Test complete! Check the monitor.html page to see real-time updates.');
        console.log('Make sure you have a session selected in the details panel to see the IVR events updating.');

    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Run the test
testIvrUpdates();