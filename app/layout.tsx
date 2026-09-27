import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "swarmem",
  description:
    "One agent learns, another agent proves it, every agent can inherit it: certified skill transfer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
