export type ConsultantAudience = 'adult' | 'pediatric';

export type ConsultantService = {
  id: string;
  label: string;
  audience: ConsultantAudience;
  aliases: string[];
};

// Stable routing data. Labels and aliases may evolve, but IDs are never
// recycled: historical request/message rows must continue to resolve.
export const CONSULTANT_DIRECTORY: ConsultantService[] = [
  // Adult medicine and hospital services (26)
  { id: 'adult-attending', label: 'Attending / Hospital Medicine', audience: 'adult', aliases: ['attending', 'hospitalist', 'medicine'] },
  { id: 'adult-medicine-hospitalist', label: 'Medicine / Hospitalist', audience: 'adult', aliases: ['hospital medicine', 'internal medicine'] },
  { id: 'adult-emergency-medicine', label: 'Emergency Medicine', audience: 'adult', aliases: ['emergency', 'ed'] },
  { id: 'adult-cardiology', label: 'Cardiology', audience: 'adult', aliases: ['heart'] },
  { id: 'adult-interventional-cardiology', label: 'Interventional Cardiology', audience: 'adult', aliases: ['cath', 'cardiac cath'] },
  { id: 'adult-cardiac-electrophysiology', label: 'Cardiac Electrophysiology', audience: 'adult', aliases: ['electrophysiology', 'ep'] },
  { id: 'adult-endocrinology', label: 'Endocrinology', audience: 'adult', aliases: ['diabetes', 'metabolism'] },
  { id: 'adult-gastroenterology', label: 'Gastroenterology', audience: 'adult', aliases: ['gi', 'gastro'] },
  { id: 'adult-hepatology', label: 'Hepatology', audience: 'adult', aliases: ['liver'] },
  { id: 'adult-infectious-disease', label: 'Infectious Disease', audience: 'adult', aliases: ['id', 'infection'] },
  { id: 'adult-nephrology', label: 'Nephrology', audience: 'adult', aliases: ['kidney', 'renal'] },
  { id: 'adult-neurology', label: 'Neurology', audience: 'adult', aliases: ['neuro'] },
  { id: 'adult-oncology', label: 'Oncology', audience: 'adult', aliases: ['cancer', 'medical oncology'] },
  { id: 'adult-hematology', label: 'Hematology', audience: 'adult', aliases: ['heme', 'blood disorders'] },
  { id: 'adult-rheumatology', label: 'Rheumatology', audience: 'adult', aliases: ['rheum', 'autoimmune'] },
  { id: 'adult-pulmonology', label: 'Pulmonology', audience: 'adult', aliases: ['lung', 'respiratory'] },
  { id: 'adult-critical-care', label: 'Adult Critical Care / ICU', audience: 'adult', aliases: ['icu', 'critical care', 'intensive care'] },
  { id: 'adult-allergy-immunology', label: 'Allergy and Immunology', audience: 'adult', aliases: ['allergy', 'immunology'] },
  { id: 'adult-dermatology', label: 'Dermatology', audience: 'adult', aliases: ['skin'] },
  { id: 'adult-geriatric-medicine', label: 'Geriatric Medicine', audience: 'adult', aliases: ['geriatrics'] },
  { id: 'adult-palliative-care', label: 'Palliative Care', audience: 'adult', aliases: ['palliative'] },
  { id: 'adult-physical-medicine-rehabilitation', label: 'Physical Medicine and Rehabilitation', audience: 'adult', aliases: ['pm&r', 'rehab', 'physiatry'] },
  { id: 'adult-psychiatry', label: 'Psychiatry', audience: 'adult', aliases: ['behavioral health'] },
  { id: 'adult-addiction-medicine', label: 'Addiction Medicine', audience: 'adult', aliases: ['addiction'] },
  { id: 'adult-medical-toxicology', label: 'Medical Toxicology', audience: 'adult', aliases: ['toxicology', 'tox'] },
  { id: 'adult-sleep-medicine', label: 'Sleep Medicine', audience: 'adult', aliases: ['sleep'] },

  // Adult surgical services (20)
  { id: 'adult-general-surgery', label: 'General Surgery', audience: 'adult', aliases: ['surgery'] },
  { id: 'adult-colorectal-surgery', label: 'Colorectal Surgery', audience: 'adult', aliases: ['colorectal', 'colon'] },
  { id: 'adult-cardiothoracic-surgery', label: 'Cardiothoracic Surgery', audience: 'adult', aliases: ['ct surgery', 'cardiothoracic'] },
  { id: 'adult-cardiac-surgery', label: 'Cardiac Surgery', audience: 'adult', aliases: ['heart surgery'] },
  { id: 'adult-thoracic-surgery', label: 'Thoracic Surgery', audience: 'adult', aliases: ['chest surgery'] },
  { id: 'adult-vascular-surgery', label: 'Vascular Surgery', audience: 'adult', aliases: ['vascular'] },
  { id: 'adult-neurosurgery', label: 'Neurosurgery', audience: 'adult', aliases: ['neuro surgery'] },
  { id: 'adult-orthopedic-surgery', label: 'Orthopedic Surgery', audience: 'adult', aliases: ['orthopedics', 'ortho'] },
  { id: 'adult-orthopedic-spine-surgery', label: 'Orthopedic Spine Surgery', audience: 'adult', aliases: ['spine', 'ortho spine'] },
  { id: 'adult-hand-surgery', label: 'Hand Surgery', audience: 'adult', aliases: ['hand'] },
  { id: 'adult-plastic-reconstructive-surgery', label: 'Plastic and Reconstructive Surgery', audience: 'adult', aliases: ['plastics', 'reconstructive'] },
  { id: 'adult-burn-surgery', label: 'Burn Surgery', audience: 'adult', aliases: ['burn'] },
  { id: 'adult-trauma-surgery', label: 'Trauma Surgery', audience: 'adult', aliases: ['trauma', 'acute care surgery'] },
  { id: 'adult-transplant-surgery', label: 'Transplant Surgery', audience: 'adult', aliases: ['transplant'] },
  { id: 'adult-otolaryngology', label: 'Otolaryngology (ENT)', audience: 'adult', aliases: ['ent', 'ear nose throat'] },
  { id: 'adult-ophthalmology', label: 'Ophthalmology', audience: 'adult', aliases: ['eye'] },
  { id: 'adult-urology', label: 'Urology', audience: 'adult', aliases: ['uro'] },
  { id: 'adult-oral-maxillofacial-surgery', label: 'Oral and Maxillofacial Surgery', audience: 'adult', aliases: ['omfs', 'oral surgery'] },
  { id: 'adult-dentistry', label: 'Dentistry', audience: 'adult', aliases: ['dental'] },
  { id: 'adult-podiatry', label: 'Podiatry', audience: 'adult', aliases: ['foot', 'ankle'] },

  // Obstetrics and gynecology (4)
  { id: 'adult-ob-gyn', label: 'OB/GYN', audience: 'adult', aliases: ['obgyn', 'ob gyn'] },
  { id: 'adult-mfm', label: 'Maternal-Fetal Medicine', audience: 'adult', aliases: ['mfm', 'high risk obstetrics'] },
  { id: 'adult-gynecologic-oncology', label: 'Gynecologic Oncology', audience: 'adult', aliases: ['gyn onc'] },
  { id: 'adult-urogynecology', label: 'Urogynecology', audience: 'adult', aliases: ['uro gyn'] },

  // Pediatric and neonatal services (30)
  { id: 'pediatric-hospital-medicine', label: 'Pediatrics / Pediatric Hospitalist', audience: 'pediatric', aliases: ['pediatrics', 'peds', 'peds hospitalist'] },
  { id: 'pediatric-emergency-medicine', label: 'Pediatric Emergency Medicine', audience: 'pediatric', aliases: ['peds emergency', 'peds ed'] },
  { id: 'pediatric-adolescent-medicine', label: 'Adolescent Medicine', audience: 'pediatric', aliases: ['adolescent'] },
  { id: 'pediatric-cardiology', label: 'Pediatric Cardiology', audience: 'pediatric', aliases: ['peds cardiology'] },
  { id: 'pediatric-endocrinology', label: 'Pediatric Endocrinology', audience: 'pediatric', aliases: ['peds endocrine'] },
  { id: 'pediatric-gastroenterology', label: 'Pediatric Gastroenterology / GI', audience: 'pediatric', aliases: ['peds gi', 'pediatric gastro'] },
  { id: 'pediatric-hepatology', label: 'Pediatric Hepatology', audience: 'pediatric', aliases: ['peds liver'] },
  { id: 'pediatric-infectious-disease', label: 'Pediatric Infectious Disease', audience: 'pediatric', aliases: ['peds id'] },
  { id: 'pediatric-nephrology', label: 'Pediatric Nephrology', audience: 'pediatric', aliases: ['peds kidney'] },
  { id: 'pediatric-neurology', label: 'Pediatric Neurology', audience: 'pediatric', aliases: ['peds neuro'] },
  { id: 'pediatric-oncology', label: 'Pediatric Oncology', audience: 'pediatric', aliases: ['peds oncology'] },
  { id: 'pediatric-hematology', label: 'Pediatric Hematology', audience: 'pediatric', aliases: ['peds heme'] },
  { id: 'pediatric-hematology-oncology', label: 'Pediatric Hematology / Oncology', audience: 'pediatric', aliases: ['pediatric hematology-oncology', 'peds heme onc'] },
  { id: 'pediatric-rheumatology', label: 'Pediatric Rheumatology', audience: 'pediatric', aliases: ['peds rheum'] },
  { id: 'pediatric-pulmonology', label: 'Pediatric Pulmonology', audience: 'pediatric', aliases: ['peds pulmonary'] },
  { id: 'pediatric-critical-care', label: 'Pediatric Critical Care / PICU', audience: 'pediatric', aliases: ['picu', 'pediatric icu'] },
  { id: 'pediatric-allergy-immunology', label: 'Pediatric Allergy and Immunology', audience: 'pediatric', aliases: ['peds allergy', 'peds immunology'] },
  { id: 'pediatric-genetics-metabolic', label: 'Pediatric Genetics and Metabolic Medicine', audience: 'pediatric', aliases: ['peds genetics', 'metabolic'] },
  { id: 'pediatric-dermatology', label: 'Pediatric Dermatology', audience: 'pediatric', aliases: ['peds derm'] },
  { id: 'pediatric-developmental-behavioral', label: 'Developmental and Behavioral Pediatrics', audience: 'pediatric', aliases: ['developmental pediatrics', 'behavioral pediatrics'] },
  { id: 'pediatric-psychiatry', label: 'Child and Adolescent Psychiatry', audience: 'pediatric', aliases: ['child psych', 'peds psychiatry'] },
  { id: 'pediatric-general-surgery', label: 'Pediatric Surgery', audience: 'pediatric', aliases: ['peds surgery'] },
  { id: 'pediatric-cardiothoracic-surgery', label: 'Pediatric Cardiothoracic Surgery', audience: 'pediatric', aliases: ['peds ct surgery'] },
  { id: 'pediatric-neurosurgery', label: 'Pediatric Neurosurgery', audience: 'pediatric', aliases: ['peds neurosurgery'] },
  { id: 'pediatric-orthopedic-surgery', label: 'Pediatric Orthopedic Surgery', audience: 'pediatric', aliases: ['peds ortho'] },
  { id: 'pediatric-urology', label: 'Pediatric Urology', audience: 'pediatric', aliases: ['peds uro'] },
  { id: 'pediatric-otolaryngology', label: 'Pediatric ENT / Otolaryngology', audience: 'pediatric', aliases: ['peds ent'] },
  { id: 'pediatric-anesthesiology', label: 'Pediatric Anesthesiology', audience: 'pediatric', aliases: ['peds anesthesia'] },
  { id: 'pediatric-ophthalmology', label: 'Pediatric Ophthalmology', audience: 'pediatric', aliases: ['peds eye'] },
  { id: 'pediatric-neonatology', label: 'Neonatology / NICU', audience: 'pediatric', aliases: ['nicu', 'neonatal'] },

  // Other hospital consultation services (9)
  { id: 'hospital-anesthesiology', label: 'Anesthesiology', audience: 'adult', aliases: ['anesthesia'] },
  { id: 'hospital-acute-pain', label: 'Acute Pain Service', audience: 'adult', aliases: ['acute pain'] },
  { id: 'hospital-pain-medicine', label: 'Pain Medicine', audience: 'adult', aliases: ['pain'] },
  { id: 'hospital-diagnostic-radiology', label: 'Diagnostic Radiology', audience: 'adult', aliases: ['radiology', 'imaging'] },
  { id: 'hospital-interventional-radiology', label: 'Interventional Radiology', audience: 'adult', aliases: ['ir'] },
  { id: 'hospital-radiation-oncology', label: 'Radiation Oncology', audience: 'adult', aliases: ['rad onc'] },
  { id: 'hospital-pathology-laboratory-medicine', label: 'Pathology / Laboratory Medicine', audience: 'adult', aliases: ['pathology', 'lab medicine'] },
  { id: 'hospital-blood-bank-transfusion-medicine', label: 'Blood Bank / Transfusion Medicine', audience: 'adult', aliases: ['blood bank', 'transfusion'] },
  { id: 'hospital-clinical-genetics', label: 'Clinical Genetics', audience: 'adult', aliases: ['genetics'] },
];

// Legacy IDs remain valid for old request/message rows but are not duplicated
// as new choices. Their labels are retained for historical rendering.
export const LEGACY_CONSULTANT_DIRECTORY: ConsultantService[] = [
  { id: 'adult-anesthesia-pain', label: 'Anesthesiology / Pain', audience: 'adult', aliases: ['anesthesia', 'pain'] },
  { id: 'adult-radiology', label: 'Radiology', audience: 'adult', aliases: ['imaging'] },
  { id: 'adult-interventional-radiology', label: 'Interventional Radiology', audience: 'adult', aliases: ['ir'] },
  { id: 'adult-transfusion-medicine', label: 'Transfusion Medicine', audience: 'adult', aliases: ['blood bank'] },
  { id: 'pediatric-anesthesia-pain', label: 'Pediatric Anesthesiology / Pain', audience: 'pediatric', aliases: ['peds anesthesia'] },
  { id: 'adult-hematology-oncology', label: 'Hematology / Oncology', audience: 'adult', aliases: ['heme onc', 'oncology'] },
  { id: 'pediatric-transfusion-medicine', label: 'Pediatric Transfusion Medicine', audience: 'pediatric', aliases: ['peds blood bank'] },
  { id: 'pediatric-radiology', label: 'Pediatric Radiology', audience: 'pediatric', aliases: ['peds imaging'] },
  { id: 'pediatric-interventional-radiology', label: 'Pediatric Interventional Radiology', audience: 'pediatric', aliases: ['peds ir'] },
  { id: 'pediatric-palliative-care', label: 'Pediatric Palliative Care', audience: 'pediatric', aliases: ['peds palliative'] },
];

export const CONSULTANT_DIRECTORY_BY_ID = new Map([...CONSULTANT_DIRECTORY, ...LEGACY_CONSULTANT_DIRECTORY].map((service) => [service.id, service]));

export function searchConsultants(audience: ConsultantAudience | '', search: string): ConsultantService[] {
  const needle = search.trim().toLowerCase();
  return CONSULTANT_DIRECTORY.filter((service) => (!audience || service.audience === audience) && (!needle || [service.id, service.label, ...service.aliases].some((value) => value.toLowerCase().includes(needle))));
}
