export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-base p-4">
      {/* dekorasi latar */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(600px 300px at 20% 10%, rgba(62,207,207,0.07), transparent), radial-gradient(500px 260px at 85% 90%, rgba(62,207,207,0.05), transparent)',
        }}
      />
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}
