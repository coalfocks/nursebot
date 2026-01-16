-- Allow authenticated users to upload overview images to the imaging_studies bucket
CREATE POLICY "Authenticated uploads to imaging_studies"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'imaging_studies');
