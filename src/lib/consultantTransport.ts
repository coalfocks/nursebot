export const CONSULTANT_TRANSPORT_SCHEMA_VERSION = 3;
export const CONSULTANT_TRANSPORT_FUNCTION_VERSION = 3;

type PreflightResult = {
  ready: boolean;
  reason?: string;
  schemaVersion?: number;
  functionVersion?: number;
  atomicPersistence?: boolean;
};

type SupabaseTransportClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  functions: {
    invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
};

const unavailable = (reason: string): PreflightResult => ({ ready: false, reason });

/**
 * The database RPC is the no-column-read schema probe. Only after it passes do
 * we call consultant-chat's write-compatible preflight mode. This prevents a
 * new portal from querying audience columns or sending a message to an old
 * function deployment.
 */
export async function preflightConsultantTransport(client: SupabaseTransportClient): Promise<PreflightResult> {
  const { data: schemaData, error: schemaError } = await client.rpc('consultant_transport_preflight');
  if (schemaError) return unavailable('Consultant transport schema is not ready. Please try again after the coordinated migration is available.');

  const schema = schemaData as { schemaVersion?: unknown } | null;
  if (schema?.schemaVersion !== CONSULTANT_TRANSPORT_SCHEMA_VERSION) {
    return unavailable('Consultant transport schema version is incompatible with this portal.');
  }

  const { data: functionData, error: functionError } = await client.functions.invoke('consultant-chat', {
    body: { mode: 'preflight', transportContractVersion: CONSULTANT_TRANSPORT_FUNCTION_VERSION },
  });
  if (functionError) return unavailable('Consultant service is not ready. Please try again after the coordinated function deployment is available.');

  const edge = functionData as { ready?: unknown; schemaVersion?: unknown; functionVersion?: unknown; atomicPersistence?: unknown } | null;
  if (
    edge?.ready !== true
    || edge.schemaVersion !== CONSULTANT_TRANSPORT_SCHEMA_VERSION
    || edge.functionVersion !== CONSULTANT_TRANSPORT_FUNCTION_VERSION
    || edge.atomicPersistence !== true
  ) {
    return unavailable('Consultant service version is incompatible with this portal.');
  }

  return {
    ready: true,
    schemaVersion: CONSULTANT_TRANSPORT_SCHEMA_VERSION,
    functionVersion: CONSULTANT_TRANSPORT_FUNCTION_VERSION,
    atomicPersistence: true,
  };
}
