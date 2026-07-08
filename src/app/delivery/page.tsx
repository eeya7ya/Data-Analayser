import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { hasModule } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import DeliveryClient from "@/components/DeliveryClient";

export const dynamic = "force-dynamic";

/**
 * /delivery — the Delivery module workspace (V1.8). The delivery team
 * (driver / manager) works the request queue here; admins can view it too.
 * Requests are raised by sales / projects from elsewhere in the app.
 */
export default async function DeliveryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = user.role === "admin" || user.role === "viewer";
  const isDelivery = isAdmin || (await hasModule(user.id, "delivery"));

  if (!isDelivery) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-2xl px-6 py-10 text-center">
          <h1 className="mb-2 text-xl font-bold text-magic-ink">Delivery</h1>
          <p className="text-sm text-magic-ink/60">
            You need a delivery role to open the delivery queue.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div>
          <div className="text-xs text-magic-ink/50">
            <Link href="/" className="hover:text-magic-red">
              Dashboard
            </Link>{" "}
            <span>→</span> Delivery
          </div>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">
            Delivery queue
          </h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Requests raised by sales and projects — schedule them, assign a
            driver, and track each one through to delivered.
          </p>
        </div>

        <DeliveryClient />
      </main>
    </div>
  );
}
