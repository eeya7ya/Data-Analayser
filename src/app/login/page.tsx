import { redirect } from "next/navigation";
import Image from "next/image";
import { FileText, Users, Boxes, ShieldCheck } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";
import LoginBackground from "@/components/LoginBackground";

export const dynamic = "force-dynamic";

/** Highlights shown on the brand panel — quick "why this workspace" cues. */
const HIGHLIGHTS = [
  {
    icon: FileText,
    title: "Quotations & pricing",
    desc: "Build, price and send professional quotations in minutes.",
  },
  {
    icon: Users,
    title: "Clients & pipeline",
    desc: "Every company, contact and deal tracked end to end.",
  },
  {
    icon: Boxes,
    title: "Catalogue & projects",
    desc: "Stock, catalogue and project handoffs in one hub.",
  },
];

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#06080f] px-5 py-10 text-white">
      {/* Background is composed from modular layers — see LoginBackground. */}
      <LoginBackground />

      <div className="relative z-10 grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        {/* ── LHS — Brand showcase ── */}
        <aside className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <Image
            src="/logo.png"
            alt="MagicTech"
            width={680}
            height={200}
            priority
            className="h-auto w-[220px] object-contain drop-shadow-[0_12px_40px_rgba(226,35,26,0.45)] sm:w-[260px] lg:w-[320px]"
          />

          <div className="mt-6 flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-transparent via-[#E2231A]/70 to-[#E2231A]" />
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-white/70">
              CRM System
            </p>
            <span className="h-px w-8 bg-gradient-to-l from-transparent via-[#E2231A]/70 to-[#E2231A] lg:hidden" />
          </div>

          <h1 className="mt-6 max-w-md text-balance text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
            Run every quote, client and project from{" "}
            <span className="bg-gradient-to-r from-[#ff6a60] via-[#ff3d32] to-[#E2231A] bg-clip-text text-transparent">
              one workspace
            </span>
            .
          </h1>

          {/* Feature highlights — desktop only, to keep mobile focused. */}
          <ul className="mt-8 hidden w-full max-w-md space-y-4 lg:block">
            {HIGHLIGHTS.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-[#ff6a60] backdrop-blur-sm">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">{title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-white/50">
                    {desc}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── RHS — Glass sign-in card ── */}
        <section className="flex justify-center lg:justify-end">
          <div className="relative w-full max-w-[420px]">
            {/* Soft brand glow behind the card. */}
            <div
              aria-hidden
              className="absolute -inset-px rounded-3xl bg-gradient-to-b from-[#E2231A]/25 via-transparent to-[#6366F1]/20 blur-md"
            />
            <div className="relative rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-9">
              <div className="mb-7 text-center lg:text-left">
                <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  Welcome back
                </h2>
                <p className="mt-2 text-sm text-white/55">
                  Sign in to your MagicTech workspace.
                </p>
              </div>

              <LoginForm />

              <div className="mt-7 flex items-center justify-center gap-2 text-[11px] font-medium tracking-wide text-white/40">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/70" />
                Secure, encrypted sign-in
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
