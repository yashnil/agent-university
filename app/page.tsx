import ArtifactCard from "@/components/ArtifactCard";
import GapBanner from "@/components/GapBanner";
import LifecycleTimeline from "@/components/LifecycleTimeline";
import ModeSwitch from "@/components/ModeSwitch";
import PipelineStrip from "@/components/PipelineStrip";
import RegistryPanel from "@/components/RegistryPanel";
import RulingsPanel from "@/components/RulingsPanel";
import SkillStatusChip from "@/components/SkillStatusChip";
import TransferExam from "@/components/TransferExam";
import { isolationFacts, loadLifecycle, type DemoCaseId, type Mode, type Outcome } from "./_lib/data";

// The page reads fixtures (and, in live mode, the registry or runtime record) from disk per request.
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; outcome?: string; case?: string }>;
}) {
  const params = await searchParams;
  const mode: Mode = params.mode === "live" ? "live" : "demo";
  const requestedOutcome: Outcome = params.outcome === "failed" ? "failed" : "certified";
  const requestedCase: DemoCaseId = params.case === "vercel" ? "vercel" : "northwind";
  const data = await loadLifecycle(mode, requestedOutcome, requestedCase);
  const q = (next: Record<string, string>) =>
    "?" + new URLSearchParams({ mode: data.mode, outcome: requestedOutcome, case: requestedCase, ...next }).toString();

  const skill = data.skillCertified ?? data.skillObserved;
  // Three distinct states, and the page must never blur them: certified (a decision was made and
  // it passed), awaiting certification (the trial passed but nobody has promoted it — where runtime
  // hands off), and withheld (the trial ran and failed).
  const examPassed = data.transfer.passed && data.transfer.verification.passed;
  const certified = data.certification ? data.certification.certified : skill.status === "certified";
  const awaitingCertification = !certified && examPassed;
  const teacherCase =
    data.cases.find((c) => c.role === "teacher" && c.skillId === data.skillObserved.id)?.id ?? "teacher case";
  const steps = data.plan?.steps ?? [];
  const certifiedSteps = steps.filter((step) => step.status === "certified").length;

  return (
    <main className="page">
      <header className="masthead">
        <div>
          <div className="wordmark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="brandMark"
              src="/swarmem-logo.png"
              alt=""
              width={52}
              height={52}
              aria-hidden="true"
            />
            <h1>
              swar<em className="brandMem">mem</em>
            </h1>
          </div>
          <p className="northStar">
            One agent learns → <strong>another agent proves it</strong> → every agent can inherit it. A
            procedure becomes trusted organizational capability only once a <em>different</em> agent has
            reproduced it on an unseen task and a deterministic verifier has signed off.
          </p>
        </div>
        <div>
          <ModeSwitch mode={data.mode} source={data.source} />
          <p className="mono faint" style={{ margin: "8px 0 0", textAlign: "right" }}>
            case:{" "}
            <a href={q({ case: "vercel" })}>real run (Linear → Vercel)</a>
            {" · "}
            <a href={q({ case: "northwind" })}>fictional lifecycle</a>
            {data.fromRealRun ? (
              <>
                {" "}
                <span className="badge badge--info">real QM run</span>
              </>
            ) : null}
          </p>
          <p className="mono faint" style={{ margin: "6px 0 0", textAlign: "right" }}>
            <a href="/arena">Arena: run a tournament →</a>
          </p>
        </div>
      </header>

      {data.liveNote ? (
        <div className="notice">
          <span className="badge badge--warn">note</span>
          <span>{data.liveNote}</span>
        </div>
      ) : null}

      <section className="section">
        <div className="sectionHead">
          <span className="sectionNum">01</span>
          <h2>Lifecycle</h2>
        </div>
        <p className="sectionSub">
          Every state change is an event on the frozen contract. The skill only advances through{" "}
          <SkillStatusChip status="observed" /> <SkillStatusChip status="transferred" />{" "}
          <SkillStatusChip status="certified" /> by evidence — there is no manual promotion, and no{" "}
          <code className="mono">exam.failed</code> event: a failed trial simply leaves the skill at{" "}
          <code className="mono">transferred</code>.
        </p>
        <LifecycleTimeline events={data.events} status={skill.status} />
      </section>

      <section className="section">
        <div className="sectionHead">
          <span className="sectionNum">02</span>
          <h2>Transfer trial</h2>
          <span className="mono faint">
            <a href={q({ outcome: "certified" })}>certified run</a>
            {" · "}
            <a href={q({ outcome: "failed" })}>failed trial</a>
          </span>
        </div>
        <p className="sectionSub">
          The origin agent&apos;s procedure was captured, then recalled by a different agent in a new
          scope, session and sandbox. The replicating agent never saw the origin&apos;s answer — it got
          the generalized procedure and an unseen company, nothing else.
          {data.fromRealRun
            ? " Every fact below comes from the real QM run, sanitized: the isolation checks are the ones the runtime actually performed."
            : null}
        </p>
        <TransferExam
          transfer={data.transfer}
          teacher={data.skillObserved.teacher}
          teacherCase={teacherCase}
          isolation={
            data.certification
              ? data.certification.rulings.map((ruling) => ({
                  name: ruling.rule,
                  passed: ruling.passed,
                  detail: ruling.reason,
                }))
              : isolationFacts(data)
          }
        />
        {data.certification ? (
          <p className="mono faint" style={{ margin: "16px 0 0" }}>
            policy {data.certification.policyId} ·{" "}
            {data.certification.requireIsolation
              ? "isolation facts required, not just recorded"
              : "isolation facts recorded but not required"}
          </p>
        ) : null}
        {data.certification ? (
          <div style={{ marginTop: 16 }}>
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
          <h2>
            {certified
              ? "Certified capability"
              : awaitingCertification
                ? "Awaiting certification"
                : "Capability withheld"}
          </h2>
          <SkillStatusChip status={skill.status} />
        </div>
        <p className="sectionSub">
          {certified ? (
            <>
              The record every other agent inherits: skill <code className="mono">{skill.id}</code> produces{" "}
              <code className="mono">{skill.artifactType}</code>, learned from {skill.teacher.name} and
              replicated by {data.transfer.student.name} on{" "}
              <code className="mono">{data.transfer.examCase}</code>.
            </>
          ) : awaitingCertification ? (
            <>
              The trial passed and the verifier agreed, but nothing is inherited yet: skill{" "}
              <code className="mono">{skill.id}</code> is at <code className="mono">{skill.status}</code>{" "}
              until the certification engine applies its policy. Proving and promoting are separate on
              purpose — the agent that ran the trial does not get to rule on its own result.
            </>
          ) : (
            <>
              The trial ran but did not certify, so nothing is inherited: skill{" "}
              <code className="mono">{skill.id}</code> stays at{" "}
              <code className="mono">{skill.status}</code> and no agent may treat it as trusted capability.
            </>
          )}
        </p>
        {data.certification?.metrics ? (
          <dl className="kv" style={{ marginBottom: 16 }}>
            {data.certification.metrics.durationMs !== undefined ? (
              <>
                <dt>trial duration</dt>
                <dd>{(data.certification.metrics.durationMs / 1000).toFixed(1)}s</dd>
              </>
            ) : null}
            {data.certification.metrics.toolCalls !== undefined ? (
              <>
                <dt>tool calls</dt>
                <dd>{data.certification.metrics.toolCalls}</dd>
              </>
            ) : null}
            {data.certification.metrics.turns !== undefined ? (
              <>
                <dt>turns</dt>
                <dd>{data.certification.metrics.turns}</dd>
              </>
            ) : null}
            {data.certification.metrics.costUsd !== undefined ? (
              <>
                <dt>cost</dt>
                <dd>${data.certification.metrics.costUsd.toFixed(3)}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        <div className="grid2">
          <ArtifactCard
            title="Skill record"
            json={skill}
            badge={<SkillStatusChip status={skill.status} />}
            open
          />
          <ArtifactCard
            title={`${data.transfer.artifact.type} (produced by the replicating agent)`}
            path={data.transfer.artifact.path}
            json={data.artifacts.company}
            badge={
              <span className={`badge ${data.transfer.verification.passed ? "badge--pass" : "badge--fail"}`}>
                {data.transfer.verification.passed ? "verifier passed" : "verifier rejected"}
              </span>
            }
          />
        </div>
      </section>

      <section className="section">
        <div className="sectionHead">
          <span className="sectionNum">04</span>
          <h2>The registry</h2>
        </div>
        <p className="sectionSub">
          Certification is only worth something if it is written down where every agent can find it.
          This is the committed registry — the organization&apos;s answer to &ldquo;what do we actually
          trust?&rdquo; — written only by a promotion, never by a run.
        </p>
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
        <p className="sectionSub">
          A fresh agent plans the full pipeline from certified skills alone — {certifiedSteps} of{" "}
          {steps.length} steps are backed by one. Where none exists, the system reports a gap instead of
          improvising: the honest edge of what the organization can actually trust.
        </p>
        <PipelineStrip steps={steps} missingArtifactType={data.gap?.missingArtifactType} />
        {data.gap ? <GapBanner gap={data.gap} /> : null}
        <div className="grid2" style={{ marginTop: 16 }}>
          <ArtifactCard
            title="repo_analysis.json"
            json={data.artifacts.repoAnalysis}
            badge={<span className="badge badge--fail">uncertified</span>}
          />
          <ArtifactCard
            title="score.json"
            json={data.artifacts.score}
            badge={<span className="badge badge--fail">uncertified</span>}
          />
          <ArtifactCard
            title="outreach.md"
            markdown={data.artifacts.outreach}
            badge={<span className="badge badge--fail">uncertified</span>}
          />
        </div>
      </section>

      <footer className="footer">
        Data source: <span className="mono">{data.source}</span>
        {data.certification ? (
          <>
            {" "}· decision: <span className="mono">{data.certification.from}</span>
          </>
        ) : null}
        . Contracts: <span className="mono">schemas/contracts/*.schema.json</span> ⇄{" "}
        <span className="mono">lib/types.ts</span>, checked by <span className="mono">npm test</span>. Demo
        mode reads committed fixtures only — no QM, no secrets, no network.
      </footer>
    </main>
  );
}
