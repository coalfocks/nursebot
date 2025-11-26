import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { ScrollArea } from './ui/ScrollArea';
import { FileText, Plus, Calendar, User, CheckCircle, Clock } from 'lucide-react';
import { AINotesGenerator } from './AINoteGenerator';
import type { Patient, ClinicalNote } from '../lib/types';
import { emrApi } from '../lib/api';

interface ClinicalNotesProps {
  patient: Patient
}

export function ClinicalNotes({ patient }: ClinicalNotesProps) {
  const [notes, setNotes] = useState<ClinicalNote[]>([]);

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listClinicalNotes(patient.id);
      setNotes(data);
    })();
  }, [patient.id]);

  const [showGenerator, setShowGenerator] = useState(false);

  const handleNoteGenerated = (newNote: ClinicalNote) => {
    setNotes([newNote, ...notes]);
    setShowGenerator(false);
    void emrApi.addClinicalNote(newNote);
  };

  const notesByType = notes.reduce(
    (acc, note) => {
      if (!acc[note.type]) acc[note.type] = [];
      acc[note.type].push(note);
      return acc;
    },
    {} as Record<string, ClinicalNote[]>,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Clinical Notes</h2>
        <Button onClick={() => setShowGenerator(!showGenerator)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Generate AI Note
        </Button>
      </div>

      {showGenerator && <AINotesGenerator patient={patient} onNoteGenerated={handleNoteGenerated} />}

      <Tabs defaultValue="all" className="w-full">
        <TabsList>
          <TabsTrigger value="all">All Notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="H&P">H&P ({notesByType['H&P']?.length || 0})</TabsTrigger>
          <TabsTrigger value="Progress">Progress ({notesByType['Progress']?.length || 0})</TabsTrigger>
          <TabsTrigger value="Consult">Consult ({notesByType['Consult']?.length || 0})</TabsTrigger>
          <TabsTrigger value="Discharge">Discharge ({notesByType['Discharge']?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <div className="space-y-4">
            {notes.map((note) => (
              <Card key={note.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5" />
                      <div>
                        <CardTitle className="text-lg">{note.title}</CardTitle>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {note.author}
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(note.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={note.type === 'H&P' ? 'default' : 'secondary'}>{note.type}</Badge>
                      {note.signed ? (
                        <Badge variant="default" className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Signed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Pending
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64 w-full">
                    <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-lg">{note.content}</pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {Object.entries(notesByType).map(([type, typeNotes]) => (
          <TabsContent key={type} value={type} className="mt-6">
            <div className="space-y-4">
              {typeNotes.map((note) => (
                <Card key={note.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5" />
                        <div>
                          <CardTitle className="text-lg">{note.title}</CardTitle>
                          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {note.author}
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(note.timestamp).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </div>
                      {note.signed ? (
                        <Badge variant="default" className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Signed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Pending
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64 w-full">
                      <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-lg">
                        {note.content}
                      </pre>
                    </ScrollArea>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
