import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { Suspense } from "react";
import type { Metadata } from "next";
import Logo from "@/components/Logo";
import ModeBadge from "@/components/ModeBadge";
import Nav from "@/components/Nav";
import "./globals.css";

// Display: Newsreader, for the wordmark, titles and verdicts. Variable, with the optical-size
// axis, so display sizes get the cut they were drawn for. Its italic is a true italic.
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-newsreader",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "swarmem",
  description:
    "Certified skill transfer: a procedure becomes trusted capability only after a different agent reproduces it on an unseen case and a deterministic verifier agrees.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <header className="siteHeader">
          <div className="siteHeaderInner">
            <Logo />
            <Nav />
            <Suspense fallback={null}>
              <ModeBadge />
            </Suspense>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
