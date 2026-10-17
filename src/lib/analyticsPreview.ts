export const isSyntheticAnalyticsPreview = (): boolean =>
  typeof window !== 'undefined'
  && import.meta.env.VITE_ANALYTICS_SYNTHETIC_FIXTURE === 'true'
  && window.location.hostname.endsWith('.netlify.app');
