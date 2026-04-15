import { redirect } from "next/navigation";
import Image from "next/image";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/quotation");
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b0f1a] text-white">
      {/* ── Animated ambient background ── */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-[0.08]"
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
        <div className="absolute -top-40 -left-40 h-[540px] w-[540px] rounded-full bg-[#E2231A] opacity-40 blur-[120px]" />
        <div className="absolute top-1/3 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#7c3aed] opacity-25 blur-[130px]" />
        <div className="absolute -bottom-52 right-10 h-[520px] w-[520px] rounded-full bg-[#06b6d4] opacity-25 blur-[140px]" />
      </div>

      {/* ── Centered split content ── */}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-10">
        <div className="grid w-full items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 xl:gap-14">
          {/* Left: hero */}
          <aside className="flex flex-col justify-center text-center lg:text-left">
            <div className="mx-auto mb-8 w-[260px] sm:w-[300px] lg:mx-0 lg:w-[340px]">
              {/* Logo displays directly on the dark canvas — no white plate,
                  no ring, no backdrop. A subtle drop-shadow gives the
                  transparent-PNG lift so it still reads against the blobs. */}
              <Image
                src="/logo.png"
                alt="MagicTech"
                width={680}
                height={200}
                priority
                className="h-auto w-full object-contain drop-shadow-[0_10px_30px_rgba(226,35,26,0.35)]"
              />
            </div>

            <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl xl:text-6xl">
              Design winning
              <br />
              <span className="bg-gradient-to-r from-[#ff4d44] via-[#ff8a7a] to-[#ffd5ce] bg-clip-text text-transparent">
                quotations
              </span>{" "}
              in minutes.
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-white/70 lg:mx-0">
              One intelligent workspace to browse the live catalogue, assemble
              projects with AI, and deliver branded quotations your clients
              will love.
            </p>

            <ul className="mx-auto mt-7 grid max-w-md gap-3 text-sm text-white/80 lg:mx-0">
              <FeatureRow text="Live product catalogue from Supabase" />
              <FeatureRow text="AI-powered bill of quantities" />
              <FeatureRow text="Per-user folders and team collaboration" />
              <FeatureRow text="Beautiful, print-ready quotation PDFs" />
            </ul>

            <p className="mt-10 hidden text-xs text-white/40 lg:block">
              &copy; {new Date().getFullYear()} MagicTech — All rights
              reserved.
            </p>
          </aside>

          {/* Right: login card (hugs hero text on lg+) */}
          <section className="flex items-center justify-center lg:justify-start">
            <div className="w-full max-w-[380px]">
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-white/30 via-white/10 to-transparent"
                />
                <div className="relative rounded-3xl border border-white/10 bg-white/[0.04] p-7 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] backdrop-blur-2xl sm:p-8">
                  <div className="mb-6 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E2231A] to-[#7c1d18] shadow-lg shadow-[#E2231A]/30 ring-1 ring-white/20">
                      <svg
                        className="h-7 w-7 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 11c1.657 0 3-1.343 3-3S13.657 5 12 5 9 6.343 9 8s1.343 3 3 3zm0 2c-2.67 0-8 1.337-8 4v2h16v-2c0-2.663-5.33-4-8-4z"
                        />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-white">
                      Welcome back
                    </h2>
                    <p className="mt-1 text-sm text-white/60">
                      Sign in to your MagicTech workspace
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

              <p className="mt-6 text-center text-xs text-white/40 lg:hidden">
                &copy; {new Date().getFullYear()} MagicTech. All rights
                reserved.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function FeatureRow({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#E2231A] to-[#7c1d18] ring-1 ring-white/20">
        <svg
          className="h-3.5 w-3.5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
      <span>{text}</span>
    </li>
  );
}
