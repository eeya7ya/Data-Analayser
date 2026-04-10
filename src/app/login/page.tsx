import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/designer");
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2">
            <span className="text-5xl font-black text-magic-red tracking-tight">
              Magic
            </span>
            <span className="text-5xl font-black text-magic-ink tracking-tight">
              Tech
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-500 font-medium">
            Data Analytics & Quotation Platform
          </p>
        </div>
        <LoginForm />
        <p className="mt-8 text-center text-xs text-slate-400">
          &copy; {new Date().getFullYear()} MagicTech. All rights reserved.
        </p>
      </div>
    </main>
  );
}
