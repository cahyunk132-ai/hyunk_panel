import { AppearanceSettings } from '@/components/theme/AppearanceSettings';

export const metadata = { title: 'Appearance' };

export default function AppearanceSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Appearance</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Sesuaikan tema, latar, efek glass, aksen, dan ukuran font. Tersimpan otomatis di browser ini.
        </p>
      </div>
      <AppearanceSettings />
    </div>
  );
}
