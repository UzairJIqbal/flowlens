import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { CLERK_FORM } from "@/app/_components/clerk-form";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return <SignUp appearance={CLERK_FORM} />;
}
