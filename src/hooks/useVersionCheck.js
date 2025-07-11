// hooks/useVersionCheck.js
import { useState, useEffect } from 'react';
import { version } from '../../package.json';

export const useVersionCheck = (owner, repo) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState(null);

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
        const data = await response.json();
        
        // Handle the case where there might not be any releases
        if (data.tag_name) {
          const latest = data.tag_name.replace(/^v/, '');
          setLatestVersion(latest);
          setUpdateAvailable(version !== latest);
        } else {
          // No releases found, don't show update notification
          setUpdateAvailable(false);
          setLatestVersion(null);
        }
      } catch (error) {
        console.error('Version check failed:', error);
        // On error, don't show update notification
        setUpdateAvailable(false);
        setLatestVersion(null);
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 5 * 60 * 1000); // Check every 5 minutes
    return () => clearInterval(interval);
  }, [owner, repo]);

  return { updateAvailable, latestVersion, currentVersion: version };
}; 