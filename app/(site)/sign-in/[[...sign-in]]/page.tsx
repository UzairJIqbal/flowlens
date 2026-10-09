import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { CLERK_FORM } from "@/app/_components/clerk-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <SignIn appearance={CLERK_FORM} />;
}
