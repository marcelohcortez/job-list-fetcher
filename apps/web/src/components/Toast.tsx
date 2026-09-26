import { useEffect, useState } from 'react';
import type { JobMark } from '../api';

export const MARK_TOAST_MESSAGE: Record<JobMark, string> = {
  dead: 'marked as dead',
  saved: 'saved',
  applied: 'marked as applied',
};

export function useSuccessToast(durationMs = 3000) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs]);

  return { toast: message, showToast: setMessage };
}

export function SuccessToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast toast-success" role="status">
      {message}
    </div>
  );
}
