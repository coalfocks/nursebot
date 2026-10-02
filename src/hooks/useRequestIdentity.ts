import { useCallback, useMemo, useRef } from 'react';

export type RequestToken = {
  generation: number;
  key: string;
};

export function requestIdentityMatches(currentKey: string, currentGeneration: number, token: RequestToken) {
  return token.key === currentKey && token.generation === currentGeneration;
}

/**
 * Captures the identity of an async request and rejects responses from an
 * earlier identity, including when an identity is selected again later.
 */
export function useRequestIdentity(key: string) {
  const currentKey = useRef(key);
  const generation = useRef(0);

  if (currentKey.current !== key) {
    currentKey.current = key;
    generation.current += 1;
  }

  const capture = useCallback(
    (): RequestToken => ({ key, generation: generation.current }),
    [key],
  );
  const isCurrent = useCallback(
    (token: RequestToken) => requestIdentityMatches(currentKey.current, generation.current, token),
    [],
  );

  return useMemo(() => ({ capture, isCurrent }), [capture, isCurrent]);
}
