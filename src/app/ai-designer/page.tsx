import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AIDesigner from "@/components/AIDesigner";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function AIDesignerPage() {
  // Server render = auth check only. The systems list is loaded in the
  // client component so navigation to this page never waits on a DB call.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-7xl mx-auto p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-magic-ink">
            AI Quotation Designer
          </h1>
          <p className="text-sm text-magic-ink/70">
            Pick a system, describe the project in a sentence, and the AI will
            generate a bill of quantities from the live catalog. Items are added
            to your quotation draft.
          </p>
        </header>
        <AIDesigner user={user} />
      </main>
    </div>
  );
}
