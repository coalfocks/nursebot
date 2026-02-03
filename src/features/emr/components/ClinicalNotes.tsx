import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/Tabs';
import { ScrollArea } from './ui/ScrollArea';
import { FileText, Plus, User, CheckCircle, Clock, Trash2, PenTool } from 'lucide-react';
import { AINotesGenerator } from './AINoteGenerator';
import type { Patient, ClinicalNote } from '../lib/types';
import { emrApi } from '../lib/api';
import { useAuthStore } from '../../../stores/authStore';
import { isSuperAdmin } from '../../../lib/roles';
import { generateFeedback } from '../../../lib/feedbackService';

interface ClinicalNotesProps {
  patient: Patient;
  assignmentId?: string;
  forceBaseline?: boolean;
}

export function ClinicalNotes({ patient, assignmentId, forceBaseline }: ClinicalNotesProps) {
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const { profile } = useAuthStore();
  const canEdit = isSuperAdmin(profile);
  const canWriteNotes = isSuperAdmin(profile);
  const [showQualtrics, setShowQualtrics] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [nurseNoteDraft, setNurseNoteDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState<{ title: string; type: ClinicalNote['type']; content: string }>({
    title: '',
    type: 'Progress',
    content: '',
  });
  const qualtricsUrl = 'https://blueq.co1.qualtrics.com/jfe/form/SV_7VZqjp5mYkwvJm6';

  // Check if a note is editable by the current user
  const canEditNote = (note: ClinicalNote): boolean => {
    if (note.signed) return false;
    return isSuperAdmin(profile);
  };

  useEffect(() => {
    void (async () => {
      const data = await emrApi.listClinicalNotes(patient.id, assignmentId, patient.roomId ?? null);
      setNotes(data);
    })();
  }, [patient.id, patient.roomId, assignmentId]);

  const [showGenerator, setShowGenerator] = useState(false);

  const handleNoteGenerated = (newNote: ClinicalNote) => {
    if (!canWriteNotes) return;
    const adjustedNote: ClinicalNote = {
      ...newNote,
      assignmentId: forceBaseline ? null : assignmentId ?? newNote.assignmentId ?? null,
      roomId: forceBaseline ? null : patient.roomId ?? newNote.roomId ?? null,
      overrideScope: forceBaseline ? 'baseline' : newNote.overrideScope,
    };
    setNotes((prev) => [adjustedNote, ...prev]);
    setShowGenerator(false);
    if (adjustedNote.type === 'Progress' && adjustedNote.assignmentId) {
      setShowQualtrics(true);
    }
    void emrApi.addClinicalNote(adjustedNote);
  };

  const handleAddNurseNote = () => {
    const content = nurseNoteDraft.trim();
    if (!content) return;
    const resolvedAssignmentId = forceBaseline ? null : assignmentId ?? null;
    const resolvedRoomId = forceBaseline ? null : patient.roomId ?? null;
    const overrideScope = resolvedAssignmentId ? 'assignment' : resolvedRoomId ? 'room' : 'baseline';
    const author = profile?.full_name?.trim() || profile?.email?.trim() || 'Nurse';
    const newNote: ClinicalNote = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      patientId: patient.id,
      assignmentId: resolvedAssignmentId,
      roomId: resolvedRoomId,
      overrideScope,
      type: 'Nurse',
      title: 'Nurse Note',
      content,
      author,
      signed: false,
    };
    setNotes((prev) => [newNote, ...prev]);
    setNurseNoteDraft('');
    void emrApi.addClinicalNote(newNote);
  };

  const startEditing = (note: ClinicalNote) => {
    setEditingNoteId(note.id);
    setNoteDraft({
      title: note.title,
      type: note.type,
      content: note.content,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingNoteId) return;
    const current = notes.find((note) => note.id === editingNoteId);
    const updated = await emrApi.updateClinicalNote(editingNoteId, {
      title: noteDraft.title.trim() || current?.title,
      type: noteDraft.type,
      content: noteDraft.content.trim() || current?.content,
    });
    if (updated) {
      setNotes((prev) => prev.map((note) => (note.id === editingNoteId ? { ...note, ...updated } : note)));
      if ((updated.type ?? noteDraft.type) === 'Progress' && current?.assignmentId) {
        setShowQualtrics(true);
      }
    }
    setEditingNoteId(null);
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!canEdit) return;
    const note = notes.find((n) => n.id === noteId);
    if (!note || !canEditNote(note) || !noteId) return;
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setNotes((prev) => prev.filter((note) => note.id && note.id !== noteId));
    await emrApi.deleteClinicalNote(noteId, note.patientId);
  };

  const handleSignNote = async (note: ClinicalNote) => {
    if (!note.assignmentId) return;

    // Update the note to signed
    const updated = await emrApi.updateClinicalNote(note.id, { signed: true });
    if (updated) {
      setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, signed: true } : n)));

      // Trigger feedback generation for the assignment
      try {
        await generateFeedback(note.assignmentId);
      } catch (error) {
        console.error('Error generating feedback:', error);
        // Note is still signed even if feedback generation fails
      }
    }
  };

  const notesByType = notes.reduce(
    (acc, note) => {
      if (!acc[note.type]) acc[note.type] = [];
      acc[note.type].push(note);
      return acc;
    },
    {} as Record<string, ClinicalNote[]>,
  );

  const renderNoteCard = (note: ClinicalNote) => {
    const isEditing = editingNoteId === note.id;
    return (
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
              {canEditNote(note) &&
                (isEditing ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditingNoteId(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void handleSaveEdit()}>
                      Save
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {!note.signed && note.assignmentId && (
                      <Button size="sm" onClick={() => void handleSignNote(note)} className="flex items-center gap-1">
                        <PenTool className="h-3 w-3" />
                        Sign
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => startEditing(note)}>
                      Edit
                    </Button>
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => void handleDeleteNote(note.id)}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Title</label>
                  <input
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                    value={noteDraft.title}
                    onChange={(e) => setNoteDraft((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Type</label>
                  <select
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                    value={noteDraft.type}
                    onChange={(e) =>
                      setNoteDraft((prev) => ({ ...prev, type: e.target.value as ClinicalNote['type'] }))
                    }
                  >
                    {['H&P', 'Progress', 'Consult', 'Discharge', 'Nurse'].map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Content</label>
                <textarea
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  rows={8}
                  value={noteDraft.content}
                  onChange={(e) => setNoteDraft((prev) => ({ ...prev, content: e.target.value }))}
                />
              </div>
            </div>
          ) : (
            <ScrollArea className="h-64 w-full">
              <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-lg">{note.content}</pre>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Clinical Notes</h2>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="outline" onClick={() => setShowQualtrics(true)}>
              Test Qualtrics
            </Button>
          )}
          {canWriteNotes && (
            <Button onClick={() => setShowGenerator(!showGenerator)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Generate AI Note
            </Button>
          )}
        </div>
      </div>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Nurse Note</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              rows={6}
              placeholder="Write a nurse note..."
              value={nurseNoteDraft}
              onChange={(e) => setNurseNoteDraft(e.target.value)}
            />
            <div className="flex justify-end">
              <Button onClick={handleAddNurseNote} disabled={!nurseNoteDraft.trim()}>
                Add Nurse Note
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showGenerator && <AINotesGenerator patient={patient} onNoteGenerated={handleNoteGenerated} />}

      <Tabs defaultValue="all" className="w-full">
        <TabsList>
          <TabsTrigger value="all">All Notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="H&P">H&P ({notesByType['H&P']?.length || 0})</TabsTrigger>
          <TabsTrigger value="Progress">Progress ({notesByType['Progress']?.length || 0})</TabsTrigger>
          <TabsTrigger value="Nurse">Nurse ({notesByType['Nurse']?.length || 0})</TabsTrigger>
          <TabsTrigger value="Consult">Consult ({notesByType['Consult']?.length || 0})</TabsTrigger>
          <TabsTrigger value="Discharge">Discharge ({notesByType['Discharge']?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <div className="space-y-4">
            {notes.map(renderNoteCard)}
          </div>
        </TabsContent>

        {Object.entries(notesByType).map(([type, typeNotes]) => (
          <TabsContent key={type} value={type} className="mt-6">
            <div className="space-y-4">
              {typeNotes.map(renderNoteCard)}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {showQualtrics && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowQualtrics(false)}
        >
          <div
            className="relative w-full max-w-4xl rounded-lg bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-base font-semibold">Case Reflection</h3>
              <Button variant="ghost" onClick={() => setShowQualtrics(false)}>
                Close
              </Button>
            </div>
            <div className="h-[75vh] w-full">
              <iframe
                title="Case Reflection Survey"
                src={qualtricsUrl}
                className="h-full w-full rounded-b-lg"
                allow="fullscreen"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
