import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.08fr_1fr]">
      {/* ── LEFT — vibrant branded showcase (hidden on small screens) ── */}
      <aside className="relative hidden overflow-hidden lg:block">
        {/* Gradient base */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, #ff4d3d 0%, #E2231A 24%, #a3123a 52%, #4a1236 76%, #180a1c 100%)",
          }}
        />
        {/* Blurred colour blobs for depth */}
        <div
          aria-hidden
          className="absolute -left-24 -top-24 h-96 w-96 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, #ff7a45, transparent 65%)" }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 left-1/3 h-[26rem] w-[26rem] rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, #8b5cf6, transparent 65%)" }}
        />
        {/* Fine grid texture */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            maskImage: "radial-gradient(ellipse at 60% 40%, black 20%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse at 60% 40%, black 20%, transparent 75%)",
          }}
        />

        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          {/* Logo */}
          <div className="w-[230px] xl:w-[260px]">
            <Image
              src="/logo.png"
              alt="MagicTech"
              width={680}
              height={200}
              priority
              className="h-auto w-full object-contain brightness-0 invert drop-shadow-lg"
            />
          </div>

          {/* Headline + floating analytics mockup */}
          <div className="relative max-w-lg">
            <h1 className="text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white xl:text-5xl">
              Data Analytics &amp;
              <br />
              Quotation Platform
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
              Sales, presales, pricing and execution — from the first RFQ to the
              delivered job, in one workspace.
            </p>

            {/* Floating glass dashboard preview */}
            <div className="relative mt-12 h-[230px]">
              {/* main card */}
              <div className="absolute left-0 top-2 w-[340px] rotate-[-3deg] rounded-2xl border border-white/20 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-white/80">
                    Revenue Analysis
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    Live
                  </span>
                </div>
                <div className="flex items-center gap-5">
                  {/* donut */}
                  <svg viewBox="0 0 120 120" className="h-24 w-24 flex-shrink-0">
                    <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="14" />
                    <circle
                      cx="60"
                      cy="60"
                      r="44"
                      fill="none"
                      stroke="#2dd4bf"
                      strokeWidth="14"
                      strokeLinecap="round"
                      strokeDasharray="199 277"
                      transform="rotate(-90 60 60)"
                    />
                    <text x="60" y="58" textAnchor="middle" fontSize="20" fontWeight="700" fill="#fff" fontFamily="ui-monospace,monospace">72%</text>
                    <text x="60" y="74" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.6)">landed</text>
                  </svg>
                  <div className="space-y-3">
                    <div>
                      <p className="font-mono text-2xl font-bold leading-none text-white">7,084</p>
                      <p className="mt-1 text-[11px] text-white/60">JOD revenue</p>
                    </div>
                    <div>
                      <p className="font-mono text-lg font-bold leading-none text-teal-300">14.4%</p>
                      <p className="mt-1 text-[11px] text-white/60">net margin</p>
                    </div>
                  </div>
                </div>
                {/* mini bars */}
                <div className="mt-4 flex items-end gap-1.5">
                  {[40, 62, 48, 78, 90, 66, 100].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-sm bg-white/25"
                      style={{ height: `${h * 0.36}px`, background: i === 6 ? "#2dd4bf" : undefined }}
                    />
                  ))}
                </div>
              </div>

              {/* floating pills */}
              <div className="absolute right-4 top-0 rotate-[4deg] rounded-xl border border-white/25 bg-white/15 px-3.5 py-2 shadow-xl backdrop-blur-md">
                <p className="text-[10px] text-white/60">Markup on cost</p>
                <p className="font-mono text-sm font-bold text-white">π ⁄ C · 20.0%</p>
              </div>
              <div className="absolute bottom-0 right-16 rotate-[-2deg] rounded-xl border border-white/25 bg-white/15 px-3.5 py-2 shadow-xl backdrop-blur-md">
                <p className="text-[10px] text-white/60">Top 2 SKUs</p>
                <p className="font-mono text-sm font-bold text-teal-200">86.3% of R</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] uppercase tracking-[0.3em] text-white/40">
            MagicTech · Secure Access
          </p>
        </div>
      </aside>

      {/* ── RIGHT — clean sign-in ── */}
      <section className="relative flex items-center justify-center bg-gradient-to-b from-white to-slate-50 px-6 py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(60% 40% at 50% 0%, rgba(226,35,26,0.05), transparent 70%)" }}
        />

        <div className="relative z-10 w-full max-w-[400px]">
          <div className="mb-8 flex justify-center lg:hidden">
            <Image src="/logo.png" alt="MagicTech" width={400} height={120} priority className="h-auto w-[200px] object-contain" />
          </div>

          <div className="mb-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Sign in
            </span>
            <h2 className="mt-4 text-[30px] font-bold tracking-tight text-slate-900">
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
