export type ChartMeasurement = {
  temperatureF?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
};

export const calculateAgeAtEncounter = (dateOfBirth: unknown, encounterDate: unknown): number | null => {
  if (typeof dateOfBirth !== 'string' || typeof encounterDate !== 'string') return null;
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  const encounter = new Date(`${encounterDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(dob.getTime()) || !Number.isFinite(encounter.getTime()) || encounter < dob) return null;
  let age = encounter.getUTCFullYear() - dob.getUTCFullYear();
  if (encounter.getUTCMonth() < dob.getUTCMonth() || (encounter.getUTCMonth() === dob.getUTCMonth() && encounter.getUTCDate() < dob.getUTCDate())) age -= 1;
  return Math.max(0, age);
};

export const validateChartMeasurements = (values: ChartMeasurement): string[] => {
  const errors: string[] = [];
  if (values.temperatureF != null && (!Number.isFinite(values.temperatureF) || values.temperatureF < 80 || values.temperatureF > 115)) errors.push('Temperature must be 80–115 °F.');
  if (values.heightCm != null && (!Number.isFinite(values.heightCm) || values.heightCm < 20 || values.heightCm > 250)) errors.push('Height must be 20–250 cm.');
  if (values.weightKg != null && (!Number.isFinite(values.weightKg) || values.weightKg <= 0 || values.weightKg > 400)) errors.push('Weight must be greater than 0 and at most 400 kg.');
  return errors;
};

export const calculateBmi = (weightKg: number | null | undefined, heightCm: number | null | undefined): number | null => {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null;
  const bmi = weightKg / ((heightCm / 100) ** 2);
  return Number.isFinite(bmi) ? Math.round(bmi * 10) / 10 : null;
};
