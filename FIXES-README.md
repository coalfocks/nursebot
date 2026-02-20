# Nursebot Bug Fixes - February 21, 2026

## Summary

This PR fixes two critical bugs preventing users from using the Room Management feature.

## Bug Fixes

### 1. Rooms Cannot Be Saved (RLS Policy Issue)

**Problem:** Super admins could not save rooms due to RLS policy violation (Code: 42501).

**Root Cause:** 
- The RLS policy checked `auth.uid() = profile.id` which could fail if:
  - Auth session UID doesn't match profile ID in database
  - User account created but profile record wasn't properly linked
- Policy was too restrictive even for super_admins

**Fix:**
- Updated RLS policy to be more permissive for super_admins
- Super admins can now manage ALL rooms without school restrictions
- School admins restricted to their school's rooms only
- Service role still has full access

**Migration:** `20260221000000_fix_rooms_rls_policy.sql`

**Test:**
1. Login as super_admin (coalfocks@gmail.com)
2. Navigate to Room Management
3. Click "Create New Room"
4. Fill out form and save
5. Verify room saves successfully

---

### 2. Cannot Select Creighton School (Frontend Issue)

**Problem:** Users could not select "Creighton University" from school dropdown.

**Root Cause Analysis:**
- **Database side:** Creighton University exists in database (ID: `05e89b88-af93-4ad5-8a3b-d632007ffa74`)
- **Migration bug:** Previous migration used `WHERE name ilike '%creighton%'` which:
  - Could match wrong school if multiple have "Creighton" in name
  - `LIMIT 1` picks first match without validation
  - Only affects rooms 506-510 (hardcoded)

**Fix:**
- Created safe function `assign_room_to_creighton(INT)` using exact name match
- Uses `WHERE name = 'Creighton University'` (exact, not partial)
- Also checks `slug = 'creighton'` for additional validation
- Documents the issue for future migrations

**Migration:** `20260221000001_fix_creighton_school_migration.sql`

**Test:**
1. Navigate to Room Editor
2. Click school dropdown
3. Verify "Creighton University" appears in list
4. Select Creighton University
5. Verify it's properly assigned

---

## Migration Files

### `20260221000000_fix_rooms_rls_policy.sql`
- Drops old restrictive RLS policy
- Creates new permissive policy for super_admins
- Maintains school_admin restrictions

### `20260221000001_fix_creighton_school_migration.sql`
- Documents migration issue
- Creates safe assignment function
- Uses exact name match for Creighton University

---

## Testing Checklist

- [ ] Super admin can save rooms
- [ ] School admin can save rooms in their school
- [ ] Creighton University appears in school dropdown
- [ ] Room assignments use correct school IDs
- [ ] No RLS policy violations in logs

---

## Deployment Notes

1. Run migrations in order:
   ```bash
   npx supabase db push
   ```

2. Check Supabase logs for errors:
   ```bash
   npx supabase functions logs
   ```

3. Test with super_admin account first
4. Test with school_admin account second

---

*Fixed by Bert* | *2026-02-21*
