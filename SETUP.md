# Nursebot Setup Guide

## ⚠️ CRITICAL SAFETY RULES

### Database Operations
- **NEVER run migrations** unless explicitly instructed by the user
- **NEVER write data** to the database unless explicitly instructed
- **NEVER delete or modify existing data** unless explicitly instructed
- Always ask before performing any destructive database operations
- Use read-only operations by default
- When in doubt, ask first!

**Violating these rules could cause data loss or system instability.**

---

## Environment Configuration

## Environment Configuration

The project is configured with Supabase. Two keys are required:

### 1. Anon Key (Already configured)
Used for client-side operations. Already in `.env`:
```
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_SUPABASE_URL=https://lvpbwtfvairspufrashl.supabase.co
```

### 2. Service Role Key (Required for server operations)
Used for:
- Database write access (admin operations)
- Deploying Supabase functions
- Checking function logs
- Managing users and auth

**How to get it:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: `lvpbwtfvairspufrashl`
3. Navigate to **Settings** → **API**
4. Copy the `service_role` secret key

**How to set it (choose one method):**

**Method A: Temporary (current session)**
```bash
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"
```

**Method B: Persistent (add to .env)**
```bash
# Add to .env (NEVER commit this!)
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"
```

## Supabase CLI

The Supabase CLI is available via npx:
```bash
cd ~/clawd/nursebot
npx supabase --version
```

### Linking to Remote Project

The Supabase CLI requires a personal access token (separate from service role key) for remote operations.

**To get your access token:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard/account/tokens)
2. Click "Generate new token"
3. Name it (e.g., "local-cli") and generate
4. Copy the token

**To set it:**
```bash
export SUPABASE_ACCESS_TOKEN="your-access-token-here"
# Or add to .env:
# SUPABASE_ACCESS_TOKEN="your-access-token-here"
```

**Then link the project:**
```bash
cd ~/clawd/nursebot
npx supabase link --project-ref lvpbwtfvairspufrashl
```

**Note:** Without the access token, you can still work with the database through:
- MCP server (using service role key) ✅ **Currently working**
- Direct database queries using `@supabase/supabase-js`
- Manual function deployment via dashboard

### Testing Database Connection

Run the test script to verify access:
```bash
npx tsx scripts/test-db-connection.ts
```

This will verify:
- Service role key authentication
- Database read access
- User management access

### Common Commands

**Deploy a function:**
```bash
npx supabase functions deploy <function-name>
```

**Deploy all functions:**
```bash
npx supabase functions deploy
```

**Check function logs:**
```bash
npx supabase functions logs <function-name>
```

**Check function logs with tail:**
```bash
npx supabase functions logs <function-name> --tail
```

**List all functions:**
```bash
npx supabase functions list
```

## MCP Server Integration

The project includes `.mcp.json` for Model Context Protocol integration with Supabase. This enables AI agents to interact with your database directly.

**Setup:**
1. Ensure `SUPABASE_SERVICE_ROLE_KEY` is set
2. The MCP server will be available when using tools that support MCP

## Available Functions

- `chat` - Chat interface (JWT verification disabled)
- `bulk-create-users` - Batch user creation
- `generate-feedback` - Assessment feedback generation
- `imaging-results` - Medical imaging results
- `lab-results` - Laboratory results processing
- `process-effective-assignments` - Assignment processing
- `rerun-assessments` - Assessment rerunning
- `send-sms` - SMS notifications
- `vitals-generator` - Vitals data generation

## Development

**Start development server:**
```bash
npm run dev
```

**Build for production:**
```bash
npm run build
```

**Run tests:**
```bash
npm test
```

## Security Notes

⚠️ **IMPORTANT:**
- Never commit `.env` with secrets
- Never share your service role key
- Service role key bypasses RLS policies - use with caution
- Anon key is safe to use in client-side code
