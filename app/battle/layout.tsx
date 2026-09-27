import type { ReactNode } from "react";
import { Press_Start_2P } from "next/font/google";

// Arcade display font for every /battle page. Components read it through var(--font-arcade)
// with a "Press Start 2P", ui-monospace, monospace fallback stack.
const arcade = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-arcade",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export default function BattleLayout({ children }: { children: ReactNode }) {
  return (
    <div className={arcade.variable} style={{ background: "#07060d", minHeight: "100dvh" }}>
      {children}
    </div>
  );
}
