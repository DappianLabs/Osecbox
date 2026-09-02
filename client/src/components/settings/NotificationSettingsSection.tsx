import React from 'react';
import { Bell } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface NotificationSettingsSectionProps {
  settings: any;
  updateSetting: (key: string, value: any) => void;
}

export function NotificationSettingsSection({ settings, updateSetting }: NotificationSettingsSectionProps) {
  return (
    <section id="settings-notifications" className="mb-8 scroll-mt-8">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-primary/30">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Bell className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Notifications</h2>
          <p className="text-xs text-muted-foreground">Configure notification preferences</p>
        </div>
      </div>
      <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border shadow-lg">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="scanCompleteNotifications" className="text-foreground font-semibold">Scan Complete Notifications</Label>
            <p className="text-xs text-muted-foreground">Get notified when scans finish</p>
          </div>
          <Switch
            id="scanCompleteNotifications"
            checked={settings.scanCompleteNotifications ?? true}
            onCheckedChange={(checked) => updateSetting('scanCompleteNotifications', checked)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="vulnerabilityNotifications" className="text-foreground font-semibold">Vulnerability Alerts</Label>
            <p className="text-xs text-muted-foreground">Get notified when vulnerabilities are found</p>
          </div>
          <Switch
            id="vulnerabilityNotifications"
            checked={settings.vulnerabilityNotifications ?? true}
            onCheckedChange={(checked) => updateSetting('vulnerabilityNotifications', checked)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="soundEnabled" className="text-foreground font-semibold">Sound Effects</Label>
            <p className="text-xs text-muted-foreground">Play sounds for notifications</p>
          </div>
          <Switch
            id="soundEnabled"
            checked={settings.soundEnabled ?? false}
            onCheckedChange={(checked) => updateSetting('soundEnabled', checked)}
          />
        </div>
      </div>
    </section>
  );
}
