import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TopBar from "@/components/TopBar";
import EmailClient from "@/components/EmailClient";

export const dynamic = "force-dynamic";

export default async function EmailPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-magic-ink">Email</h1>
          <p className="text-sm text-magic-ink/70">
            Read and send from your assigned mailbox.
          </p>
        </header>
        <EmailClient />
      </main>
    </div>
  );
}
