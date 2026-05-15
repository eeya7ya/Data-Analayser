import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b0f1a] text-white">
      {/* ── Looping video background ── */}
      <video
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden
      >
        <source src="/login-bg.mp4" type="video/mp4" />
      </video>
      {/* Tint + grid overlay so the form stays readable on any frame */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0b0f1a]/70 via-[#0b0f1a]/55 to-[#0b0f1a]/85" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 40%, transparent 75%)",
        }}
      />

      {/* ── Centered card ── */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">
        <section className="w-full max-w-[420px]">
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-white/30 via-white/10 to-transparent"
            />
            <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-7 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] backdrop-blur-2xl sm:p-9">
              <div className="mb-7 flex flex-col items-center text-center">
                <Image
                  src="/logo.png"
                  alt="MagicTech"
                  width={680}
                  height={200}
                  priority
                  className="h-auto w-[240px] object-contain drop-shadow-[0_10px_30px_rgba(226,35,26,0.35)] sm:w-[280px]"
                />
                <p className="mt-3 text-sm font-semibold uppercase tracking-[0.25em] text-white/70">
                  CRM System
                </p>
              </div>

              <LoginForm />

              <div className="mt-6 flex items-center justify-center gap-3 text-[11px] text-white/40">
                <span className="h-px w-8 bg-white/15" />
                <span>SECURE LOGIN</span>
                <span className="h-px w-8 bg-white/15" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
