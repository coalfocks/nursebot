// Core EMR Types
export interface Patient {
  id: string;
  schoolId?: string | null;
  roomId?: number | null;
  mrn: string; // Medical Record Number
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female' | 'Other';
  room?: string;
  service?: string;
  admissionDate?: string;
  attendingPhysician?: string;
  allergies: string[];
  codeStatus?: 'Full Code' | 'DNR' | 'DNI' | 'DNR/DNI';
  deletedAt?: string | null;
  customOverviewSections?: CustomOverviewSection[];
}

export type CustomOverviewSection = {
  id: string;
  title: string;
  type: 'text' | 'image';
  content: string;
};

export type LabOrderSetting = {
  name: string;
  type: 'instant' | 'pending';
  statByDefault?: boolean;
  valueOverride?: string;
  instruction?: string;
};

export interface RoomOrdersConfig {
  labs: LabOrderSetting[];
  notes?: string | null;
}

export interface ClinicalNote {
  id: string;
  patientId: string;
  roomId?: number | null;
  overrideScope?: 'baseline' | 'room' | 'assignment';
  type: 'H&P' | 'Progress' | 'Discharge' | 'Consult';
  title: string;
  content: string;
  author: string;
  timestamp: string;
  signed: boolean;
  assignmentId?: string | null;
}

export interface LabResult {
  id: string;
  patientId: string;
  assignmentId?: string | null;
  roomId?: number | null;
  overrideScope?: 'baseline' | 'room' | 'assignment';
  testName: string;
  value: string | number;
  unit: string;
  referenceRange: string;
  status: 'Normal' | 'Abnormal' | 'Critical' | 'Pending';
  collectionTime: string;
  resultTime?: string;
  orderedBy: string;
  deletedAt?: string | null;
}

export interface VitalSigns {
  id: string;
  patientId: string;
  assignmentId?: string | null;
  roomId?: number | null;
  overrideScope?: 'baseline' | 'room' | 'assignment';
  timestamp: string;
  temperature?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  pain?: number;
  weight?: number;
  height?: number;
  deletedAt?: string | null;
}

export interface MedicalOrder {
  id: string;
  patientId: string;
  assignmentId?: string | null;
  roomId?: number | null;
  overrideScope?: 'baseline' | 'room' | 'assignment';
  category: 'Lab' | 'Medication' | 'Imaging' | 'Procedure' | 'Diet' | 'Activity';
  orderName: string;
  frequency?: string;
  route?: string;
  dose?: string;
  priority: 'Routine' | 'STAT' | 'Timed';
  status: 'Active' | 'Completed' | 'Discontinued' | 'Pending';
  orderedBy: string;
  orderTime: string;
  scheduledTime?: string;
  instructions?: string;
  deletedAt?: string | null;
}

export interface ImagingResult {
  id: string;
  patientId: string;
  studyType: string;
  studyDate: string;
  status: 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled';
  findings?: string;
  impression?: string;
  radiologist?: string;
}
