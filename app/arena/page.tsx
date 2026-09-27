import type { Metadata } from "next";
import Arena from "@/components/arena/Arena";

export const metadata: Metadata = {
  title: "Arena · swarmem",
  description: "Memorable flows compete on unseen companies; certification decides which runs pass; Jev judges the flows that mostly pass.",
};

export const dynamic = "force-dynamic";

export default function ArenaPage() {
  return (
    <main className="page">
      <header className="masthead">
        <div>
          <p className="mono faint" style={{ margin: "0 0 6px" }}>
            <a href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="brandMark brandMark--sm" src="/swarmem-logo.png" alt="" aria-hidden="true" /> ←
              swar<em className="brandMem">mem</em>
            </a>
            {" · "}
            <a href="/battle">Flow Fighter: battle mode →</a>
          </p>
          <h1>Arena</h1>
          <p className="northStar">
            Memorable flows compete: each flow is handed to fresh agents on unseen companies. The certification
            engine decides <strong>deterministically</strong> which runs pass; flows that mostly pass reach the
            final, where Jev judges the flows themselves. The champion flow becomes the company&apos;s trusted
            procedure.
          </p>
        </div>
      </header>
      <Arena />
    </main>
  );
}
