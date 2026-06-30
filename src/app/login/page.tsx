import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";
import LoginBackground from "@/components/LoginBackground";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b0f1a] text-white">
      {/* Background is composed from modular layers — see LoginBackground. */}
      <LoginBackground />

      {/* ── Split layout: brand LHS, sign-in RHS ── */}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10 lg:px-10">
        <div className="grid w-full items-center gap-10 lg:grid-cols-2 lg:gap-16">
          {/* LHS — Logo + CRM System */}
          <aside className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="w-[260px] sm:w-[320px] lg:w-[400px] xl:w-[440px]">
              <Image
                src="/logo.png"
                alt="MagicTech"
                width={680}
                height={200}
                priority
                className="h-auto w-full object-contain drop-shadow-[0_12px_40px_rgba(226,35,26,0.45)]"
              />
            </div>
            <div className="mt-5 flex items-center gap-3">
              <span className="h-px w-10 bg-gradient-to-r from-transparent via-[#E2231A]/70 to-[#E2231A]" />
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-white/80">
                CRM System
              </p>
              <span className="h-px w-10 bg-gradient-to-l from-transparent via-[#E2231A]/70 to-[#E2231A] lg:hidden" />
            </div>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-white/55">
              Sign in to access your workspace.
            </p>
          </aside>

          {/* RHS — Sign-in (frameless, just the form on the canvas) */}
          <section className="flex justify-center lg:justify-end">
            <div className="w-full max-w-[400px]">
              <div className="mb-8 text-center lg:text-left">
                <h2 className="text-3xl font-bold tracking-tight text-white">
                  Welcome back
                </h2>
                <p className="mt-2 text-sm text-white/55">
                  Sign in to your MagicTech workspace
                </p>
              </div>

              <LoginForm />

              <div className="mt-8 flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-white/35">
                <span className="h-px flex-1 bg-white/10" />
                <span>Secure Login</span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
