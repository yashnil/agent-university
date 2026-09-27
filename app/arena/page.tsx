import type { Metadata } from "next";
import Arena from "@/components/arena/Arena";

export const metadata: Metadata = {
  title: "Arena · swarmem",
  description:
    "Memorable flows compete: each flow is handed to fresh agents on unseen cases, the certification engine rules on every result, and the champion flow becomes trusted.",
};

export const dynamic = "force-dynamic";

export default function ArenaPage() {
  return (
    <main className="page">
      <h1 className="pageTitle">Arena</h1>
      <Arena />
    </main>
  );
}
