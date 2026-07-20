import { redirect } from "next/navigation";
import { Inter, Archivo, Cairo } from "next/font/google";
import { getSessionUser } from "@/lib/auth";
import LoginClient from "@/components/LoginClient";

export const dynamic = "force-dynamic";

// Self-hosted at build time (no runtime Google Fonts request) and exposed to the
// login CSS module as variables. Inter = UI, Archivo = the italic wordmark
// display face, Cairo = the Arabic face for the عربي toggle.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const archivo = Archivo({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-archivo",
  display: "swap",
});
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
  display: "swap",
});

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    // A must-change account has to set its own password before anything else.
    redirect(user.mustChangePassword ? "/change-password" : "/");
  }
  return (
    <LoginClient className={`${inter.variable} ${archivo.variable} ${cairo.variable}`} />
  );
}
