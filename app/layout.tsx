import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Flowlens",
  description: "A dependency map of a public GitHub repository.",
};

// Clerk's components read the same tokens as the app, so they follow the
// theme control without a second theme system.
const clerkAppearance = {
  variables: {
    colorBackground: "var(--background)",
    colorForeground: "var(--foreground)",
    colorMutedForeground: "var(--muted)",
    colorPrimary: "var(--accent)",
    colorDanger: "var(--danger)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorNeutral: "var(--foreground)",
    fontFamily: "var(--font-geist-sans)",
    fontSize: "13px",
    borderRadius: "4px",
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans text-[13px]">
        <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
