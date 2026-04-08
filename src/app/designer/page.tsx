import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SYSTEMS } from "@/lib/manifest.generated";
import Designer from "@/components/Designer";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function DesignerPage() {
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
            fill the rest from the live GitHub catalog. When the catalog can't
            answer, we escalate to Groq web-search.
          </p>
        </header>
        <Designer systems={SYSTEMS} user={user} />
      </main>
    </div>
  );
}
