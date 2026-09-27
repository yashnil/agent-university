import type { Metadata } from "next";
import Arena from "@/components/arena/Arena";

export const metadata: Metadata = {
  title: "Arena · Agent University",
  description: "Run an agent tournament: fresh students take unseen exams, certification decides, Jev judges the finalists.",
};

export const dynamic = "force-dynamic";

export default function ArenaPage() {
  return (
    <main className="page">
      <header className="masthead">
        <div>
          <p className="mono faint" style={{ margin: "0 0 6px" }}>
            <a href="/">← Agent University</a>
          </p>
          <h1>Arena</h1>
          <p className="northStar">
            Fresh agents take an unseen exam from the recalled procedure. The certification engine decides who
            passes — <strong>deterministically</strong>. Jev only judges the finalists.
          </p>
        </div>
      </header>
      <Arena />
    </main>
  );
}
