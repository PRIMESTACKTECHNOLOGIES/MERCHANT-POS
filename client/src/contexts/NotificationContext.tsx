import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { playNotificationSound } from '../lib/sound';
import { NotificationContext, type Notification, type NotificationType } from './notification-context';

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Load from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem('pos_notifications');
    if (saved) {
      try {
        setNotifications(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse notifications', e);
      }
    }
  }, []);

  // Save to local storage on change
  useEffect(() => {
    localStorage.setItem('pos_notifications', JSON.stringify(notifications));
  }, [notifications]);

  const addNotification = useCallback((title: string, message: string, type: NotificationType = 'info', playSound: boolean = true) => {
    const newNotification: Notification = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      title,
      message,
      type,
      read: false,
      timestamp: Date.now(),
    };
    setNotifications(prev => [newNotification, ...prev].slice(0, 50)); // Keep last 50
    
    if (playSound) {
      playNotificationSound(type);
    }
  }, []);

  const markAsRead = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        dismissNotification,
        markAllAsRead,
        clearNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
