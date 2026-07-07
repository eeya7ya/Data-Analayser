import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0d12] px-4 py-10">
      {/* ── Background: charcoal + on-brand red glows + grid ── */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 25% 15%, rgba(226,35,26,0.28), transparent 45%)," +
            "radial-gradient(circle at 85% 85%, rgba(226,35,26,0.14), transparent 50%)," +
            "linear-gradient(160deg, #16181f 0%, #0b0d12 58%, #070809 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, black 25%, transparent 72%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 25%, transparent 72%)",
        }}
      />
      {/* soft top glow band */}
      <div
        aria-hidden
        className="absolute left-1/2 top-0 h-72 w-[42rem] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, #E2231A, transparent 70%)" }}
      />

      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center">
        {/* Large, prominent logo */}
        <div className="mb-8 w-[300px] sm:w-[340px]">
          <Image
            src="/logo.png"
            alt="MagicTech"
            width={680}
            height={200}
            priority
            className="h-auto w-full object-contain drop-shadow-[0_10px_40px_rgba(226,35,26,0.5)]"
          />
        </div>

        {/* Glass sign-in card */}
        <div className="w-full rounded-3xl border border-white/10 bg-white/[0.055] p-8 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
          <div className="mb-6 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Sign in
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-white/50">
              Sign in to your MagicTech workspace.
            </p>
          </div>

          <LoginForm />
        </div>

        <p className="mt-6 text-center text-[11px] uppercase tracking-[0.25em] text-white/30">
          Data Analytics &amp; Quotation Platform
        </p>
      </div>
    </main>
  );
}
