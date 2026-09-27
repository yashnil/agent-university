import Link from "next/link";
import ArtifactCard from "@/components/ArtifactCard";
import CompositeRun from "@/components/CompositeRun";
import ArtifactChip from "@/components/ArtifactChip";
import GapBanner from "@/components/GapBanner";
import LifecycleTimeline from "@/components/LifecycleTimeline";
import ModeSwitch from "@/components/ModeSwitch";
import PipelineStrip from "@/components/PipelineStrip";
import RegistryPanel from "@/components/RegistryPanel";
import RulingsPanel from "@/components/RulingsPanel";
import SkillStatusChip from "@/components/SkillStatusChip";
import TransferExam from "@/components/TransferExam";
import { isolationFacts, loadLifecycle, type DemoCaseId, type Mode, type Outcome } from "./_lib/data";

// Fixtures and the registry are read from disk per request.
export const dynamic = "force-dynamic";

const SCHEMA: Record<string, "frozen" | "v0-placeholder"> = {
  "company.json": "frozen",
  "repo_analysis.json": "v0-placeholder",
  "score.json": "v0-placeholder",
  "outreach.md": "v0-placeholder",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; outcome?: string; case?: string; run?: string }>;
}) {
  const params = await searchParams;
  const mode: Mode = params.mode === "live" ? "live" : "demo";
  const outcome: Outcome = params.outcome === "failed" ? "failed" : "certified";
  const demoCase: DemoCaseId = params.case === "vercel" ? "vercel" : "northwind";
  const data = await loadLifecycle(mode, outcome, demoCase);

  const skill = data.skillCertified ?? data.skillObserved;
  // Three states the page must never blur: certified (a decision was made and it passed), awaiting
  // certification (the trial passed but nobody promoted it), and withheld (the trial failed).
  const trialPassed = data.transfer.passed && data.transfer.verification.passed;
  const certified = data.certification ? data.certification.certified : skill.status === "certified";
  const awaiting = !certified && trialPassed;
  const teacherCase =
    data.cases.find((c) => c.role === "teacher" && c.skillId === data.skillObserved.id)?.id ?? "origin case";
  const steps = data.plan?.steps ?? [];
  const certifiedSteps = steps.filter((s) => s.status === "certified").length;
  const scenarioHref = (next: Outcome) =>
    `/?mode=${data.mode}&case=${demoCase}&outcome=${next}`;

  return (
    <main className="page">
      <h1 className="pageTitle">Certification record</h1>

      <div className="controls">
        <ModeSwitch mode={data.mode} demoCase={demoCase} outcome={outcome} source={data.source} />
        <div className="scenario">
          <p className="scenarioLegend">Scenario</p>
          <p className="scenarioLinks">
            <Link href={scenarioHref("certified")} aria-current={outcome === "certified" ? "true" : undefined}>
              certified run
            </Link>
            <span className="sep" aria-hidden="true"> · </span>
            <Link href={scenarioHref("failed")} aria-current={outcome === "failed" ? "true" : undefined}>
              failed trial
            </Link>
          </p>
        </div>
      </div>

      {data.liveNote ? (
        <div className="notice">
          <span className="tag tag--muted">note</span>
          <span>{data.liveNote}</span>
        </div>
      ) : null}

      <section className="section">
        <div className="sectionHead">
          <span className="sectionNum">01</span>
          <h2>Lifecycle</h2>
        </div>
        <LifecycleTimeline events={data.events} status={skill.status} />
      </section>

      <section className="section">
        <div className="sectionHead">
          <span className="sectionNum">02</span>
          <h2>Transfer trial</h2>
        </div>
        <TransferExam
          transfer={data.transfer}
          teacher={data.skillObserved.teacher}
          teacherCase={teacherCase}
          isolation={
            data.certification
              ? data.certification.rulings.map((r) => ({ name: r.rule, passed: r.passed, detail: r.reason }))
              : isolationFacts(data)
          }
        />
        {data.certification ? (
          <div className="stack">
            <p className="policyLine mono muted">
              policy {data.certification.policyId} ·{" "}
              {data.certification.requireIsolation
                ? "isolation facts required, not merely recorded"
                : "isolation facts recorded but not required"}
            </p>
            <RulingsPanel
              policyId={data.certification.policyId}
              summary={data.certification.summary}
              certified={data.certification.certified}
              rulings={data.certification.rulings}
              decidedAt={data.certification.decidedAt}
              inputsDigest={data.certification.inputsDigest}
            />
          </div>
        ) : null}
      </section>

      <section className="section">
        <div className="sectionHead">
          <span className="sectionNum">03</span>
          <h2>{certified ? "Certified capability" : awaiting ? "Awaiting certification" : "Capability withheld"}</h2>
          <SkillStatusChip status={skill.status} />
        </div>
        {data.metrics ? (
          <dl className="kv metrics">
            {data.metrics.durationMs !== undefined ? (
              <>
                <dt>trial duration</dt>
                <dd>{(data.metrics.durationMs / 1000).toFixed(1)}s</dd>
              </>
            ) : null}
            {data.metrics.toolCalls !== undefined ? (
              <>
                <dt>tool calls</dt>
                <dd>{data.metrics.toolCalls}</dd>
              </>
            ) : null}
            {data.metrics.turns !== undefined ? (
              <>
                <dt>turns</dt>
                <dd>{data.metrics.turns}</dd>
              </>
            ) : null}
            {data.metrics.costUsd !== undefined ? (
              <>
                <dt>cost</dt>
                <dd>${data.metrics.costUsd.toFixed(3)}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        <div className="grid2">
          <ArtifactCard title="Skill record" json={skill} badge={<SkillStatusChip status={skill.status} />} open />
          <ArtifactCard
            title={`${data.transfer.artifact.type} — produced by the replicating agent`}
            path={data.transfer.artifact.path}
            json={data.artifacts.company}
            badge={
              <ArtifactChip
                name={data.transfer.artifact.type}
                schemaStatus={SCHEMA[data.transfer.artifact.type] ?? "unknown"}
                state={data.transfer.verification.passed ? "certified" : "missing"}
              />
            }
          />
        </div>
      </section>

      <section className="section">
        <div className="sectionHead">
          <span className="sectionNum">04</span>
          <h2>The registry</h2>
        </div>
        <RegistryPanel
          rows={data.registry?.rows ?? []}
          source={data.registry?.source ?? "registry/index.json (not present)"}
        />
      </section>

      <section className="section">
        <div className="sectionHead">
          <span className="sectionNum">05</span>
          <h2>Composition, and the gap</h2>
        </div>
        {data.composite ? (
          <CompositeRun mode={data.mode} fallback={data.composite} autoRun={params.run === "1"} />
        ) : null}
        <div className="stack">
          <PipelineStrip steps={steps} missingArtifactType={data.gap?.missingArtifactType} />
        </div>
        {data.gap ? <GapBanner gap={data.gap} /> : null}
        <div className="grid2 stack">
          <ArtifactCard
            title="repo_analysis.json"
            json={data.artifacts.repoAnalysis}
            badge={<ArtifactChip name="repo_analysis.json" schemaStatus="v0-placeholder" state="missing" />}
          />
          <ArtifactCard
            title="score.json"
            json={data.artifacts.score}
            badge={<ArtifactChip name="score.json" schemaStatus="v0-placeholder" state="missing" />}
          />
          <ArtifactCard
            title="outreach.md"
            markdown={data.artifacts.outreach}
            badge={<ArtifactChip name="outreach.md" schemaStatus="v0-placeholder" state="missing" />}
          />
        </div>
      </section>

      <footer className="footer">
        Reading <span className="mono">{data.source}</span>
        {data.certification ? (
          <>
            {" "}· decision <span className="mono">{data.certification.from}</span>
          </>
        ) : null}
        . Contracts: <span className="mono">schemas/contracts/*.schema.json</span> ⇄{" "}
        <span className="mono">lib/types.ts</span>, checked by <span className="mono">npm test</span>.
        Demo fiction reads committed fixtures only — no agent runtime, no secrets, no network.
      </footer>
    </main>
  );
}
