import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms of Service for Hyunk Panel.',
};

const LAST_UPDATED = 'October 10, 2026';
const CONTACT_EMAIL = 'admin@wangstore.web.id';

const sections = [
  {
    title: '1. Acceptance of Terms',
    body: [
      'By accessing or using Hyunk Panel ("Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.',
    ],
  },
  {
    title: '2. Use of Service',
    body: [
      'You may use the Service only for lawful purposes. You agree not to use the Service to host illegal content, conduct DDoS attacks, or violate any applicable laws.',
    ],
  },
  {
    title: '3. Account Responsibility',
    body: [
      'You are responsible for maintaining the confidentiality of your account credentials. You are responsible for all activities that occur under your account.',
    ],
  },
  {
    title: '4. Service Availability',
    body: [
      'We strive to maintain high availability but do not guarantee uninterrupted access. We reserve the right to suspend or terminate the Service at any time.',
    ],
  },
  {
    title: '5. Backups',
    body: [
      'While we provide an Auto Backup feature, you are ultimately responsible for maintaining your own backups. We are not liable for any data loss.',
    ],
  },
  {
    title: '6. Termination',
    body: [
      'We reserve the right to suspend or terminate your account if you violate these Terms of Service.',
    ],
  },
  {
    title: '7. Changes to Terms',
    body: [
      'We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance of the new Terms.',
    ],
  },
];

export default function TermsOfServicePage() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-base px-4 py-10 sm:py-14">
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
          ← Back to Home
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
              Terms of Service — Hyunk Panel
            </h1>
            <p className="mt-1 text-xs text-ink-faint">Last updated: {LAST_UPDATED}</p>
          </header>

          <div className="mt-8 space-y-7">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-base font-semibold text-ink">{section.title}</h2>
                <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-muted">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}

            <section>
              <h2 className="text-base font-semibold text-ink">8. Contact</h2>
              <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-muted">
                <p>
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="font-medium text-accent transition-colors hover:text-accent-dim"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </p>
              </div>
            </section>
          </div>
        </article>
      </main>
    </div>
  );
}
