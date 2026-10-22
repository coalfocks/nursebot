export const buildInfo = {
  identifier:
    import.meta.env.VITE_BUILD_ID ?? import.meta.env.VITE_COMMIT_SHA ?? 'local-development',
  deploymentTimestamp: import.meta.env.VITE_DEPLOYMENT_TIMESTAMP ?? 'not provided',
};
