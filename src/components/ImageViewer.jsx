import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { X } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

function ImageViewer({ file, onClose }) {
  const imagePath = `/api/projects/${file.projectName}/files/content?path=${encodeURIComponent(file.path)}`;
  const [imageUrl, setImageUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl;
    const controller = new AbortController();

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);
        setImageUrl(null);

        const response = await authenticatedFetch(imagePath, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch (err) {
        if (err.name === 'AbortError') {
          return;
        }
        console.error('Error loading image:', err);
        setError('Unable to load image');
      } finally {
        setLoading(false);
      }
    };

    loadImage();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imagePath]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl max-h-[90vh] w-full mx-4 overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {file.name}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 flex justify-center items-center bg-gray-50 dark:bg-gray-900 min-h-[400px]">
          {loading && (
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p>Loading image…</p>
            </div>
          )}
          {!loading && imageUrl && (
            <img
              src={imageUrl}
              alt={file.name}
              className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-md"
            />
          )}
          {!loading && !imageUrl && (
            <div className="text-center text-gray-500 dark:text-gray-400">
              <p>{error || 'Unable to load image'}</p>
              <p className="text-sm mt-2 break-all">{file.path}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50 dark:bg-gray-800">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {file.path}
          </p>
        </div>
      </div>
    </div>
  );
}

export default ImageViewer;
