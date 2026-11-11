import { CONSULTANT_DIRECTORY, LEGACY_CONSULTANT_DIRECTORY, CONSULTANT_DIRECTORY_BY_ID } from './consultant-directory.ts';
Deno.test('every portal service resolves to backend routing with its canonical audience', () => {
  if (CONSULTANT_DIRECTORY_BY_ID.size !== CONSULTANT_DIRECTORY.length + LEGACY_CONSULTANT_DIRECTORY.length) throw new Error('Duplicate service IDs');
  for (const service of CONSULTANT_DIRECTORY) {
    if (CONSULTANT_DIRECTORY_BY_ID.get(service.id)?.audience !== service.audience) throw new Error(service.id);
  }
  for (const id of ['adult-medicine-hospitalist', 'pediatric-emergency-medicine', 'pediatric-hepatology']) {
    if (!CONSULTANT_DIRECTORY_BY_ID.has(id)) throw new Error(`Missing portal service ${id}`);
  }
});
