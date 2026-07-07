import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

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
    <main className="relative min-h-screen overflow-hidden bg-[#0b0d12] lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* One dark canvas behind everything */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 55% at 18% 30%, rgba(226,35,26,0.30), transparent 60%)," +
            "radial-gradient(45% 45% at 92% 88%, rgba(226,35,26,0.12), transparent 60%)," +
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
          maskImage: "radial-gradient(ellipse at 30% 45%, black 20%, transparent 72%)",
          WebkitMaskImage: "radial-gradient(ellipse at 30% 45%, black 20%, transparent 72%)",
        }}
      />

      {/* LEFT — showcase (desktop only): one centered, contained block so
          nothing hugs the corners and there's no dead middle space. */}
      <aside className="relative z-10 hidden flex-col justify-center gap-9 p-16 xl:px-20 lg:flex">
        <Image
          src="/logo.png"
          alt="MagicTech"
          width={680}
          height={200}
          priority
          className="w-[250px] object-contain brightness-0 invert"
        />
        <div>
          <h2 className="text-5xl font-bold leading-[1.1] tracking-tight text-white">
            Data Analytics &amp;
            <br />
            Quotation Platform
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/60">
            Sales, presales, pricing and execution — from the first RFQ to the
            delivered job.
          </p>
        </div>
        <DashboardMock />
        <span className="text-[11px] uppercase tracking-[0.3em] text-white/25">
          MagicTech · Secure Access
        </span>
      </aside>

      {/* RIGHT (desktop) / full (mobile) — centered framed sign-in card */}
      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center p-6 sm:p-10 lg:min-h-0">
        {/* Mobile-only logo above the card */}
        <Image
          src="/logo.png"
          alt="MagicTech"
          width={680}
          height={200}
          priority
          className="mb-8 w-[240px] object-contain brightness-0 invert lg:hidden"
        />

        <div className="w-full max-w-[380px] rounded-3xl border border-white/10 bg-white p-8 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.7)] sm:p-9">
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
      </section>
    </main>
  );
}
