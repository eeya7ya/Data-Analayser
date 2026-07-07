import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ *
 * Showcase content — kept as small data + presentational helpers so the
 * left panel fills its space with purpose instead of dead air.
 * ------------------------------------------------------------------ */

type Feature = { title: string; desc: string; icon: ReactNode };

const FEATURES: Feature[] = [
  {
    title: "RFQ → Quotation",
    desc: "Turn incoming requests into priced quotes in minutes.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12h6m-6 4h4m4 5H7a2 2 0 01-2-2V5a2 2 0 012-2h6l6 6v10a2 2 0 01-2 2z"
      />
    ),
  },
  {
    title: "Live pricing",
    desc: "Real-time margins, costs and approvals as you build.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 7h8m0 0v8m0-8l-9 9-4-4-6 6"
      />
    ),
  },
  {
    title: "Presales & execution",
    desc: "From the first proposal to the delivered job.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    ),
  },
  {
    title: "Secure by design",
    desc: "Role-based access, every action fully audited.",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    ),
  },
];

const TRUST: { label: string; icon: ReactNode }[] = [
  {
    label: "Encrypted",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    ),
  },
  {
    label: "Role-based",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m10-3a4 4 0 10-4-4m-6 4a4 4 0 118 0 4 4 0 01-8 0z"
      />
    ),
  },
  {
    label: "Audited",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    ),
  },
];

/** A single feature highlight in the left showcase grid. */
function FeatureCard({ title, desc, icon }: Feature) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 backdrop-blur-sm transition-colors hover:border-white/20 hover:bg-white/[0.07]">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#E2231A]/15 text-[#ff6b63]">
        <svg
          className="h-[18px] w-[18px]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.9}
        >
          {icon}
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-white/50">{desc}</p>
      </div>
    </div>
  );
}

/** Small glass metric tile that echoes the dashboard mock's live-analytics feel. */
function GlassStat({
  value,
  label,
  accent = false,
  className = "",
}: {
  value: string;
  label: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/15 bg-white/10 px-4 py-3 shadow-xl backdrop-blur-xl ${className}`}
    >
      <p
        className={`font-mono text-lg font-bold ${
          accent ? "text-teal-300" : "text-white"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/50">
        {label}
      </p>
    </div>
  );
}

/** Small inline trust badge shown beneath the sign-in card. */
function TrustBadge({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/45">
      <svg
        className="h-3.5 w-3.5 text-emerald-400/70"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        {icon}
      </svg>
      {label}
    </span>
  );
}

/** Small live-analytics mockup shown in the desktop showcase panel. */
function DashboardMock() {
  return (
    <div className="w-[330px] rotate-[-3deg] rounded-2xl border border-white/20 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/80">
          Revenue Analysis
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Live
        </span>
      </div>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 120 120" className="h-20 w-20 flex-shrink-0">
          <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="14" />
          <circle cx="60" cy="60" r="44" fill="none" stroke="#2dd4bf" strokeWidth="14" strokeLinecap="round" strokeDasharray="199 277" transform="rotate(-90 60 60)" />
          <text x="60" y="65" textAnchor="middle" fontSize="18" fontWeight="700" fill="#fff" fontFamily="ui-monospace,monospace">72%</text>
        </svg>
        <div>
          <p className="font-mono text-xl font-bold text-white">7,084</p>
          <p className="text-[11px] text-white/60">JOD revenue</p>
          <p className="mt-2 font-mono text-base font-bold text-teal-300">14.4%</p>
          <p className="text-[11px] text-white/60">net margin</p>
        </div>
      </div>
      <div className="mt-4 flex h-10 items-end gap-1.5">
        {[40, 62, 48, 78, 90, 66, 100].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{ height: `${h}%`, background: i === 6 ? "#2dd4bf" : "rgba(255,255,255,0.25)" }}
          />
        ))}
      </div>
    </div>
  );
}

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b0d12] lg:grid lg:grid-cols-[1.1fr_0.9fr]">
      {/* One dark canvas behind everything */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 55% at 18% 30%, rgba(226,35,26,0.30), transparent 60%)," +
            "radial-gradient(40% 40% at 60% 85%, rgba(99,102,241,0.14), transparent 60%)," +
            "radial-gradient(45% 45% at 92% 18%, rgba(6,182,212,0.10), transparent 60%)," +
            "linear-gradient(160deg, #15171e 0%, #0b0d12 58%, #070809 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          maskImage: "radial-gradient(ellipse at 32% 45%, black 25%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse at 32% 45%, black 25%, transparent 78%)",
        }}
      />

      {/* LEFT — showcase (desktop only). A full-height, three-band layout
          (brand · story · live proof) that spreads top-to-bottom and reaches
          across the column so no dead space is left between it and the card. */}
      <aside className="relative z-10 hidden flex-col justify-between gap-8 p-10 xl:p-14 2xl:p-16 lg:flex lg:border-r lg:border-white/[0.06]">
        <Image
          src="/logo.png"
          alt="MagicTech"
          width={680}
          height={200}
          priority
          className="w-[230px] object-contain brightness-0 invert"
        />

        <div className="space-y-8">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E2231A]" />
              MagicTech Workspace
            </span>
            <h2 className="mt-5 text-[2.7rem] font-bold leading-[1.08] tracking-tight text-white xl:text-5xl">
              Data Analytics &amp;
              <br />
              Quotation Platform
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/60">
              Sales, presales, pricing and execution — from the first RFQ to the
              delivered job, in one connected workspace.
            </p>
          </div>

          <div className="grid max-w-xl grid-cols-2 gap-3.5">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="flex items-end gap-6">
            <DashboardMock />
            <div className="mb-2 hidden animate-mt-float flex-col gap-3 xl:flex">
              <GlassStat value="1.2k+" label="Quotes issued" className="rotate-[2deg]" />
              <GlassStat value="32" label="Active RFQs" accent className="rotate-[-1.5deg]" />
            </div>
          </div>
          <span className="text-[11px] uppercase tracking-[0.3em] text-white/25">
            MagicTech · Secure Access
          </span>
        </div>
      </aside>

      {/* RIGHT (desktop) / full (mobile) — centered framed sign-in card with
          supporting trust badges so the column reads as a complete panel. */}
      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-8 p-6 sm:p-10 lg:min-h-0">
        {/* Mobile-only logo above the card */}
        <Image
          src="/logo.png"
          alt="MagicTech"
          width={680}
          height={200}
          priority
          className="w-[220px] object-contain brightness-0 invert lg:hidden"
        />

        <div className="w-full max-w-[400px] rounded-3xl border border-white/10 bg-white p-8 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.7)] sm:p-9">
          <div className="mb-7 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Sign in
            </span>
            <h1 className="mt-4 text-[26px] font-bold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Enter your credentials to continue.
            </p>
          </div>

          <LoginForm />

          <p className="mt-7 text-center text-[11px] text-slate-400">
            Protected workspace · role-based &amp; audited.
          </p>
        </div>

        {/* Trust badges fill the space around the card and reinforce security. */}
        <div className="flex items-center gap-5">
          {TRUST.map((b) => (
            <TrustBadge key={b.label} {...b} />
          ))}
        </div>
      </section>
    </main>
  );
}
