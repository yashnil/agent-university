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
      <p className="lede">
        Rival procedures compete for trust. Each flow is handed to fresh agents on cases they have
        never seen; the deterministic engine rules on every result; the champion flow is promoted
        into the registry. <strong>Nothing here can certify itself.</strong>
      </p>
      <Arena />
    </main>
  );
}
