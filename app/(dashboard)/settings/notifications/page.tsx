import { NotificationSettings } from '@/components/notifications/NotificationSettings';

export const metadata = { title: 'Notifications' };

export default function NotificationSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Notifications</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Atur email otomatis untuk backup, server, dan node yang perlu kamu pantau.
        </p>
      </div>
      <NotificationSettings />
    </div>
  );
}
