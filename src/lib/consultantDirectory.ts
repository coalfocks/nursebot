export type ConsultantAudience = 'adult' | 'pediatric';

export type ConsultantService = {
  id: string;
  label: string;
  audience: ConsultantAudience;
  aliases: string[];
};

// IDs are API data, not prompt text. Keep them stable when labels or aliases
// change; adding a service is intentionally additive.
export const CONSULTANT_DIRECTORY: ConsultantService[] = [
  { id: 'adult-attending', label: 'Attending / Hospital Medicine', audience: 'adult', aliases: ['attending', 'hospitalist', 'medicine'] },
  { id: 'adult-critical-care', label: 'Adult Critical Care / ICU', audience: 'adult', aliases: ['icu', 'critical care', 'intensive care'] },
  { id: 'adult-cardiology', label: 'Cardiology', audience: 'adult', aliases: ['heart'] },
  { id: 'adult-interventional-cardiology', label: 'Interventional Cardiology', audience: 'adult', aliases: ['cath', 'cardiac cath'] },
  { id: 'adult-pulmonology', label: 'Pulmonology', audience: 'adult', aliases: ['lung', 'respiratory'] },
  { id: 'adult-gastroenterology', label: 'Gastroenterology', audience: 'adult', aliases: ['gi', 'gastro'] },
  { id: 'adult-nephrology', label: 'Nephrology', audience: 'adult', aliases: ['kidney', 'renal'] },
  { id: 'adult-infectious-disease', label: 'Infectious Disease', audience: 'adult', aliases: ['id', 'infection'] },
  { id: 'adult-endocrinology', label: 'Endocrinology', audience: 'adult', aliases: ['diabetes', 'metabolism'] },
  { id: 'adult-neurology', label: 'Neurology', audience: 'adult', aliases: ['neuro'] },
  { id: 'adult-hematology-oncology', label: 'Hematology / Oncology', audience: 'adult', aliases: ['heme', 'oncology', 'cancer'] },
  { id: 'adult-rheumatology', label: 'Rheumatology', audience: 'adult', aliases: ['rheum', 'autoimmune'] },
  { id: 'adult-general-surgery', label: 'General Surgery', audience: 'adult', aliases: ['surgery'] },
  { id: 'adult-colorectal-surgery', label: 'Colorectal Surgery', audience: 'adult', aliases: ['colorectal', 'colon'] },
  { id: 'adult-neurosurgery', label: 'Neurosurgery', audience: 'adult', aliases: ['neuro surgery'] },
  { id: 'adult-orthopedic-surgery', label: 'Orthopedic Surgery', audience: 'adult', aliases: ['orthopedics', 'ortho'] },
  { id: 'adult-vascular-surgery', label: 'Vascular Surgery', audience: 'adult', aliases: ['vascular'] },
  { id: 'adult-cardiothoracic-surgery', label: 'Cardiothoracic Surgery', audience: 'adult', aliases: ['ct surgery', 'cardiothoracic'] },
  { id: 'adult-trauma-surgery', label: 'Trauma Surgery', audience: 'adult', aliases: ['trauma'] },
  { id: 'adult-urology', label: 'Urology', audience: 'adult', aliases: ['uro'] },
  { id: 'adult-otolaryngology', label: 'Otolaryngology (ENT)', audience: 'adult', aliases: ['ent', 'ear nose throat'] },
  { id: 'adult-ophthalmology', label: 'Ophthalmology', audience: 'adult', aliases: ['eye'] },
  { id: 'adult-psychiatry', label: 'Psychiatry', audience: 'adult', aliases: ['behavioral health'] },
  { id: 'adult-anesthesia-pain', label: 'Anesthesiology / Pain', audience: 'adult', aliases: ['anesthesia', 'pain'] },
  { id: 'adult-ob-gyn', label: 'OB/GYN', audience: 'adult', aliases: ['obgyn', 'ob gyn'] },
  { id: 'adult-mfm', label: 'Maternal-Fetal Medicine', audience: 'adult', aliases: ['mfm', 'high risk obstetrics'] },
  { id: 'adult-palliative-care', label: 'Palliative Care', audience: 'adult', aliases: ['palliative'] },
  { id: 'adult-radiology', label: 'Radiology', audience: 'adult', aliases: ['imaging'] },
  { id: 'adult-interventional-radiology', label: 'Interventional Radiology', audience: 'adult', aliases: ['ir'] },
  { id: 'adult-transfusion-medicine', label: 'Transfusion Medicine', audience: 'adult', aliases: ['blood bank'] },
  { id: 'pediatric-hospital-medicine', label: 'Pediatric Hospital Medicine', audience: 'pediatric', aliases: ['pediatrics', 'peds hospitalist'] },
  { id: 'pediatric-critical-care', label: 'Pediatric Critical Care / PICU', audience: 'pediatric', aliases: ['picu', 'pediatric icu'] },
  { id: 'pediatric-neonatology', label: 'Neonatology / NICU', audience: 'pediatric', aliases: ['nicu', 'neonatal'] },
  { id: 'pediatric-cardiology', label: 'Pediatric Cardiology', audience: 'pediatric', aliases: ['peds cardiology'] },
  { id: 'pediatric-pulmonology', label: 'Pediatric Pulmonology', audience: 'pediatric', aliases: ['peds pulmonary'] },
  { id: 'pediatric-gastroenterology', label: 'Pediatric Gastroenterology / GI', audience: 'pediatric', aliases: ['peds gi', 'pediatric gastro'] },
  { id: 'pediatric-nephrology', label: 'Pediatric Nephrology', audience: 'pediatric', aliases: ['peds kidney'] },
  { id: 'pediatric-infectious-disease', label: 'Pediatric Infectious Disease', audience: 'pediatric', aliases: ['peds id'] },
  { id: 'pediatric-endocrinology', label: 'Pediatric Endocrinology', audience: 'pediatric', aliases: ['peds endocrine'] },
  { id: 'pediatric-neurology', label: 'Pediatric Neurology', audience: 'pediatric', aliases: ['peds neuro'] },
  { id: 'pediatric-hematology-oncology', label: 'Pediatric Hematology / Oncology', audience: 'pediatric', aliases: ['pediatric oncology', 'peds heme onc'] },
  { id: 'pediatric-rheumatology', label: 'Pediatric Rheumatology', audience: 'pediatric', aliases: ['peds rheum'] },
  { id: 'pediatric-general-surgery', label: 'Pediatric General Surgery', audience: 'pediatric', aliases: ['peds surgery'] },
  { id: 'pediatric-colorectal-surgery', label: 'Pediatric Colorectal Surgery', audience: 'pediatric', aliases: ['peds colorectal'] },
  { id: 'pediatric-neurosurgery', label: 'Pediatric Neurosurgery', audience: 'pediatric', aliases: ['peds neurosurgery'] },
  { id: 'pediatric-orthopedic-surgery', label: 'Pediatric Orthopedic Surgery', audience: 'pediatric', aliases: ['peds ortho'] },
  { id: 'pediatric-urology', label: 'Pediatric Urology', audience: 'pediatric', aliases: ['peds uro'] },
  { id: 'pediatric-otolaryngology', label: 'Pediatric ENT', audience: 'pediatric', aliases: ['peds ent'] },
  { id: 'pediatric-ophthalmology', label: 'Pediatric Ophthalmology', audience: 'pediatric', aliases: ['peds eye'] },
  { id: 'pediatric-psychiatry', label: 'Child and Adolescent Psychiatry', audience: 'pediatric', aliases: ['child psych', 'peds psychiatry'] },
  { id: 'pediatric-anesthesia-pain', label: 'Pediatric Anesthesiology / Pain', audience: 'pediatric', aliases: ['peds anesthesia'] },
  { id: 'pediatric-palliative-care', label: 'Pediatric Palliative Care', audience: 'pediatric', aliases: ['peds palliative'] },
  { id: 'pediatric-radiology', label: 'Pediatric Radiology', audience: 'pediatric', aliases: ['peds imaging'] },
  { id: 'pediatric-interventional-radiology', label: 'Pediatric Interventional Radiology', audience: 'pediatric', aliases: ['peds ir'] },
  { id: 'pediatric-transfusion-medicine', label: 'Pediatric Transfusion Medicine', audience: 'pediatric', aliases: ['peds blood bank'] },
];

export const CONSULTANT_DIRECTORY_BY_ID = new Map(CONSULTANT_DIRECTORY.map((service) => [service.id, service]));

export function searchConsultants(audience: ConsultantAudience | '', search: string): ConsultantService[] {
  const needle = search.trim().toLowerCase();
  return CONSULTANT_DIRECTORY.filter((service) => (!audience || service.audience === audience) && (!needle || [service.id, service.label, ...service.aliases].some((value) => value.toLowerCase().includes(needle))));
}
