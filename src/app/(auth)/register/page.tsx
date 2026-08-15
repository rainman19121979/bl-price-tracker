import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

/**
 * Bootstrap-only: /register ist nur erreichbar SOLANGE die DB null User hat.
 * Danach ist Selbst-Registrierung dauerhaft dicht — nur Admin kann per DB
 * (oder spaeter per Admin-CreateUser-Flow) weitere User anlegen.
 * Grund: BrickLink API TOS erlaubt keine Datenweitergabe zwischen fremden
 * BL-Accounts; die geteilte Preis-DB ist ein TOS-Risiko sobald sich fremde
 * User registrieren koennen.
 */
export default async function RegisterPage() {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    notFound();
  }
  return <RegisterForm />;
}
