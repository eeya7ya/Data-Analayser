import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/designer");
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-magic-soft via-white to-magic-soft p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-3">
            <span className="text-4xl font-black text-magic-red tracking-tight">
              Magic
            </span>
            <span className="text-4xl font-black text-magic-ink tracking-tight">
              Tech
            </span>
          </div>
          <p className="mt-2 text-sm text-magic-ink/70">
            AI Quotation Designer · Vercel 2026
          </p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-magic-ink/50">
          Default admin: <b>admin</b> / <b>admin123</b> — change immediately
          after first login.
        </p>
      </div>
    </main>
  );
}
