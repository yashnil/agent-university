import type { Metadata } from "next";
import Battle from "@/components/battle/Battle";

export const metadata: Metadata = {
  title: "Flow Fighter · Agent University",
  description: "Type a prompt, watch Memorable flows fight it out: certified runs land hits, failed runs whiff, Jev judges, the champion becomes the trusted flow.",
};

export const dynamic = "force-dynamic";

export default function BattlePage() {
  return <Battle />;
}
