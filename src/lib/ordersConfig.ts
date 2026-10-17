export type OrdersConfigValue = Record<string, unknown>;

export type OrdersConfigReadiness = {
  valid: boolean;
  kind: 'legacy' | 'modern' | 'missing' | 'invalid';
  message: string;
};

const LEGACY_KEYS = ['labs'] as const;
const MODERN_KEYS = ['admissionOrders', 'gatedResults', 'imaging'] as const;

const isRecord = (value: unknown): value is OrdersConfigValue =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: OrdersConfigValue, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Validate the two persisted orders-config formats without rewriting either.
 * The modern Case Builder package intentionally has no `labs` key; unknown
 * fields are retained by callers when they update a room.
 */
export const assessOrdersConfig = (value: unknown): OrdersConfigReadiness => {
  if (value == null) {
    return { valid: false, kind: 'missing', message: 'Orders configuration is missing.' };
  }
  if (!isRecord(value)) {
    return { valid: false, kind: 'invalid', message: 'Orders configuration must be an object.' };
  }

  if (hasOwn(value, 'labs')) {
    if (!Array.isArray(value.labs)) {
      return { valid: false, kind: 'invalid', message: 'Legacy labs must be an array.' };
    }
    if (value.labs.length === 0) {
      return { valid: false, kind: 'legacy', message: 'Legacy labs is present but empty.' };
    }
    return { valid: true, kind: 'legacy', message: 'Legacy lab configuration is ready.' };
  }

  const modernKeys = MODERN_KEYS.filter((key) => hasOwn(value, key));
  if (modernKeys.length === 0) {
    return {
      valid: false,
      kind: 'invalid',
      message: 'Add admission orders, gated results, or imaging to the authored package.',
    };
  }

  const malformedKey = modernKeys.find((key) => !Array.isArray(value[key]));
  if (malformedKey) {
    return { valid: false, kind: 'invalid', message: `${malformedKey} must be an array.` };
  }

  return { valid: true, kind: 'modern', message: 'Modern authored orders package is ready.' };
};

export const isAssignableOrdersConfig = (value: unknown) => assessOrdersConfig(value).valid;

/** Keep every authored/unknown key; only provide defaults when no config exists. */
export const preserveOrdersConfig = <T extends OrdersConfigValue>(value: T): T => ({ ...value });

export const modernOrdersConfigKeys = MODERN_KEYS;
export const legacyOrdersConfigKeys = LEGACY_KEYS;
