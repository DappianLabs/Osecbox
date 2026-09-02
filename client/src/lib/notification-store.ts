import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number; // ms, 0 = persistent
  timestamp: number;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  
  // Convenience methods for common notifications
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string, action?: Notification['action']) => void;
  showWarning: (title: string, message: string, action?: Notification['action']) => void;
  showInfo: (title: string, message: string) => void;
  
  // Specific compatibility notifications
  showToolNotFound: (tool: string) => void;
  showFirewallBlocked: (service: string) => void;
  showProxyDetected: (proxyUrl: string) => void;
  showLowMemory: (memoryGB: number) => void;
  showPermissionDenied: (path: string) => void;
  showNodePtyFailed: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  addNotification: (notification) => {
    const id = `notif-${Date.now()}-${Math.random()}`;
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: Date.now(),
      duration: notification.duration ?? 5000, // Default 5 seconds
    };

    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }));

    // Auto-remove after duration (if not persistent)
    if (newNotification.duration && newNotification.duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, newNotification.duration);
    }

    return id;
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },

  // Convenience methods
  showSuccess: (title, message) => {
    get().addNotification({ title, message, type: 'success' });
  },

  showError: (title, message, action) => {
    get().addNotification({ title, message, type: 'error', action, duration: 5000 });
  },

  showWarning: (title, message, action) => {
    get().addNotification({ title, message, type: 'warning', action, duration: 5000 });
  },

  showInfo: (title, message) => {
    get().addNotification({ title, message, type: 'info' });
  },

  // Specific compatibility notifications
  showToolNotFound: (tool) => {
    get().addNotification({
      title: `${tool} Not Found`,
      message: `${tool} is not installed. Click Install to see instructions.`,
      type: 'error',
      action: {
        label: 'Install',
        onClick: async () => {
          // This will be handled by the ToolNotFoundDialog
          const { useToolCheckStore } = await import('./tool-check-store');
          useToolCheckStore.getState().showInstallDialog(tool);
        },
      },
      duration: 5000,
    });
  },

  showFirewallBlocked: (service) => {
    get().addNotification({
      title: 'Connection Failed',
      message: `Cannot connect to ${service}. Check your firewall or network settings.`,
      type: 'warning',
      action: {
        label: 'Help',
        onClick: () => {
          window.open('https://github.com/yourusername/osecbox/wiki/Troubleshooting', '_blank');
        },
      },
      duration: 5000,
    });
  },

  showProxyDetected: (proxyUrl) => {
    get().addNotification({
      title: 'Proxy Detected',
      message: `Using system proxy: ${proxyUrl}`,
      type: 'info',
      duration: 5000,
    });
  },

  showLowMemory: (memoryGB) => {
    get().addNotification({
      title: 'Low Memory Warning',
      message: `Your system has ${memoryGB.toFixed(1)}GB RAM. Performance may be affected.`,
      type: 'warning',
      duration: 8000,
    });
  },

  showPermissionDenied: (path) => {
    get().addNotification({
      title: 'Permission Denied',
      message: `Cannot write to ${path}. Settings may not be saved.`,
      type: 'error',
      action: {
        label: 'Fix',
        onClick: () => {
          window.open('https://docs.osecbox.com/troubleshooting/permissions', '_blank');
        },
      },
      duration: 10000,
    });
  },

  showNodePtyFailed: () => {
    get().addNotification({
      title: 'Terminal Module Failed',
      message: 'Terminals are disabled. Scans will still work.',
      type: 'error',
      action: {
        label: 'Help',
        onClick: () => {
          window.open('https://docs.osecbox.com/troubleshooting/terminals', '_blank');
        },
      },
      duration: 0, // Persistent
    });
  },
}));

// Expose globally for Electron main process
if (typeof window !== 'undefined') {
  (window as any).showNotification = (notification: Omit<Notification, 'id' | 'timestamp'>) => {
    useNotificationStore.getState().addNotification(notification);
  };
}
