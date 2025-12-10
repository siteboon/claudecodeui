import React, { useState, useEffect } from 'react';
import { Globe, Copy, Check, ExternalLink } from 'lucide-react';

function NgrokStatus() {
  const [ngrokUrl, setNgrokUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Check if ngrok URL should be shown
    const showNgrok = import.meta.env.VITE_SHOW_NGROK_URL === 'true';
    const subdomain = import.meta.env.VITE_NGROK_SUBDOMAIN;

    if (showNgrok && subdomain) {
      setNgrokUrl(`https://${subdomain}.ngrok.io`);
    }
  }, []);

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!ngrokUrl || !isVisible) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg max-w-sm">
      <div className="flex items-center gap-2">
        <Globe size={16} />
        <span className="text-sm font-medium">Public Access</span>
        <button
          onClick={() => setIsVisible(false)}
          className="ml-auto text-white/80 hover:text-white text-lg leading-none"
        >
          ×
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-blue-100 truncate flex-1">
          {ngrokUrl}
        </span>
        <button
          onClick={() => copyToClipboard(ngrokUrl)}
          className="p-1 hover:bg-blue-600 rounded transition-colors"
          title="Copy URL"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        <a
          href={ngrokUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 hover:bg-blue-600 rounded transition-colors"
          title="Open in new window"
        >
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

export default NgrokStatus;
