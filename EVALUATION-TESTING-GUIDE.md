# Nursebot Evaluation Tool - Testing Guide

**Setup Date:** March 3, 2026
**Purpose:** Test Connor Yost's Likert-scale evaluation scoring system

---

## 📋 What Was Built

### 1. Database Migration
**File:** `supabase/migrations/20260303000001_add_evaluation_scoring.sql`

**New Columns in `student_room_assignments`:**
- `communication_score` (DECIMAL) - Final score 0-5
- `mdm_score` (DECIMAL) - Final score 0-5
- `communication_breakdown` (JSONB) - Detailed breakdown of:
  - Information Sharing (0-2)
  - Responsive Communication (0-3)
  - Efficiency Deduction (-2 to 0)
- `mdm_breakdown` (JSONB) - Detailed breakdown of:
  - Labs/Orders Quality (0-3)
  - Note Thought Process (0-2)
  - Safety Deduction (-2 to 0)
- `learning_objectives` (TEXT) - Summary of what student missed/got right
- `case_difficulty` (VARCHAR) - easy/intermediate/advanced

### 2. Frontend Component
**File:** `src/components/EvaluationDisplay.tsx`

**Features:**
- Visual score badges with color coding (green/blue/yellow/red)
- Expandable sections for Communication and MDM breakdowns
- Raw score calculation display (e.g., "Raw: 3.5 → Final: 3.5/5")
- Learning objectives display
- Case difficulty indicator

### 3. Backend Function
**File:** `supabase/functions/generate-feedback/index.ts`

**Already Updated:** The function was already modified to use Connor's rubric and populate the new scoring columns.

---

## 🧪 Testing Steps

### Step 1: Apply the Migration

```bash
cd ~/clawd/nursebot

# Option A: Via Supabase CLI (requires login)
npx supabase login
npx supabase link --project-ref lvpbwtfvairspufrashl
npx supabase db push

# Option B: Via Supabase Dashboard
# 1. Go to https://supabase.com/dashboard
# 2. Select project: lvpbwtfvairspufrashl
# 3. Go to SQL Editor
# 4. Paste the contents of: supabase/migrations/20260303000001_add_evaluation_scoring.sql
# 5. Click Run
```

### Step 2: Verify Migration Applied

Run the test script:
```bash
cd ~/clawd/nursebot
node test-evaluation.mjs
```

**Expected Output:**
```
🧪 Testing Evaluation Scoring System

1️⃣ Checking if evaluation columns exist...
✅ Evaluation columns exist in database

2️⃣ Finding a completed assignment...
✅ Found X completed assignments
   Test assignment ID: [uuid]
   Feedback status: [pending/completed/failed]

3️⃣ Checking generate-feedback function...
✅ Function invoked successfully

4️⃣ Verifying evaluation was saved...
✅ Evaluation saved successfully!
   Communication Score: 3.5
   MDM Score: 4.2
   Learning Objectives: [summary]

✅ ALL TESTS PASSED! Evaluation system is working.
```

### Step 3: Test via UI (Manual Testing)

1. **Start the dev server:**
   ```bash
   cd ~/clawd/nursebot
   npm run dev
   ```

2. **Log in as a test user:**
   - Use existing test account credentials
   - Navigate to a completed assignment

3. **Verify EvaluationDisplay component:**
   - Should show two main scores: Communication (0-5) and MDM (0-5)
   - Click "Communication Score" to expand breakdown
   - Verify you see:
     - Information Sharing (0/2)
     - Responsive Communication (0/3)
     - Efficiency Deduction (0/0)
   - Click "Medical Decision Making" to expand
   - Verify you see:
     - Labs/Orders Quality (0/3)
     - Note Thought Process (0/2)
     - Safety Deduction (0/0)
   - Learning objectives should appear at top
   - Case difficulty should show (easy/intermediate/advanced)

### Step 4: Test Edge Cases

**Test with assignment that has no transcript:**
- Find an assignment with `student_progress_note` but no chat messages
- Run generate-feedback
- Should still populate MDM scores but Communication might be low

**Test with assignment that has no orders:**
- Find an assignment with chat messages but no medical orders
- Run generate-feedback
- Should populate Communication but MDM Labs/Orders might be 0

**Test safety deduction:**
- The rubric includes safety deductions for unsafe orders
- Should see negative scores (-1 or -2) in appropriate cases

---

## 🔍 Troubleshooting

### Migration Fails
**Error:** "column already exists"
**Fix:** Migration uses `IF NOT EXISTS`, should be safe to re-run

### Function Returns Error
**Check logs:**
```bash
cd ~/clawd/nursebot
npx supabase functions logs generate-feedback
```

**Common issues:**
- OpenAI API key not set in Supabase
- Assignment not in 'completed' or 'bedside' status
- No patient data linked to room

### Scores Not Displaying
**Check database directly:**
```sql
SELECT id, communication_score, mdm_score, communication_breakdown, mdm_breakdown
FROM student_room_assignments
WHERE id = '[assignment-id]';
```

**If scores are NULL:**
- Function may have failed silently
- Check feedback_status column
- Check feedback_error column

### UI Not Showing New Component
**Check imports:**
- EvaluationDisplay should be imported in the feedback page
- May need to add alongside existing AssignmentFeedback component

---

## 📊 Scoring Formula Reference

**Communication Score (0-5):**
```
Raw = Information Sharing (0-2) + Responsive Communication (0-3) + Efficiency Deduction (-2 to 0)
Final = clamp(Raw, 0, 5)
```

**MDM Score (0-5):**
```
Raw = Labs/Orders Quality (0-3) + Note Thought Process (0-2) + Safety Deduction (-2 to 0)
Final = clamp(Raw, 0, 5)
```

---

## ✅ Success Criteria

- [ ] Migration applied successfully
- [ ] Test script passes all checks
- [ ] EvaluationDisplay renders in UI
- [ ] Scores populate correctly (0-5 range)
- [ ] Breakdowns show individual components
- [ ] Learning objectives display
- [ ] Case difficulty shows
- [ ] Connor can see the evaluation tomorrow

---

## 🚀 Next Steps (Optional)

1. **Add to main feedback page:** Integrate EvaluationDisplay alongside or replacing AssignmentFeedback
2. **Export to PDF:** Allow instructors to export evaluations
3. **Historical tracking:** Track evaluation scores over time per student
4. **Admin dashboard:** Aggregate scores across all students

---

**Need help?** Check the code:
- Component: `src/components/EvaluationDisplay.tsx`
- Function: `supabase/functions/generate-feedback/index.ts`
- Scoring rubric: `supabase/functions/_shared/evaluation-prompts.ts`
