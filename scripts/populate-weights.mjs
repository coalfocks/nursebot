// Populate weight_kg for all patients
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lvpbwtfvairspufrashl.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc3B1ZnJhc2hsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODY0NTQxOCwiZXhwIjoyMDU0MjIxNDE4fQ._BTVbm34aB3G_fFAKHvXSGvfEcJsoRNmpTzDJC8dORg';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function generateWeight(age, sex) {
  const isMale = sex.toLowerCase() === 'male' || sex.toLowerCase() === 'm';

  if (age >= 18) {
    const avgHeightM = isMale ? 1.75 : 1.62;
    const bmi = 25 + Math.random() * 10;
    const weight = bmi * (avgHeightM * avgHeightM);
    const variance = 0.95 + Math.random() * 0.1;
    return Math.round(weight * variance * 10) / 10;
  }

  const weightChart = {
    '0_male': [3.3, 4.4], '1_male': [9.6, 11.2], '2_male': [12.2, 14.5],
    '3_male': [14.3, 17.3], '4_male': [16.3, 20.0], '5_male': [18.3, 23.0],
    '6_male': [20.5, 26.5], '7_male': [22.9, 30.5], '8_male': [25.6, 35.0],
    '9_male': [28.5, 40.0], '10_male': [31.9, 45.5], '11_male': [35.6, 52.0],
    '12_male': [39.9, 59.0], '13_male': [44.5, 66.5], '14_male': [49.5, 74.0],
    '15_male': [54.5, 80.5], '16_male': [59.2, 85.5], '17_male': [63.4, 89.5],
    '0_female': [3.2, 4.2], '1_female': [8.9, 10.5], '2_female': [11.5, 13.9],
    '3_female': [13.9, 17.2], '4_female': [16.1, 20.3], '5_female': [18.2, 23.5],
    '6_female': [20.4, 27.0], '7_female': [22.8, 31.0], '8_female': [25.6, 35.5],
    '9_female': [28.8, 40.5], '10_female': [32.5, 46.5], '11_female': [36.8, 53.0],
    '12_female': [41.5, 59.5], '13_female': [46.2, 65.5], '14_female': [50.0, 70.5],
    '15_female': [52.9, 74.0], '16_female': [55.0, 76.5], '17_female': [56.5, 78.5],
  };

  const clampedAge = Math.min(17, Math.max(0, age));
  const key = `${clampedAge}_${isMale ? 'male' : 'female'}`;
  const [p50, p90] = weightChart[key] || [30, 50];
  const weight = p50 + Math.random() * (p90 - p50);
  return Math.round(weight * 10) / 10;
}

const calculateAge = (dob) => {
  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
};

console.log('Fetching patients...');
const { data: patients, error } = await supabase
  .from('patients')
  .select('id, date_of_birth, gender')
  .is('deleted_at', null);

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

console.log(`Found ${patients.length} patients. Updating weights...`);

let updated = 0;
for (const patient of patients) {
  const age = calculateAge(patient.date_of_birth);
  const weightKg = generateWeight(age, patient.gender);

  const { error: updateError } = await supabase
    .from('patients')
    .update({ weight_kg: weightKg })
    .eq('id', patient.id);

  if (!updateError) {
    updated++;
    console.log(`✓ ${patient.id}: age=${age}, sex=${patient.gender}, weight=${weightKg}kg`);
  } else {
    console.error(`✗ ${patient.id}:`, updateError.message);
  }
}

console.log(`\n✅ Updated ${updated}/${patients.length} patients`);
