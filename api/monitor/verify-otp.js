// api/monitor/verify-otp.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, otp } = req.body;

  const stored = otpStore.get(userId);

  if (!stored) {
    return res.status(400).json({ error: 'No verification code found. Please login again.' });
  }

  if (Date.now() > stored.expires) {
    otpStore.delete(userId);
    return res.status(400).json({ error: 'Verification code expired. Please login again.' });
  }

  if (stored.attempts >= 3) {
    otpStore.delete(userId);
    return res.status(400).json({ error: 'Too many failed attempts. Please login again.' });
  }

  if (stored.otp !== otp) {
    stored.attempts++;
    return res.status(400).json({ 
      error: `Invalid code. ${3 - stored.attempts} attempts remaining.` 
    });
  }

  // Success - return the session data
  const sessionData = stored.sessionData;
  otpStore.delete(userId);

  res.status(200).json({ 
    success: true,
    session: sessionData
  });
}
