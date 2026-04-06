import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface WeightRequest {
  age: number;
  sex: 'male' | 'female' | 'M' | 'F';
}

/**
 * Generate a realistic weight in kg based on age and sex.
 *
 * Adults (18+): BMI 25-35 (moderate to obese)
 * Children (0-17): 50th-90th percentile for age
 */
function generateWeight(age: number, sex: 'male' | 'female'): number {
  const normalizedSex = sex.toLowerCase() === 'm' ? 'male' : 'female';
  const isMale = normalizedSex === 'male';

  if (age >= 18) {
    // Adults: Target BMI 25-35 (moderate to obese)
    // Estimate height based on sex
    const avgHeightM = isMale ? 1.75 : 1.62;

    // Random BMI between 25 and 35
    const bmi = 25 + Math.random() * 10;

    // Weight = BMI * height²
    const weight = bmi * (avgHeightM * avgHeightM);

    // Add some variance (±5%)
    const variance = 0.95 + Math.random() * 0.1;
    return Math.round(weight * variance * 10) / 10;
  } else {
    // Children: Use CDC growth chart percentiles (50th-90th)
    // Approximated weight ranges by age and sex
    const weightChart: Record<string, [number, number]> = {
      // Age 0-17: [50th percentile, 90th percentile] in kg
      '0_male': [3.3, 4.4],
      '1_male': [9.6, 11.2],
      '2_male': [12.2, 14.5],
      '3_male': [14.3, 17.3],
      '4_male': [16.3, 20.0],
      '5_male': [18.3, 23.0],
      '6_male': [20.5, 26.5],
      '7_male': [22.9, 30.5],
      '8_male': [25.6, 35.0],
      '9_male': [28.5, 40.0],
      '10_male': [31.9, 45.5],
      '11_male': [35.6, 52.0],
      '12_male': [39.9, 59.0],
      '13_male': [44.5, 66.5],
      '14_male': [49.5, 74.0],
      '15_male': [54.5, 80.5],
      '16_male': [59.2, 85.5],
      '17_male': [63.4, 89.5],
      '0_female': [3.2, 4.2],
      '1_female': [8.9, 10.5],
      '2_female': [11.5, 13.9],
      '3_female': [13.9, 17.2],
      '4_female': [16.1, 20.3],
      '5_female': [18.2, 23.5],
      '6_female': [20.4, 27.0],
      '7_female': [22.8, 31.0],
      '8_female': [25.6, 35.5],
      '9_female': [28.8, 40.5],
      '10_female': [32.5, 46.5],
      '11_female': [36.8, 53.0],
      '12_female': [41.5, 59.5],
      '13_female': [46.2, 65.5],
      '14_female': [50.0, 70.5],
      '15_female': [52.9, 74.0],
      '16_female': [55.0, 76.5],
      '17_female': [56.5, 78.5],
    };

    const clampedAge = Math.min(17, Math.max(0, age));
    const key = `${clampedAge}_${isMale ? 'male' : 'female'}`;
    const [p50, p90] = weightChart[key] || [30, 50];

    // Random weight between 50th and 90th percentile
    const weight = p50 + Math.random() * (p90 - p50);
    return Math.round(weight * 10) / 10;
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const body: WeightRequest = await req.json();
    const { age, sex } = body;

    if (typeof age !== 'number' || age < 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid age. Must be a non-negative number.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!sex || !['male', 'female', 'M', 'F', 'm', 'f'].includes(sex)) {
      return new Response(
        JSON.stringify({ error: 'Invalid sex. Must be "male", "female", "M", or "F".' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const normalizedSex = sex.toLowerCase() === 'm' ? 'male' : 'female';
    const weight = generateWeight(age, normalizedSex);

    return new Response(
      JSON.stringify({ weight_kg: weight, age, sex: normalizedSex }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Invalid request body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
