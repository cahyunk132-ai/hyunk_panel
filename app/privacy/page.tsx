import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy untuk HYUNK PANEL.',
};

const LAST_UPDATED = 'October 10, 2026';
const CONTACT_EMAIL = 'admin@wangstore.web.id';
const PANEL_URL = 'http://panel.wangstore.web.id';

const sections: { title: string; body: React.ReactNode[] }[] = [
  {
    title: '1. Information We Collect',
    body: [
      'We collect information you provide when registering, including your email address and password. We also collect server activity logs generated through use of the Service.',
    ],
  },
  {
    title: '2. How We Use Your Information',
    body: [
      'We use your information solely to provide and maintain the Service, including managing your game servers, processing backups, and authenticating your account.',
    ],
  },
  {
    title: '3. Third-Party Services',
    body: [
      'To enable the Auto Backup feature, you may connect third-party cloud storage services (Google Drive, Dropbox). When you connect these services, we store encrypted OAuth access tokens on your behalf. We do not share your data with these providers beyond what is necessary to perform backups.',
    ],
  },
  {
    title: '4. Data Security',
    body: [
      'All sensitive credentials and tokens are encrypted using AES-256-GCM. We do not store plaintext passwords or access tokens.',
    ],
  },
  {
    title: '5. Data Retention',
    body: [
      'We retain your data for as long as your account is active. You may request deletion of your account and associated data by contacting us.',
    ],
  },
  {
    title: '6. Contact',
    body: [
      'If you have any questions, contact us at:',
      <a
        key="contact"
        href={`mailto:${CONTACT_EMAIL}`}
        className="font-medium text-accent transition-colors hover:text-accent-dim"
      >
        {CONTACT_EMAIL}
      </a>,
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-base px-4 py-10 sm:py-14">
      {/* dekorasi latar, sama seperti layout auth */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(600px 300px at 20% 10%, rgba(62,207,207,0.07), transparent), radial-gradient(500px 260px at 85% 90%, rgba(62,207,207,0.05), transparent)',
        }}
      />

      <main className="relative z-10 w-full max-w-[680px]">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-accent"
        >
          ← Back to Panel
        </Link>

        <article className="mt-6 rounded-2xl border border-line bg-base-850/90 p-6 shadow-card backdrop-blur sm:p-10">
          <header className="border-b border-line-soft pb-6">
            <div className="flex items-center gap-3">
              <svg className="h-9 w-9 shrink-0" viewBox="0 0 64 64" aria-hidden>
                <rect width="64" height="64" rx="14" fill="#171b26" />
                <path d="M18 16h7v12h14V16h7v32h-7V35H25v13h-7z" fill="#3ecfcf" />
              </svg>
              <span className="text-sm font-extrabold tracking-wide text-ink">HYUNK PANEL</span>
            </div>
            <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-ink">
              Privacy Policy — Hyunk Panel
            </h1>
            <p className="mt-1 text-xs text-ink-faint">Last updated: {LAST_UPDATED}</p>
          </header>

          <div className="mt-6 space-y-3 text-sm leading-relaxed text-ink-muted">
            <p>
              Hyunk Panel (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) operates the game server
              control panel available at{' '}
              <a
                href={PANEL_URL}
                className="text-accent transition-colors hover:text-accent-dim"
              >
                panel.wangstore.web.id
              </a>{' '}
              (&quot;Service&quot;).
            </p>
          </div>

          <div className="mt-8 space-y-7">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-base font-semibold text-ink">{section.title}</h2>
                <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-muted">
                  {section.body.map((item, i) => (
                    <p key={i}>{item}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </article>
      </main>
    </div>
  );
}
