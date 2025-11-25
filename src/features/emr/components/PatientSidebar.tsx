import { useState } from 'react';
import type { Patient } from '../lib/types';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Input } from './ui/Input';
import { Search, User, Calendar } from 'lucide-react';

interface PatientSidebarProps {
  selectedPatient: Patient | null;
  onPatientSelect: (patient: Patient) => void;
  patients: Patient[];
}

export function PatientSidebar({ selectedPatient, onPatientSelect, patients }: PatientSidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPatients = patients.filter(
    (patient) =>
      patient.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patient.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      patient.mrn.includes(searchTerm) ||
      (patient.room ?? '').includes(searchTerm),
  );

  return (
    <div className="patient-sidebar p-4 flex flex-col h-full">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground mb-3">Patient List</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search patients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {filteredPatients.map((patient) => (
          <Card
            key={patient.id}
            className={`p-3 cursor-pointer transition-colors hover:bg-accent ${
              selectedPatient?.id === patient.id ? 'bg-accent border-primary' : ''
            }`}
            onClick={() => onPatientSelect(patient)}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">
                    {patient.lastName}, {patient.firstName}
                  </p>
                  <p className="text-xs text-muted-foreground">MRN: {patient.mrn}</p>
                </div>
              </div>
              <Badge variant="outline" className="text-xs">
                Room {patient.room}
              </Badge>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>Admitted {new Date(patient.admissionDate).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between">
              <Badge variant={patient.codeStatus === 'Full Code' ? 'default' : 'destructive'} className="text-xs">
                {patient.codeStatus}
              </Badge>
              <span className="text-xs text-muted-foreground">{patient.attendingPhysician}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
