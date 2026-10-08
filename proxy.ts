import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/__clerk(.*)",
  // The agent's lookups carry no session; the credential they carry is
  // checked by the database, which is where authorization lives anyway.
  "/api/agent/(.*)",
]);
const isSetupRoute = createRouteMatcher(["/setup"]);
const isLanding = createRouteMatcher(["/"]);

// Decided here, before any page renders: signed-out visitors never receive a
// protected page's HTML, and a signed-in person with no organization on their
// token is sent to /setup, which puts one there.
export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { userId, orgId, redirectToSignIn } = await auth();

  // The landing page is for people who haven't signed in; anyone who has
  // wants their analyses.
  if (isLanding(req)) {
    return userId ? NextResponse.redirect(new URL("/analyses", req.url)) : undefined;
  }

  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });

  if (!orgId && !isSetupRoute(req)) {
    // Carries where they were going, so a repository pasted on the landing
    // page survives sign-up and the organization being created.
    const setup = new URL("/setup", req.url);
    setup.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(setup);
  }
  if (orgId && isSetupRoute(req)) {
    return NextResponse.redirect(new URL("/analyses", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
