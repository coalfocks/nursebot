import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

export type School = Pick<Database['public']['Tables']['schools']['Row'], 'id' | 'name' | 'display_name' | 'slug' | 'timezone' | 'enabled_programs'>;

export const getSchoolDisplayName = (school: Pick<School, 'name' | 'display_name'>) =>
  school.display_name?.trim() || school.name;

export function useSchools() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: queryError } = await supabase
          .from('schools')
          .select('id, name, display_name, slug, timezone, enabled_programs')
          .order('display_name');

        if (queryError) throw queryError;

        if (isMounted) {
          setSchools(data ?? []);
        }
      } catch (err) {
        console.error('Failed to load schools', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unable to load schools');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  return { schools, loading, error };
}
