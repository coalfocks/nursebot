import React, { useState } from 'react';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { ChevronLeft, ChevronRight, X, Download, Maximize2, Minimize2 } from 'lucide-react';

// Set up the worker for PDF.js
import { pdfjs } from 'react-pdf';
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PdfViewerProps {
  pdfUrl: string;
  onClose: () => void;
}

export default function PdfViewer({ pdfUrl, onClose }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setPageNumber(1);
  }

  function changePage(offset: number) {
    if (numPages === null) return;
    setPageNumber(prevPageNumber => {
      const newPageNumber = prevPageNumber + offset;
      return Math.max(1, Math.min(numPages, newPageNumber));
    });
  }

  function previousPage() {
    changePage(-1);
  }

  function nextPage() {
    changePage(1);
  }

  function toggleFullscreen() {
    setIsFullscreen(!isFullscreen);
  }

  return (
    <div className={`fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4 ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className={`bg-white rounded-lg shadow-xl overflow-hidden flex flex-col ${isFullscreen ? 'w-full h-full' : 'max-w-4xl max-h-[90vh]'}`}>
        {/* Header */}
        <div className="bg-gray-100 px-4 py-3 flex items-center justify-between border-b">
          <div className="flex items-center">
            <h3 className="text-lg font-medium text-gray-900">PDF Document</h3>
            {numPages && (
              <span className="ml-4 text-sm text-gray-500">
                Page {pageNumber} of {numPages}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleFullscreen}
              className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <a
              href={pdfUrl}
              download
              className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200"
              title="Download PDF"
            >
              <Download className="w-5 h-5" />
            </a>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-200"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* PDF Viewer */}
        <div className="flex-1 overflow-auto bg-gray-200 flex items-center justify-center">
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700"></div>
              </div>
            }
            error={
              <div className="text-center p-4">
                <p className="text-red-500 font-medium">Failed to load PDF</p>
                <p className="text-gray-500 mt-2">Please try downloading the file instead</p>
              </div>
            }
          >
            <Page 
              pageNumber={pageNumber} 
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="shadow-lg"
              scale={1.2}
            />
          </Document>
        </div>
        
        {/* Controls */}
        {numPages && numPages > 1 && (
          <div className="bg-gray-100 px-4 py-3 border-t flex items-center justify-center space-x-4">
            <button
              onClick={previousPage}
              disabled={pageNumber <= 1}
              className="p-2 rounded-full bg-white border border-gray-300 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm">
              Page {pageNumber} of {numPages}
            </span>
            <button
              onClick={nextPage}
              disabled={pageNumber >= numPages}
              className="p-2 rounded-full bg-white border border-gray-300 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
} 