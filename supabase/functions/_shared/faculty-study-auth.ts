export type FacultyStudyTokenClient = {
  auth: {
    getUser: (accessToken: string) => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
};

export const extractBearerToken = (req: Pick<Request, 'headers'>) => {
  const authorization = req.headers.get('authorization');
  if (!authorization) throw new Error('STUDY_AUTH_REQUIRED');
  const match = authorization.match(/^Bearer[ \t]+([^ \t]+)$/i);
  if (!match) throw new Error('STUDY_AUTH_INVALID');
  return match[1];
};

export const tokenClientOptions = (accessToken: string) => ({
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export const isFacultyStudySuperAdmin = (profile: { role?: unknown } | null | undefined) => profile?.role === 'super_admin';

export const authenticateFacultyStudyUser = async (
  req: Pick<Request, 'headers'>,
  createTokenClient: (options: ReturnType<typeof tokenClientOptions>) => FacultyStudyTokenClient,
) => {
  const accessToken = extractBearerToken(req);
  const tokenClient = createTokenClient(tokenClientOptions(accessToken));
  const { data: userData, error: userError } = await tokenClient.auth.getUser(accessToken);
  if (userError || !userData.user) throw new Error('STUDY_AUTH_INVALID');
  return userData.user.id;
};
