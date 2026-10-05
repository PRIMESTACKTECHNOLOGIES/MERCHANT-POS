import { useEffect, useState } from 'react';
import { useNotifications } from '../contexts/useNotifications';

export const Toast = () => {
  const { notifications, dismissNotification } = useNotifications();
  const [toasts, setToasts] = useState<typeof notifications>([]);

  // Show only the latest unread notification as a toast
  useEffect(() => {
    const latestUnread = notifications.filter(n => !n.read).slice(0, 1);
    setToasts(latestUnread);
  }, [notifications]);

  return (
    <div className="fixed bottom-4 right-4 z-[9999] space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 p-4 rounded-xl shadow-lg border bg-white max-w-sm animate-slide-in-right`}
        >
          <div className={`p-2 rounded-full flex-shrink-0 ${
            toast.type === 'success' ? 'bg-green-100 text-green-600' :
            toast.type === 'error' ? 'bg-red-100 text-red-600' :
            toast.type === 'warning' ? 'bg-yellow-100 text-yellow-600' :
            'bg-blue-100 text-blue-600'
          }`}>
            {toast.type === 'success' && (
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {toast.type === 'error' && (
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {toast.type === 'warning' && (
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
            {toast.type === 'info' && (
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
            <p className="text-xs text-gray-500 mt-1">{toast.message}</p>
          </div>
          <button
            type="button"
            onClick={() => dismissNotification(toast.id)}
            className="flex-shrink-0 self-center rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          >
            Close
          </button>
        </div>
      ))}
    </div>
  );
};
