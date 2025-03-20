import React from 'react';

interface EmbeddedPdfViewerProps {
  pdfUrl: string | null;
}

export default function EmbeddedPdfViewer({ pdfUrl }: EmbeddedPdfViewerProps) {
  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">No PDF document available</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <iframe
        src={pdfUrl}
        className="w-full h-full border-0"
        title="PDF Document"
      />
    </div>
  );
} 