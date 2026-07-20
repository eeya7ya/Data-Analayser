import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import ChangePasswordClient from "@/components/ChangePasswordClient";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <ChangePasswordClient
      displayName={user.display_name || user.username}
      forced={user.mustChangePassword}
    />
  );
}
