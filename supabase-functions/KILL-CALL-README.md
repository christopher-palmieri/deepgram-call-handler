# Kill Call Edge Function

## Purpose
Terminates a live Twilio call by updating its status to `completed` via the Twilio REST API.

## Endpoint
```
POST https://YOUR_PROJECT.supabase.co/functions/v1/kill-call
```

## Authentication
Requires a valid Supabase JWT token in the Authorization header:
```
Authorization: Bearer YOUR_SUPABASE_JWT_TOKEN
```

## Request Body
```json
{
  "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

### Parameters:
- **callSid** (string, required): The Twilio Call SID to terminate

## Response

### Success (200 OK)
```json
{
  "success": true,
  "message": "Call CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx terminated successfully",
  "data": {
    "callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "status": "completed",
    "duration": "45",
    "endTime": "Thu, 05 Nov 2025 12:34:56 +0000"
  }
}
```

### Error Responses

**401 Unauthorized**
```json
{
  "error": "Missing authorization header"
}
```
or
```json
{
  "error": "Unauthorized"
}
```

**400 Bad Request**
```json
{
  "error": "Missing callSid parameter"
}
```

**404 Not Found**
```json
{
  "error": "Call not found in Twilio"
}
```

**500 Internal Server Error**
```json
{
  "error": "Failed to terminate call via Twilio API",
  "details": "..."
}
```

## Environment Variables Required

The following environment variables must be set in your Supabase Edge Function configuration:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |

## Deployment

### 1. Deploy the function to Supabase

```bash
# Login to Supabase CLI
supabase login

# Link your project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy the function
supabase functions deploy kill-call
```

### 2. Set environment variables (if not already set)

```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=your_auth_token
```

## Usage Example

### Using cURL:
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/kill-call \
  -H "Authorization: Bearer YOUR_SUPABASE_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"callSid": "CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}'
```

### Using JavaScript (from dashboard):
```javascript
const response = await fetch('https://YOUR_PROJECT.supabase.co/functions/v1/kill-call', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${supabaseToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    callSid: 'CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  })
});

const result = await response.json();
console.log(result);
```

### Integration in Dashboard:
You can add a "Kill Call" button in the monitor page or dashboard that calls this edge function when clicked.

## How It Works

1. Validates user authentication via Supabase JWT
2. Extracts `callSid` from request body
3. Makes POST request to Twilio API:
   ```
   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}.json
   Body: Status=completed
   ```
4. Twilio immediately terminates the call
5. Optionally updates `call_sessions` table with termination timestamp
6. Returns success response with call details

## Database Updates

The function automatically updates the `call_sessions` table (if a record exists for the call):
- Sets `call_ended_at` to current timestamp
- Sets `call_status` to `'terminated'`
- Updates `updated_at` timestamp

## Notes

- The call is terminated **immediately** when this function is called
- Both call participants will be disconnected
- The call duration will reflect the time up to termination
- Failed updates to `call_sessions` will log a warning but won't fail the overall operation
- This function requires active Twilio credentials with permissions to modify calls

## Testing

To test the function:

1. Make a test call using your system
2. Get the Call SID from Twilio console or your database
3. Call this edge function with the Call SID
4. Verify the call terminates immediately
5. Check Twilio console to confirm the call status is "completed"
