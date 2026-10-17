import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

type ManagedRole = "student" | "school_admin";
type Action = "list" | "invite" | "scope_update" | "disable" | "enable";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const appUrl = Deno.env.get("APP_URL") ?? "https://nursealthea.com";
const adminClient = createClient(supabaseUrl, serviceRoleKey);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const cleanEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();

const safeUser = (user: User | undefined) => user ? {
  id: user.id,
  email: user.email,
  emailConfirmedAt: user.email_confirmed_at,
  lastSignInAt: user.last_sign_in_at,
  createdAt: user.created_at,
  bannedUntil: user.banned_until,
} : null;

const isManagedRole = (value: unknown): value is ManagedRole => value === "student" || value === "school_admin";

async function requireSuperadmin(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: json({ error: "Authentication required", code: "AUTH_REQUIRED" }, 401) };
  const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: userError } = await authClient.auth.getUser(token);
  if (userError || !user) return { error: json({ error: "Authentication required", code: "AUTH_INVALID" }, 401) };
  const { data: profile, error: profileError } = await adminClient
    .from("profiles").select("id, role").eq("id", user.id).maybeSingle();
  if (profileError || profile?.role !== "super_admin") {
    return { error: json({ error: "Superadmin access required", code: "SUPERADMIN_REQUIRED" }, 403) };
  }
  return { actor: user };
}

async function listAllAuthUsers() {
  const users: User[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
}

async function audit(actorId: string, targetId: string | null, email: string, action: string, schoolId: string | null, role: string | null, beforeState: unknown, afterState: unknown) {
  const { error } = await adminClient.from("admin_user_audit").insert({
    actor_user_id: actorId, target_user_id: targetId, email, action, school_id: schoolId, role,
    before_state: beforeState, after_state: afterState,
  });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return json({ error: "Method not allowed" }, 405);

  try {
    const auth = await requireSuperadmin(req);
    if ("error" in auth) return auth.error;
    const body = req.method === "POST" ? await req.json() : { action: "list" };
    const action = (body.action ?? "list") as Action;

    if (action === "list") {
      const [users, profilesResult, schoolsResult, auditResult] = await Promise.all([
        listAllAuthUsers(),
        adminClient.from("profiles").select("id, email, full_name, role, school_id, created_at, updated_at"),
        adminClient.from("schools").select("id, name, slug").order("name"),
        adminClient.from("admin_user_audit").select("id, actor_user_id, target_user_id, email, action, school_id, role, before_state, after_state, created_at").order("created_at", { ascending: false }).limit(200),
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (schoolsResult.error) throw schoolsResult.error;
      if (auditResult.error) throw auditResult.error;
      const profileMap = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
      return json({
        users: users.map((user) => ({ auth: safeUser(user), profile: profileMap.get(user.id) ?? null })),
        schools: schoolsResult.data ?? [],
        audit: auditResult.data ?? [],
      });
    }

    if (action === "invite") {
      const email = cleanEmail(body.email);
      const fullName = String(body.full_name ?? "").trim();
      const role = body.role as ManagedRole;
      const schoolId = body.school_id ? String(body.school_id) : null;
      if (!email || !/^\S+@\S+\.\S+$/.test(email) || !fullName || !isManagedRole(role) || !schoolId) {
        return json({ error: "Email, full name, school, and supported role are required", code: "INVALID_INVITE" }, 400);
      }
      const { data: school, error: schoolError } = await adminClient.from("schools").select("id, name").eq("id", schoolId).maybeSingle();
      if (schoolError) throw schoolError;
      if (!school) return json({ error: "Selected school does not exist", code: "SCHOOL_NOT_FOUND" }, 400);
      const users = await listAllAuthUsers();
      const { data: matchingProfiles, error: profileLookupError } = await adminClient.from("profiles").select("id").ilike("email", email).limit(1);
      if (profileLookupError) throw profileLookupError;
      if (users.some((user) => cleanEmail(user.email) === email) || matchingProfiles?.length) return json({ error: "An account with this email already exists", code: "DUPLICATE_EMAIL" }, 409);

      const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, invited_role: role, invited_school_id: schoolId },
        redirectTo: `${appUrl}/reset-password`,
      });
      if (inviteError || !invited.user) throw inviteError ?? new Error("Invite did not create a user");
      const profile = {
        id: invited.user.id, email, full_name: fullName, study_year: 1, specialization_interest: "QA administration",
        phone_number: null, sms_consent: false, is_admin: role === "school_admin", role, school_id: schoolId,
      };
      const { error: profileError } = await adminClient.from("profiles").insert(profile);
      if (profileError) {
        await adminClient.auth.admin.deleteUser(invited.user.id);
        throw profileError;
      }
      await audit(auth.actor.id, invited.user.id, email, "invite", schoolId, role, null, { ...profile, id: invited.user.id });
      return json({ user: { auth: safeUser(invited.user), profile }, message: "Invitation sent; no password was created or displayed." });
    }

    const targetId = String(body.user_id ?? "");
    if (!targetId) return json({ error: "user_id is required", code: "USER_REQUIRED" }, 400);
    if (targetId === auth.actor.id) return json({ error: "You cannot change or disable your own account", code: "SELF_CHANGE_FORBIDDEN" }, 400);
    const { data: targetProfile, error: targetError } = await adminClient.from("profiles").select("id, email, full_name, role, school_id, is_admin").eq("id", targetId).maybeSingle();
    if (targetError) throw targetError;
    if (!targetProfile) return json({ error: "Profile not found", code: "PROFILE_NOT_FOUND" }, 404);
    if (targetProfile.role === "super_admin") return json({ error: "Superadmin accounts cannot be changed here", code: "SUPERADMIN_PROTECTED" }, 403);
    const before = { ...targetProfile };

    if (action === "scope_update") {
      const role = body.role as ManagedRole;
      const schoolId = body.school_id ? String(body.school_id) : null;
      if (!isManagedRole(role) || !schoolId) return json({ error: "Supported role and school are required", code: "INVALID_SCOPE" }, 400);
      const { data: school, error: schoolError } = await adminClient.from("schools").select("id").eq("id", schoolId).maybeSingle();
      if (schoolError) throw schoolError;
      if (!school) return json({ error: "Selected school does not exist", code: "SCHOOL_NOT_FOUND" }, 400);
      const after = { role, school_id: schoolId, is_admin: role === "school_admin" };
      const { error } = await adminClient.from("profiles").update(after).eq("id", targetId);
      if (error) throw error;
      await audit(auth.actor.id, targetId, targetProfile.email, "scope_update", schoolId, role, before, after);
      return json({ message: "Scope updated", profile: { ...targetProfile, ...after } });
    }

    if (action === "disable" || action === "enable") {
      const banDuration = action === "disable" ? "876000h" : "none";
      const { data: updatedAuth, error: authError } = await adminClient.auth.admin.updateUserById(targetId, { ban_duration: banDuration });
      if (authError) throw authError;
      if (action === "disable") await adminClient.auth.admin.signOut(targetId, "global");
      await audit(auth.actor.id, targetId, targetProfile.email, action, targetProfile.school_id, targetProfile.role, before, { banned_until: updatedAuth.user?.banned_until ?? null });
      return json({ message: action === "disable" ? "Account disabled and sessions revoked" : "Account enabled", auth: safeUser(updatedAuth.user) });
    }

    return json({ error: "Unsupported action", code: "ACTION_UNSUPPORTED" }, 400);
  } catch (error) {
    console.error("admin-user-management failed", error);
    return json({ error: error instanceof Error ? error.message : "Admin user operation failed", code: "ADMIN_USER_OPERATION_FAILED" }, 500);
  }
});
