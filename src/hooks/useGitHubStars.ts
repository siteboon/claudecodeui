import { useState, useEffect, useCallback } from 'react';

const CACHE_KEY = 'CLOUDCLI_GITHUB_STARS';
const DISMISS_KEY = 'CLOUDCLI_HIDE_GITHUB_STAR';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

type CachedStars = {
  count: number;
  timestamp: number;
};

export const useGitHubStars = (owner: string, repo: string) => {
  const [starCount, setStarCount] = useState<number | null>(null);
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (isDismissed) return;

    // Check cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: CachedStars = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL) {
          setStarCount(parsed.count);
          return;
        }
      }
    } catch {
      // ignore
    }

    const fetchStars = async () => {
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (!response.ok) return;
        const data = await response.json();
        const count = data.stargazers_count;
        if (typeof count === 'number') {
          setStarCount(count);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ count, timestamp: Date.now() }));
          } catch {
            // ignore
          }
        }
      } catch {
        // silent fail
      }
    };

    void fetchStars();
  }, [owner, repo, isDismissed]);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // ignore
    }
  }, []);

  const formattedCount = starCount !== null
    ? starCount >= 1000
      ? `${(starCount / 1000).toFixed(1)}k`
      : `${starCount}`
    : null;

  return { starCount, formattedCount, isDismissed, dismiss };
};
