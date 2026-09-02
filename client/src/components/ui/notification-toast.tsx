import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle, ExternalLink } from 'lucide-react';
import { useNotificationStore, Notification } from '@/lib/notification-store';
import { Button } from './button';

export function NotificationToast() {
  const { notifications, removeNotification } = useNotificationStore();

  return (
    <div className="fixed top-20 right-6 z-[9999] flex flex-col gap-3 pointer-events-none max-w-md">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </div>
  );
}

interface NotificationItemProps {
  notification: Notification;
  onClose: () => void;
}

function NotificationItem({ notification, onClose }: NotificationItemProps) {
  const { type, title, message, action } = notification;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      default:
        return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'success':
        return 'border-l-green-500';
      case 'error':
        return 'border-l-red-500';
      case 'warning':
        return 'border-l-yellow-500';
      default:
        return 'border-l-blue-500';
    }
  };

  return (
    <div
      className={`
        pointer-events-auto
        bg-background/95 backdrop-blur-md
        border border-border ${getBorderColor()} border-l-4
        rounded-lg shadow-2xl
        p-4 pr-3
        min-w-[320px] max-w-md
        animate-in slide-in-from-right-5 duration-300
        hover:shadow-3xl transition-shadow
      `}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground mb-1">{title}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>

          {/* Action Button */}
          {action && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 h-7 text-xs px-2"
              onClick={() => {
                action.onClick();
                onClose();
              }}
            >
              {action.label}
              <ExternalLink className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 hover:bg-muted rounded p-1 transition-colors"
          aria-label="Close notification"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
