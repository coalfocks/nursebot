import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Loader2, Plus, Upload, X } from 'lucide-react';
import type { ImagingImage, ImagingStudy, Patient } from '../lib/types';
import { emrApi } from '../lib/api';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { hasAdminAccess } from '../../../lib/roles';

type PendingUpload = {
  id: string;
  file: File;
  annotation: string;
};

interface ImagingStudiesProps {
  patient: Patient;
  assignmentId?: string;
  forceBaseline?: boolean;
  refreshToken?: number;
}

const studyTypes = ['CT', 'MRI', 'Ultrasound', 'Echocardiogram', 'X-ray'];

export function ImagingStudies({ patient, assignmentId, forceBaseline, refreshToken }: ImagingStudiesProps) {
  const { profile } = useAuthStore();
  const canEdit = hasAdminAccess(profile);
  const [studies, setStudies] = useState<ImagingStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [modalImage, setModalImage] = useState<ImagingImage | null>(null);
  const [uploadingStudyId, setUploadingStudyId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<Record<string, PendingUpload[]>>({});
  const [createForm, setCreateForm] = useState({
    orderName: '',
    studyType: 'CT',
    contrast: 'with',
    priority: 'Routine' as ImagingStudy['priority'],
  });

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      const data = await emrApi.listImagingStudies(patient.id, assignmentId, patient.roomId ?? null);
      if (isMounted) {
        setStudies(data);
        setLoading(false);
      }
    };
    void load();
    return () => {
      isMounted = false;
    };
  }, [patient.id, patient.roomId, assignmentId, refreshToken]);

  const formatDate = (value?: string | null) => {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  };

  const handleCreateStudy = async () => {
    setError('');
    const orderName = createForm.orderName.trim();
    const needsContrast = ['CT', 'MRI'].includes(createForm.studyType);
    const contrastLabel = needsContrast
      ? createForm.contrast === 'with'
        ? 'With Contrast'
        : 'Without Contrast'
      : '';
    const defaultOrderName = needsContrast
      ? `${createForm.studyType} (${contrastLabel})`
      : createForm.studyType;

    const newStudy: ImagingStudy = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      patientId: patient.id,
      assignmentId: forceBaseline ? null : assignmentId ?? null,
      roomId: forceBaseline ? null : patient.roomId ?? null,
      overrideScope: forceBaseline
        ? 'baseline'
        : assignmentId
        ? 'assignment'
        : patient.roomId
        ? 'room'
        : 'baseline',
      orderName: orderName || defaultOrderName,
      studyType: createForm.studyType,
      contrast: needsContrast ? (createForm.contrast as ImagingStudy['contrast']) : null,
      priority: createForm.priority ?? 'Routine',
      status: 'Pending',
      orderedBy: profile?.full_name ?? 'Admin',
      orderTime: new Date().toISOString(),
      images: [],
    };

    const inserted = await emrApi.addImagingStudy(newStudy);
    if (!inserted) {
      setError('Failed to create imaging study.');
      return;
    }
    setStudies((prev) => [inserted, ...prev]);
    setShowCreate(false);
    setCreateForm({
      orderName: '',
      studyType: 'CT',
      contrast: 'with',
      priority: 'Routine',
    });
  };

  const handleSelectFiles = (studyId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items: PendingUpload[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${file.name}`,
      file,
      annotation: '',
    }));
    setPendingUploads((prev) => ({ ...prev, [studyId]: items }));
  };

  const handleAnnotationChange = (studyId: string, uploadId: string, value: string) => {
    setPendingUploads((prev) => ({
      ...prev,
      [studyId]: (prev[studyId] ?? []).map((item) =>
        item.id === uploadId ? { ...item, annotation: value } : item,
      ),
    }));
  };

  const handleUploadImages = async (study: ImagingStudy) => {
    const pending = pendingUploads[study.id] ?? [];
    if (pending.length === 0) return;
    setUploadingStudyId(study.id);
    setError('');

    try {
      const uploadedImages = await Promise.all(
        pending.map(async (item) => {
          const fileExt = item.file.name.split('.').pop() || 'png';
          const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
          const filePath = `${study.id}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('imaging_studies')
            .upload(filePath, item.file, {
              cacheControl: '3600',
              upsert: false,
            });

          if (uploadError) {
            throw uploadError;
          }

          const { data } = supabase.storage
            .from('imaging_studies')
            .getPublicUrl(filePath);

          return {
            id: item.id,
            url: data.publicUrl,
            annotation: item.annotation.trim(),
          };
        }),
      );

      const updatedImages = [...(study.images ?? []), ...uploadedImages];
      const updated = await emrApi.updateImagingStudy(study.id, { images: updatedImages });
      if (updated) {
        setStudies((prev) => prev.map((item) => (item.id === study.id ? updated : item)));
      }
      setPendingUploads((prev) => {
        const next = { ...prev };
        delete next[study.id];
        return next;
      });
    } catch (err) {
      console.error('Failed to upload imaging images', err);
      setError('Failed to upload imaging images. Please try again.');
    } finally {
      setUploadingStudyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Imaging Studies</h2>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setShowCreate((prev) => !prev)}>
            <Plus className="h-4 w-4 mr-2" />
            Add imaging study
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {showCreate && canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Create imaging study</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground">Study type</label>
                <select
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={createForm.studyType}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, studyType: e.target.value }))}
                >
                  {studyTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              {['CT', 'MRI'].includes(createForm.studyType) && (
                <div>
                  <label className="block text-sm font-medium text-muted-foreground">Contrast</label>
                  <select
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                    value={createForm.contrast}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, contrast: e.target.value }))}
                  >
                    <option value="with">With contrast</option>
                    <option value="without">Without contrast</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-muted-foreground">Priority</label>
                <select
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={createForm.priority ?? 'Routine'}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      priority: e.target.value as ImagingStudy['priority'],
                    }))
                  }
                >
                  <option value="Routine">Routine</option>
                  <option value="STAT">STAT</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground">Order name (optional)</label>
                <Input
                  value={createForm.orderName}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, orderName: e.target.value }))}
                  placeholder="e.g., CT (With Contrast)"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleCreateStudy()}>
                Create study
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : studies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No imaging studies yet.</p>
      ) : (
        <div className="space-y-6">
          {studies.map((study) => {
            const contrastLabel =
              study.contrast === 'with'
                ? 'With contrast'
                : study.contrast === 'without'
                ? 'Without contrast'
                : null;
            return (
              <Card key={study.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle>{study.orderName || study.studyType}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {study.studyType}
                        {contrastLabel ? ` • ${contrastLabel}` : ''} • Ordered {formatDate(study.orderTime)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {study.priority && <Badge variant="outline">{study.priority}</Badge>}
                      {study.status && <Badge>{study.status}</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground">Radiology Read</h4>
                    {study.report ? (
                      <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg">{study.report}</pre>
                    ) : (
                      <p className="text-sm text-muted-foreground">Report pending.</p>
                    )}
                    {study.reportGeneratedAt && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Generated {formatDate(study.reportGeneratedAt)}
                      </p>
                    )}
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground">Images</h4>
                    {study.images && study.images.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {study.images.map((image) => (
                          <div key={image.id} className="space-y-2">
                            <button
                              type="button"
                              onClick={() => setModalImage(image)}
                              className="w-full border border-border rounded-lg overflow-hidden hover:opacity-90"
                            >
                              <img
                                src={image.url}
                                alt={image.annotation || 'Imaging study'}
                                className="w-full object-contain bg-black/5"
                              />
                            </button>
                            {image.annotation && (
                              <p className="text-sm text-muted-foreground">{image.annotation}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No images uploaded.</p>
                    )}
                  </div>

                  {canEdit && (
                    <div className="border-t border-border pt-4 space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground">Upload images</label>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => handleSelectFiles(study.id, e.target.files)}
                          className="mt-1 block w-full text-sm text-muted-foreground"
                        />
                      </div>

                      {(pendingUploads[study.id] ?? []).length > 0 && (
                        <div className="space-y-3">
                          {(pendingUploads[study.id] ?? []).map((item) => (
                            <div key={item.id} className="space-y-2 rounded-md border border-border p-3">
                              <div className="text-xs text-muted-foreground">{item.file.name}</div>
                              <Textarea
                                value={item.annotation}
                                onChange={(e) => handleAnnotationChange(study.id, item.id, e.target.value)}
                                placeholder="Annotation shown beneath the image"
                                rows={2}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => void handleUploadImages(study)}
                          disabled={(pendingUploads[study.id] ?? []).length === 0 || uploadingStudyId === study.id}
                        >
                          {uploadingStudyId === study.id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4 mr-2" />
                          )}
                          Upload images
                        </Button>
                        {pendingUploads[study.id] && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPendingUploads((prev) => {
                                const next = { ...prev };
                                delete next[study.id];
                                return next;
                              })
                            }
                          >
                            <X className="h-4 w-4 mr-2" />
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {modalImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-medium">Imaging Preview</h3>
              <button
                type="button"
                onClick={() => setModalImage(null)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="p-4 space-y-3">
              <img src={modalImage.url} alt="Imaging preview" className="w-full object-contain rounded-lg" />
              {modalImage.annotation && (
                <p className="text-sm text-muted-foreground">{modalImage.annotation}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
