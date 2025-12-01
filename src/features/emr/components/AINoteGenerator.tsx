import { useState } from 'react';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Textarea } from './ui/Textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Badge } from './ui/Badge';
import { Loader2, FileText, Sparkles } from 'lucide-react';
import { generateClinicalNote, formatNoteForDisplay } from '../lib/aiNotes';
import { emrApi } from '../lib/api';
import type { Patient, ClinicalNote } from '../lib/types';

type NoteTypeOption = 'H&P' | 'Progress' | 'Discharge' | 'Consult';

interface AINotesGeneratorProps {
  patient: Patient
  onNoteGenerated: (note: ClinicalNote) => void
}

export function AINotesGenerator({ patient, onNoteGenerated }: AINotesGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [noteType, setNoteType] = useState<NoteTypeOption>('Progress');
  const [generationMode, setGenerationMode] = useState<'generate' | 'format'>('generate');
  const [caseDescription, setCaseDescription] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [rawNote, setRawNote] = useState('');
  const [generatedNote, setGeneratedNote] = useState('');

  const handleGenerateNote = async () => {
    if (generationMode === 'generate' && !caseDescription.trim()) return;
    if (generationMode === 'format' && !rawNote.trim()) return;

    setIsGenerating(true);
    try {
      const noteContent =
        generationMode === 'format'
          ? rawNote.trim()
          : await generateClinicalNote({
              patientId: patient.id,
              noteType,
              caseDescription,
              patientInfo: {
                name: `${patient.firstName} ${patient.lastName}`,
                age: new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear(),
                gender: patient.gender,
                chiefComplaint,
                allergies: patient.allergies,
              },
            });

      const formattedNote = formatNoteForDisplay(
        noteContent,
        noteType,
        patient.attendingPhysician,
        new Date().toISOString(),
      );

      setGeneratedNote(formattedNote);

      // Create note object
      const newNote: ClinicalNote = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        patientId: patient.id,
        type: noteType,
        title: `${noteType} Note - ${new Date().toLocaleDateString()}`,
        content: formattedNote,
        author: patient.attendingPhysician,
        timestamp: new Date().toISOString(),
        signed: false,
      };

      onNoteGenerated(newNote);
      void emrApi.addClinicalNote(newNote);
    } catch (error) {
      console.error('Error generating note:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Clinical Note Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="noteType">Note Type</Label>
              <Select value={noteType} onValueChange={(value: NoteTypeOption) => setNoteType(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="H&P">History & Physical</SelectItem>
                  <SelectItem value="Progress">Progress Note (Daily)</SelectItem>
                  <SelectItem value="Consult">Consultation Note</SelectItem>
                  <SelectItem value="Discharge">Discharge Summary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mode">Mode</Label>
              <Select value={generationMode} onValueChange={(value: 'generate' | 'format') => setGenerationMode(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generate">Generate with AI</SelectItem>
                  <SelectItem value="format">Format my draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {generationMode === 'generate' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="chiefComplaint">Chief Complaint (Optional)</Label>
                  <Input
                    id="chiefComplaint"
                    placeholder="e.g., Chest pain, Shortness of breath"
                    value={chiefComplaint}
                    onChange={(e) => setChiefComplaint(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="caseDescription">Case Description</Label>
                <Textarea
                  id="caseDescription"
                  placeholder="Describe the case, symptoms, history, and current condition for the AI to summarize."
                  value={caseDescription}
                  onChange={(e) => setCaseDescription(e.target.value)}
                  rows={6}
                  className="resize-none"
                />
              </div>
            </>
          )}

          {generationMode === 'format' && (
            <div className="space-y-2">
              <Label htmlFor="rawNote">Paste your note</Label>
              <Textarea
                id="rawNote"
                placeholder="Paste your draft note here and we'll format it."
                value={rawNote}
                onChange={(e) => setRawNote(e.target.value)}
                rows={8}
                className="resize-none"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={handleGenerateNote}
              disabled={
                isGenerating ||
                (generationMode === 'generate' ? !caseDescription.trim() : !rawNote.trim())
              }
              className="flex items-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  {generationMode === 'generate' ? `Generate ${noteType} Note` : 'Format Note'}
                </>
              )}
            </Button>
            <Badge variant="outline">AI-Powered</Badge>
          </div>
        </CardContent>
      </Card>

      {generatedNote && (
        <Card>
          <CardHeader>
            <CardTitle>Generated Note Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-muted p-4 rounded-lg">
              <pre className="whitespace-pre-wrap text-sm font-mono">{generatedNote}</pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
