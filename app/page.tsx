import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Hyunk Panel',
  description: 'Powerful server control panel. Manage your game servers with ease.',
};

const features = [
  {
    icon: '🖥️',
    title: 'Multi-Node Management',
    description: 'Control multiple Wings nodes from a single dashboard',
  },
  {
    icon: '💾',
    title: 'Auto Backup',
    description: 'Automatic backups to Google Drive, Dropbox, S3, SFTP, and more',
  },
  {
    icon: '⚡',
    title: 'Real-time Console',
    description: 'Live server console with WebSocket connection',
  },
];

function PanelLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Hyunk Panel logo"
    >
      <rect width="64" height="64" rx="14" fill="#171b26" />
      <path d="M18 16h7v12h14V16h7v32h-7V35H25v13h-7z" fill="#3ecfcf" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-base">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(700px 400px at 50% 10%, rgba(62,207,207,0.10), transparent 70%), radial-gradient(520px 340px at 0% 62%, rgba(62,207,207,0.035), transparent 70%), radial-gradient(520px 340px at 100% 65%, rgba(62,207,207,0.035), transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(125,135,149,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(125,135,149,0.12) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'linear-gradient(to bottom, black, transparent 85%)',
        }}
      />

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 sm:px-8 lg:px-10">
        <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-line-soft/70">
          <Link href="/" className="group flex items-center gap-2.5" aria-label="Hyunk Panel home">
            <PanelLogo className="h-8 w-8 rounded-lg shadow-glow" />
            <span className="text-xs font-extrabold tracking-[0.14em] text-ink sm:text-sm">
              HYUNK <span className="text-accent">PANEL</span>
            </span>
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-line bg-base-850/70 px-3.5 py-2 text-xs font-semibold text-ink-muted transition-colors hover:border-accent/40 hover:text-accent sm:px-4 sm:text-sm"
          >
            Sign in
          </Link>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-20 text-center sm:py-24 lg:py-28">
          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-2 rounded-[30px] bg-accent/15 blur-2xl"
            />
            <PanelLogo className="relative h-[88px] w-[88px] rounded-[20px] shadow-[0_0_0_1px_rgba(62,207,207,0.22),0_18px_70px_rgba(62,207,207,0.12)] sm:h-28 sm:w-28 sm:rounded-[26px]" />
          </div>

          <p className="mt-9 text-[10px] font-bold uppercase tracking-[0.3em] text-accent sm:text-xs">
            Game server control, simplified
          </p>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-6xl">
            Hyunk Panel
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
            Powerful server control panel. Manage your game servers with ease.
          </p>

          <div className="mt-9 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              href="/login"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-bold text-base-950 shadow-[0_8px_28px_rgba(62,207,207,0.18)] transition-all hover:-translate-y-0.5 hover:bg-[#58dddd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Get Started
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path
                  d="M4.167 10h11.666m0 0-5-5m5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <a
              href="#features"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-base-850/75 px-6 py-3 text-sm font-semibold text-ink transition-colors hover:border-accent/40 hover:bg-base-800 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Learn More
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>

          <div className="mt-11 flex items-center gap-2 text-xs text-ink-faint">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgba(62,207,207,0.8)]" />
            One Panel. Every Node. Every Server.
          </div>
        </section>

        <section
          id="features"
          aria-labelledby="features-title"
          className="scroll-mt-8 pb-20 pt-8 sm:pb-24 sm:pt-10"
        >
          <div className="mx-auto mb-9 max-w-2xl text-center sm:mb-11">
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-accent sm:text-[11px]">
              Everything you need
            </p>
            <h2 id="features-title" className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Built for your servers
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
              Powerful tools to keep your game server infrastructure running smoothly.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {features.map((feature, index) => (
              <article
                key={feature.title}
                className="group relative overflow-hidden rounded-2xl border border-line bg-base-850/80 p-6 shadow-card transition-all duration-200 hover:-translate-y-1 hover:border-accent/35 hover:bg-base-850 sm:p-7"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-accent/5 blur-2xl transition-colors group-hover:bg-accent/10"
                />
                <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-accent/15 bg-accent/5 text-2xl">
                  <span aria-hidden>{feature.icon}</span>
                </div>
                <div className="relative mt-6 flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-ink sm:text-lg">{feature.title}</h3>
                  <span className="pt-1 font-mono text-[10px] text-ink-faint">0{index + 1}</span>
                </div>
                <p className="relative mt-2 text-sm leading-relaxed text-ink-muted">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <footer className="mt-auto border-t border-line-soft py-6 sm:py-7">
          <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
            <p className="text-xs text-ink-faint">© 2026 Hyunk Panel by HYUNK</p>
            <nav aria-label="Legal" className="flex items-center gap-5 text-xs text-ink-muted">
              <Link href="/privacy" className="transition-colors hover:text-accent">
                Privacy Policy
              </Link>
              <Link href="/tos" className="transition-colors hover:text-accent">
                Terms of Service
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </main>
  );
}
