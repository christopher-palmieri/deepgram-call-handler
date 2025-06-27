// cleanup-stale-actions.js
// Run this as a cron job or scheduled function every few minutes

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function cleanupStaleActions() {
  try {
    // 1. Mark old unexecuted actions as expired
    const { data: expiredActions, error: expireError } = await supabase
      .from('ivr_events')
      .update({ 
        executed: true, 
        executed_at: new Date().toISOString(),
        error: 'expired_by_cleanup'
      })
      .eq('executed', false)
      .lt('created_at', new Date(Date.now() - 60000).toISOString()) // 1 minute old
      .select();
    
    if (expiredActions && expiredActions.length > 0) {
      console.log(`✅ Marked ${expiredActions.length} stale actions as expired`);
    }

    // 2. Clean up actions for completed calls
    const { data: completedCalls } = await supabase
      .from('call_sessions')
      .select('call_id')
      .eq('call_status', 'completed')
      .gte('call_ended_at', new Date(Date.now() - 300000).toISOString()); // Completed in last 5 minutes

    if (completedCalls && completedCalls.length > 0) {
      const callIds = completedCalls.map(c => c.call_id);
      
      const { data: cleanedActions } = await supabase
        .from('ivr_events')
        .update({ 
          executed: true, 
          executed_at: new Date().toISOString(),
          error: 'call_completed'
        })
        .in('call_id', callIds)
        .eq('executed', false)
        .select();
      
      if (cleanedActions && cleanedActions.length > 0) {
        console.log(`✅ Cleaned ${cleanedActions.length} actions for completed calls`);
      }
    }

    // 3. Fix any actions with mismatched call IDs in sessions
    const { data: orphanedActions } = await supabase
      .from('ivr_events')
      .select('id, call_id')
      .eq('executed', false);

    if (orphanedActions && orphanedActions.length > 0) {
      for (const action of orphanedActions) {
        const { data: session } = await supabase
          .from('call_sessions')
          .select('call_id')
          .eq('call_id', action.call_id)
          .maybeSingle();
        
        if (!session) {
          // No session exists for this call_id
          await supabase
            .from('ivr_events')
            .update({ 
              executed: true, 
              executed_at: new Date().toISOString(),
              error: 'no_session_exists'
            })
            .eq('id', action.id);
          
          console.log(`✅ Marked orphaned action ${action.id} as executed (no session)`);
        }
      }
    }

    return { 
      success: true, 
      expired: expiredActions?.length || 0,
      completed: cleanedActions?.length || 0,
      orphaned: orphanedActions?.filter(a => !a.session).length || 0
    };

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    return { success: false, error: error.message };
  }
}

// If running as a standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupStaleActions().then(result => {
    console.log('Cleanup completed:', result);
    process.exit(0);
  });
}
