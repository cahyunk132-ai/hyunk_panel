import type { Metadata, Viewport } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { Toaster } from '@/components/ui/Toaster';
import { NavigationProgress } from '@/components/layout/NavigationProgress';
import { buildAppearanceInitScript } from '@/lib/appearance/init-script';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'HYUNK PANEL',
    template: '%s · HYUNK PANEL',
  },
  description: 'One Panel. Every Node. Every Server.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0f1117',
  width: 'device-width',
  initialScale: 1,
};

// Inline script anti-flash: menerapkan tema & appearance sebelum halaman tergambar.
const APPEARANCE_INIT_SCRIPT = buildAppearanceInitScript();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script id="hyunk-appearance-init" dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen font-sans text-ink">
        <NavigationProgress />
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
        <SpeedInsights />
      </body>
    </html>
  );
}
