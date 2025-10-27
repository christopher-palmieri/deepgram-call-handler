# Google Maps API Setup for Timezone Detection

## Overview

The `detect-timezone` edge function uses Google Maps APIs to automatically detect timezones from clinic addresses.

**APIs Required:**
- Google Maps Geocoding API (address → coordinates)
- Google Maps Time Zone API (coordinates → timezone)

**Cost:**
- $5 per 1,000 requests for each API ($10 total per 1,000 addresses)
- **FREE TIER**: $200/month credit = ~10,000 addresses/month FREE
- After free tier: Pay only for what you use

---

## Setup Steps (5 minutes)

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Click **"Select a project"** → **"New Project"**
4. Name it: `deepgram-call-handler` (or your preference)
5. Click **"Create"**

### 2. Enable Required APIs

1. In the Google Cloud Console, go to **"APIs & Services"** → **"Library"**
2. Search for and enable these two APIs:
   - **"Geocoding API"** - Click "Enable"
   - **"Time Zone API"** - Click "Enable"

### 3. Create API Key

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"+ Create Credentials"** → **"API Key"**
3. Copy the API key (you'll need this next)
4. Click **"Edit API key"** (optional but recommended for security):
   - Under **"API restrictions"**, select **"Restrict key"**
   - Check only:
     - ✅ Geocoding API
     - ✅ Time Zone API
   - Click **"Save"**

### 4. Add API Key to Supabase

#### Option A: Supabase Dashboard (Recommended)
1. Go to your [Supabase Dashboard](https://app.supabase.com/)
2. Select your project
3. Go to **Settings** → **Edge Functions** → **Secrets**
4. Click **"Add new secret"**
5. Name: `GOOGLE_MAPS_API_KEY`
6. Value: Paste your API key
7. Click **"Save"**

#### Option B: Supabase CLI
```bash
supabase secrets set GOOGLE_MAPS_API_KEY=your_api_key_here
```

### 5. Deploy Edge Function

```bash
# From project root
supabase functions deploy detect-timezone
```

Or if using manual deployment, copy the function to your Supabase project.

---

## Testing the Function

**IMPORTANT:** This edge function requires **user authentication** (not just the anon key). You must be logged in to use it.

### Option 1: Test via Import UI (Easiest)

1. Log into your dashboard
2. Click **"📁 Import Calls"**
3. Upload a file without timezone data
4. Get to Step 3: Configure Transformations
5. Click **"🌍 Auto-Detect Timezones from Addresses"**
6. Watch it work automatically!

### Option 2: Test with cURL (Advanced)

**Step 1: Get Your Session Token**

1. Log into your dashboard
2. Open browser DevTools (F12)
3. Go to Console tab
4. Run this command:
```javascript
supabase.auth.getSession().then(s => console.log(s.data.session.access_token))
```
5. Copy the token (starts with `eyJ...`)

**Step 2: Test with cURL**

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/detect-timezone \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "123 Main Street, New York, NY 10001"
  }'
```

**Note:** Replace `YOUR_SESSION_TOKEN_HERE` with the token from Step 1.

### Expected Response:

```json
{
  "success": true,
  "results": [
    {
      "address": "123 Main Street, New York, NY 10001",
      "timezone": "America/New_York",
      "lat": 40.7489,
      "lng": -73.9680,
      "error": null
    }
  ],
  "summary": {
    "total": 1,
    "successful": 1,
    "failed": 0
  }
}
```

### Batch Test (Multiple Addresses):

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/detect-timezone \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "addresses": [
      "123 Main St, New York, NY",
      "456 Market St, San Francisco, CA",
      "789 Lake Shore Dr, Chicago, IL"
    ]
  }'
```

### Why Not the Anon Key?

❌ **Anon key won't work** - It's just a public identifier
✅ **Session token required** - Proves you're a logged-in user
✅ **Better security** - Prevents unauthorized API usage
✅ **Cost control** - Only your users can trigger geocoding

---

## Cost Monitoring

### Check Usage:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to **"APIs & Services"** → **"Dashboard"**
4. View API usage graphs

### Set Budget Alerts:
1. Go to **"Billing"** → **"Budgets & alerts"**
2. Click **"Create Budget"**
3. Set budget amount (e.g., $50/month)
4. Set alert thresholds (e.g., 50%, 90%, 100%)
5. Add your email for alerts

---

## Troubleshooting

### Error: "Google Maps API key not configured"
- **Solution**: Add the `GOOGLE_MAPS_API_KEY` secret to Supabase (see Step 4)

### Error: "Geocoding failed: REQUEST_DENIED"
- **Solution**: Make sure Geocoding API is enabled in Google Cloud Console
- **Solution**: Check API key restrictions allow Geocoding API

### Error: "Timezone lookup failed: REQUEST_DENIED"
- **Solution**: Make sure Time Zone API is enabled in Google Cloud Console
- **Solution**: Check API key restrictions allow Time Zone API

### Address not found
- **Issue**: Address is incomplete or invalid
- **Solution**: Ensure address includes city, state for US addresses
- **Example Good Address**: "123 Main St, New York, NY 10001"
- **Example Bad Address**: "Main St" (too vague)

---

## Security Best Practices

1. ✅ **Restrict API Key** to only Geocoding + Time Zone APIs
2. ✅ **Store API key** as Supabase secret (never in code)
3. ✅ **Set budget alerts** to avoid surprise charges
4. ✅ **Monitor usage** regularly in Google Cloud Console
5. ✅ **Use authentication** - Edge function requires user login

---

## Usage in Application

### Import Wizard
- Step 3: "Auto-detect Timezones" button
- Processes addresses for all selected rows
- Shows progress and results

### Dashboard
- "Fix Missing Timezones" button
- Batch processes all calls with missing timezones
- Updates database automatically

### New Call Form (Future)
- Optional: Auto-detect when address is entered
- Fills timezone field automatically

---

## Support

**Google Maps API Docs:**
- Geocoding API: https://developers.google.com/maps/documentation/geocoding
- Time Zone API: https://developers.google.com/maps/documentation/timezone

**Pricing Calculator:**
- https://mapsplatform.google.com/pricing/

**Questions?**
- Check Google Cloud Console for API usage/errors
- Review Supabase Edge Function logs
- Verify API key is correctly set in Supabase secrets
