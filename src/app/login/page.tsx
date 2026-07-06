import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

const HIGHLIGHTS: Array<{ title: string; desc: string; icon: React.ReactNode }> = [
  {
    title: "CRM & Pipeline",
    desc: "Companies, clients and the full quote-to-delivery board.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M3 12h18M3 17h10" />
    ),
  },
  {
    title: "Smart Pricing",
    desc: "Per-manufacturer sheets with landed-cost and margin analysis.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m4 14V9m4 10V7m4 12v-6m4 6V4" />
    ),
  },
  {
    title: "Execution",
    desc: "Distribute work, track checklists and execution reports.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    ),
  },
];

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ── LEFT — branded showcase (dark, hidden on small screens) ── */}
      <aside className="relative hidden overflow-hidden bg-[#0b0f1a] lg:block">
        {/* Depth layers */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 120% at 15% 0%, #1a2036 0%, #0b0f1a 55%, #070a12 100%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(50% 45% at 22% 30%, rgba(226,35,26,0.22), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "46px 46px",
            maskImage:
              "radial-gradient(ellipse at 30% 40%, black 30%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at 30% 40%, black 30%, transparent 78%)",
          }}
        />

        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          <div className="w-[240px] xl:w-[280px]">
            <Image
              src="/logo.png"
              alt="MagicTech"
              width={680}
              height={200}
              priority
              className="h-auto w-full object-contain drop-shadow-[0_10px_36px_rgba(226,35,26,0.45)]"
            />
          </div>

          <div className="max-w-md">
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white xl:text-[2.7rem]">
              Data Analytics &amp;
              <br />
              Quotation Platform
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-white/55">
              One workspace for sales, presales, pricing and project execution —
              from the first RFQ to the delivered job.
            </p>

            <ul className="mt-10 space-y-5">
              {HIGHLIGHTS.map((h) => (
                <li key={h.title} className="flex items-start gap-4">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-[#ff6a60]">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      {h.icon}
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white/90">{h.title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-white/45">{h.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] uppercase tracking-[0.3em] text-white/30">
            MagicTech · Secure Access
          </p>
        </div>
      </aside>

      {/* ── RIGHT — sign-in (light) ── */}
      <section className="relative flex items-center justify-center bg-gradient-to-b from-white to-slate-50 px-6 py-12">
        {/* Faint brand wash behind the card */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 40% at 50% 0%, rgba(226,35,26,0.05), transparent 70%)",
          }}
        />

        <div className="relative z-10 w-full max-w-[400px]">
          {/* Mobile logo (left panel is hidden below lg) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Image
              src="/logo.png"
              alt="MagicTech"
              width={400}
              height={120}
              priority
              className="h-auto w-[200px] object-contain"
            />
          </div>

          <div className="mb-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Sign in
            </span>
            <h2 className="mt-4 text-[28px] font-bold tracking-tight text-slate-900">
              Welcome back
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Enter your credentials to access your workspace.
            </p>
          </div>

          <LoginForm />

          <p className="mt-8 text-center text-xs text-slate-400">
            Protected workspace · Access is role-based and audited.
          </p>
        </div>
      </section>
    </main>
  );
}
