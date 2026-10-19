export type ConsultantRequestClaimRow = { id: string };

export const resolveFailedConsultantRequestClaim = <T extends ConsultantRequestClaimRow>(rows: readonly T[]) => {
  if (rows.length === 1) return { claimed: true as const, row: rows[0] };
  if (rows.length === 0) return { claimed: false as const, row: null };
  throw new Error('Failed consultant request claim returned more than one row');
};
