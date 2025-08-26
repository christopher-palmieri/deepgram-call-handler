// api/monitor/send-otp.js
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Store OTPs temporarily (use Supabase or Redis in production)
const otpStore = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body;

  try {
    // First, verify the email/password with Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get user's phone number from profile (you'll need to store this)
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles') // Create this table to store user phone numbers
      .select('phone_number')
      .eq('user_id', authData.user.id)
      .single();

    if (profileError || !profile?.phone_number) {
      // If no phone on file, let them through without MFA (or require setup)
      return res.status(200).json({ 
        requiresMFA: false,
        sessionToken: authData.session.access_token 
      });
    }

    // Generate and send OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP with user ID
    otpStore.set(authData.user.id, {
      otp,
      expires: Date.now() + 5 * 60 * 1000,
      attempts: 0,
      sessionData: authData.session
    });

    // Send SMS
    await twilioClient.messages.create({
      body: `Your IVR Monitor verification code is: ${otp}`,
      from: process.env.TWILIO_NUMBER,
      to: profile.phone_number
    });

    res.status(200).json({ 
      requiresMFA: true,
      userId: authData.user.id,
      phoneNumber: profile.phone_number.replace(/\d(?=\d{4})/g, '*') // Mask phone
    });

  } catch (error) {
    console.error('Error in send-otp:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
}
