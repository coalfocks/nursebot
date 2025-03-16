-- Add pdf_url column to rooms table
ALTER TABLE rooms
ADD COLUMN pdf_url text;

-- Add comment to explain the field
COMMENT ON COLUMN rooms.pdf_url IS 'URL to a PDF document that provides additional information for the room';

-- Create a storage bucket for room PDFs if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('room_pdfs', 'room_pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Set up storage policies for room PDFs
-- Allow public access to read PDFs
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'room_pdfs');

-- Allow authenticated users to upload PDFs
CREATE POLICY "Authenticated users can upload PDFs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'room_pdfs');

-- Allow authenticated users to update their own PDFs
CREATE POLICY "Authenticated users can update their own PDFs"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'room_pdfs' AND owner = auth.uid());

-- Allow authenticated users to delete their own PDFs
CREATE POLICY "Authenticated users can delete their own PDFs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'room_pdfs' AND owner = auth.uid()); 