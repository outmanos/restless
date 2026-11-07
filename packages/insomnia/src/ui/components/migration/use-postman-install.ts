import { useEffect, useState } from 'react';

// Whether Postman is installed on this computer. It cannot be migrated from, so this only drives a hint.
export const usePostmanInstall = () => {
  const [postman, setPostman] = useState<{ path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(window.main.migrationDetectPostman?.())
      .then(found => {
        if (!cancelled) {
          setPostman(found ?? null);
        }
      })
      .catch(() => {
        // A hint is not worth an error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return postman;
};
