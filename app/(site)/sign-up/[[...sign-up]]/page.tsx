import { SignUp } from "@clerk/nextjs";
import { CLERK_FORM } from "@/app/_components/clerk-form";

export default function SignUpPage() {
  return <SignUp appearance={CLERK_FORM} />;
}
