// Verify all patients have weights and check BMI ranges
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://lvpbwtfvairspufrashl.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2cGJ3dGZ2YWlyc3B1ZnJhc2hsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODY0NTQxOCwiZXhwIjoyMDU0MjIxNDE4fQ._BTVbm34aB3G_fFAKHvXSGvfEcJsoRNmpTzDJC8dORg';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const calculateAge = (dob) => {
  const today = new Date();
  const birthDate = new Date(dob);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
};

console.log('Fetching all patients...\n');

const { data: patients, error } = await supabase
  .from('patients')
  .select('id, first_name, last_name, date_of_birth, gender, weight_kg')
  .is('deleted_at', null);

if (error) {
  console.error('Error:', error);
  process.exit(1);
}

console.log(`Total patients: ${patients.length}\n`);

let missingWeights = 0;
let adultBMIs = [];
let childWeights = [];

for (const patient of patients) {
  const age = calculateAge(patient.date_of_birth);
  
  if (!patient.weight_kg) {
    console.log(`⚠️  ${patient.last_name}, ${patient.first_name} (age ${age}): MISSING WEIGHT`);
    missingWeights++;
    continue;
  }
  
  if (age >= 18) {
    // Calculate BMI for adults
    const avgHeightM = patient.gender === 'Male' ? 1.75 : 1.62;
    const bmi = patient.weight_kg / (avgHeightM * avgHeightM);
    adultBMIs.push({ name: `${patient.last_name}, ${patient.first_name}`, age, bmi, weight: patient.weight_kg });
  } else {
    childWeights.push({ name: `${patient.last_name}, ${patient.first_name}`, age, weight: patient.weight_kg });
  }
}

console.log('\n=== ADULT BMIs (Target: 25-35) ===');
adultBMIs.forEach(p => {
  const status = p.bmi >= 25 && p.bmi <= 35 ? '✓' : '✗';
  console.log(`${status} ${p.name} (age ${p.age}): BMI ${p.bmi.toFixed(1)} (${p.weight}kg)`);
});

console.log(`\nAdult BMI range: ${Math.min(...adultBMIs.map(p => p.bmi)).toFixed(1)} - ${Math.max(...adultBMIs.map(p => p.bmi)).toFixed(1)}`);

console.log('\n=== CHILD WEIGHTS ===');
childWeights.forEach(p => {
  console.log(`✓ ${p.name} (age ${p.age}): ${p.weight}kg`);
});

console.log(`\n=== SUMMARY ===`);
console.log(`Total patients: ${patients.length}`);
console.log(`Missing weights: ${missingWeights}`);
console.log(`Adults with BMI 25-35: ${adultBMIs.filter(p => p.bmi >= 25 && p.bmi <= 35).length}/${adultBMIs.length}`);
