import { SignIn } from "@clerk/nextjs";
import { CLERK_FORM } from "@/app/_components/clerk-form";

export default function SignInPage() {
  return <SignIn appearance={CLERK_FORM} />;
}
