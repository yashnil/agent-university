"use client";

import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { CompositeStep } from "@/lib/composite";
import type { RunResponse } from "@/lib/product";
import GapBanner from "./GapBanner";
import MetricsPanel from "./MetricsPanel";
import styles from "./CompositeRun.module.css";

// A brand-new Intern takes the diligence task. "Assign" POSTs /api/run (the same contract the page
// was rendered with) and reveals the steps in order. If the API is unreachable the server-rendered
// result is shown instead, labelled, so the demo cannot break.

const STATUS: Record<CompositeStep["status"], { badge: string; label: string }> = {
  certified: { badge: "badge--pass", label: "certified" },
  uncertified: { badge: "", label: "uncertified" },
  missing: { badge: "badge--warn", label: "GAP" },
  blocked: { badge: "", label: "blocked" },
};

const SOURCE: Record<CompositeStep["source"], string> = {
  live: "live QM run",
  "certified-registry": "certified · registry",
  fixture: "fixture stand-in",
  gap: "no capability",
};

export default function CompositeRun({
  mode,
  fallback,
  autoRun,
}: {
  mode: "live" | "demo";
  fallback: RunResponse;
  autoRun: boolean;
}): JSX.Element {
  const [run, setRun] = useState<RunResponse | null>(autoRun ? fallback : null);
  const [shown, setShown] = useState(autoRun ? fallback.steps.length : 0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!run || shown >= run.steps.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 550);
    return () => clearTimeout(t);
  }, [run, shown]);

  async function assign() {
    setBusy(true);
    setRun(null);
    setShown(0);
    setNote(null);
    try {
      const res = await fetch(`/api/run?mode=${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRun((await res.json()) as RunResponse);
      setNote(`POST /api/run?mode=${mode}`);
    } catch (e) {
      setRun(fallback);
      setNote(`API unreachable (${e instanceof Error ? e.message : String(e)}); showing the server-rendered result`);
    } finally {
      setBusy(false);
    }
  }

  const intern = (run ?? fallback).intern;
  const recalled = (run ?? fallback).recalled;
  const done = run !== null && shown >= run.steps.length;

  return (
    <div className={styles.wrap}>
      <div className={`card ${styles.intern}`}>
        <div>
          <h3 className="cardTitle">{intern.agent.name}</h3>
          <p className="mono faint" style={{ margin: 0 }}>{intern.agent.id}</p>
        </div>
        <dl className={styles.facts}>
          <div><dt>prior runs</dt><dd className="mono">{intern.priorRuns}</dd></div>
          <div><dt>personal skills</dt><dd className="mono">{intern.personalSkills}</dd></div>
          <div>
            <dt>inherits (certified)</dt>
            <dd className="mono">
              {recalled.length ? recalled.map((r) => `${r.skillId}${r.procedureId ? ` · ${r.procedureId}` : ""}`).join(", ") : "nothing certified yet"}
            </dd>
          </div>
        </dl>
        <button type="button" className={styles.assign} onClick={assign} disabled={busy}>
          {busy ? "Running…" : run ? "Run again" : "Assign the diligence task →"}
        </button>
      </div>

      <p className={`mono faint ${styles.goal}`}>task: {fallback.goal}</p>

      {run ? (
        <ol className={styles.steps}>
          {run.steps.slice(0, shown).map((step) => (
            <li key={step.seq} className={`${styles.step} ${styles[`step--${step.status}`]}`}>
              <div className={styles.stepHead}>
                <span className={`mono ${styles.seq}`}>{step.seq}</span>
                <strong className={styles.name}>{step.skillName}</strong>
                <span className={`badge ${STATUS[step.status].badge}`}>{STATUS[step.status].label}</span>
                <span className="badge">{SOURCE[step.source]}</span>
                {step.inherited ? <span className="badge badge--info">inherited</span> : null}
              </div>
              <p className={`mono faint ${styles.io}`}>
                {step.inputs.length ? step.inputs.join(" + ") : "task"} → {step.output}
                {step.procedureId ? ` · ${step.procedureId}` : ""}
                {step.evidence ? ` · trial ${step.evidence.examCase} ${step.evidence.verification} · ${step.evidence.policy}` : ""}
              </p>
              <p className={styles.note}>{step.note}</p>
              {step.artifact ? (
                <details className={styles.artifact}>
                  <summary className="mono">{step.artifact.path}</summary>
                  <pre>{JSON.stringify(step.artifact.content, null, 2)}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {done && run ? (
        <>
          {run.gaps.map((gap) => (
            <GapBanner key={gap.payload.skillId} gap={gap.payload} />
          ))}
          {run.candidates.map((c) => (
            <div key={c.id} className={`card ${styles.candidate}`}>
              <div className={styles.stepHead}>
                <strong>New candidate: {c.name}</strong>
                <span className="badge badge--warn">candidate</span>
                <span className="badge">not certified</span>
              </div>
              <p className="mono faint" style={{ margin: "6px 0" }}>
                {c.id} · produces {c.produces} · needed by {c.neededBy.join(", ") || "the plan"} · from {c.discoveredIn}
              </p>
              <p className={styles.note}>To become trusted it must go through the same path as Research Company:</p>
              <ol className={styles.next}>
                {c.next.map((n) => <li key={n}>{n}</li>)}
              </ol>
            </div>
          ))}
          <MetricsPanel metrics={run.metrics} />
          <p className="mono faint" style={{ margin: 0 }}>
            {note ?? "server-rendered"} · {run.mode === "demo" ? "demo/fallback data" : "live registry"} · {run.source}
          </p>
        </>
      ) : null}
    </div>
  );
}
