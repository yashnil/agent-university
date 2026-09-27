"use client";

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { BattleState, FighterState } from "@/lib/battle/types";
import Fighter from "./Fighter";
import styles from "./Victory.module.css";

export interface VictoryProps {
  state: BattleState;
  onRematch: () => void;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const slugOf = (procedureId: string) =>
  procedureId.replace(/^procedures\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);

interface RulingView {
  rule: string;
  passed: boolean;
  reason: string;
}

function rulingsOf(record: unknown): RulingView[] {
  const decision = obj(obj(record)?.decision);
  const raw = decision?.rulings;
  if (!Array.isArray(raw)) return [];
  const out: RulingView[] = [];
  for (const r of raw) {
    const o = obj(r);
    if (!o) continue;
    out.push({ rule: str(o.rule) ?? "rule", passed: o.passed === true, reason: str(o.reason) ?? "" });
  }
  return out;
}

function passRateOf(f: FighterState): number | null {
  return f.runs > 0 ? f.certified / f.runs : null;
}

export default function Victory({ state, onRematch }: VictoryProps): JSX.Element | null {
  const [flowOpen, setFlowOpen] = useState(false);
  // Focus REMATCH without scrolling the overlay to the bottom (autoFocus would hide the champion header).
  const rematchRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    rematchRef.current?.focus({ preventScroll: true });
  }, []);
  const champId = state.champion;
  const champ: FighterState | null = champId ? state.fighters[champId] ?? null : null;

  const record = obj(state.championRecord);
  const proc = obj(state.procedure);
  const rulings = rulingsOf(state.championRecord);
  const decision = obj(record?.decision);
  const summary = str(decision?.summary);

  const procedureId = str(proc?.procedureId) ?? str(record?.procedureId) ?? champ?.def.id ?? champId ?? "";
  const title = str(proc?.title) ?? champ?.def.title ?? "";
  const name = champ?.def.name ?? (title ? title.toUpperCase().slice(0, 16) : "CHAMPION");
  const shortId = champ?.def.shortId ?? (procedureId ? procedureId.replace(/^procedures\//, "").slice(0, 8) : "");

  const runs = num(proc?.runs) ?? champ?.runs ?? 0;
  const certified = num(proc?.certified) ?? champ?.certified ?? 0;
  const passRate = num(proc?.passRate) ?? (runs > 0 ? certified / runs : null);
  const judge = obj(proc?.judge);
  const score = num(judge?.score) ?? champ?.score ?? null;
  const rationale = str(judge?.rationale) ?? champ?.rationale ?? null;
  const judgeModel = str(judge?.model) ?? state.referee?.model ?? null;

  const won = champId ? state.matches.filter((m) => m.winner === champId) : [];
  const byKo = won.filter((m) => m.decidedBy === "ko").length;
  const byJudges = won.filter((m) => m.decidedBy === "judges").length;
  const byWalkover = won.filter((m) => m.decidedBy === "walkover").length;

  const flow = str(proc?.flow);
  const skillId = str(proc?.skillId) ?? str(obj(record?.skill)?.id);
  const recordPath = `registry/procedures/${skillId ?? "<skill>"}/${procedureId ? slugOf(procedureId) : "<slug>"}.json`;
  const registry = state.registry;

  const accent = champ?.def.palette.aura ?? "#ffd23f";

  return (
    <div className={styles.overlay} role="dialog" aria-label="Victory: trusted flow" style={{ ["--champ" as string]: accent }}>
      <div className={styles.rays} aria-hidden />
      <div className={styles.scan} aria-hidden />
      <div className={styles.panel}>
        <header className={`${styles.head} ${champ ? styles.headHero : ""}`}>
          {champ ? (
            <div className={styles.hero} aria-hidden>
              <div className={styles.podium} />
              <Fighter def={champ.def} pose="victory" side="left" hp={Math.max(champ.hp, 1)} action={null} className={styles.heroFighter} />
            </div>
          ) : null}
          <div className={styles.headText}>
            <div className={styles.kicker}>WINNER · FLOW FIGHTER</div>
            <h1 className={styles.title} data-text="TRUSTED FLOW">TRUSTED FLOW</h1>
            <div className={styles.nameRow}>
              <span className={styles.name}>{name}</span>
              {shortId ? <span className={styles.shortId}>#{shortId}</span> : null}
            </div>
            {title && title.toUpperCase() !== name ? <div className={styles.fullTitle}>{title}</div> : null}
            {procedureId ? <code className={styles.procId}>{procedureId}</code> : null}
          </div>
        </header>

        <section className={styles.stats}>
          <Stat label="PASS RATE" value={pct(passRate)} tone="green" />
          <Stat label="CERTIFIED RUNS" value={`${certified}/${runs}`} tone="cyan" />
          <Stat label="JEV SCORE" value={score === null ? "—" : `${score}/10`} tone="gold" />
          <Stat
            label="MATCHES WON"
            value={`${won.length}`}
            sub={`${byKo} K.O. · ${byJudges} JUDGES${byWalkover ? ` · ${byWalkover} W/O` : ""}`}
            tone="pink"
          />
        </section>

        <div className={styles.grid}>
          <section className={styles.card}>
            <h2 className={styles.cardHead}>
              REFEREE&apos;S VERDICT{judgeModel ? <span className={styles.dim}> · {judgeModel}</span> : null}
            </h2>
            <blockquote className={styles.verdict}>
              {rationale ?? state.referee?.line ?? "The judges have spoken: this flow held up under fire."}
            </blockquote>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardHead}>
              CERTIFICATION
              {rulings.length ? (
                <span className={styles.dim}>
                  {" "}
                  · {rulings.filter((r) => r.passed).length}/{rulings.length} RULES
                </span>
              ) : null}
            </h2>
            {summary ? <div className={styles.summary}>{summary}</div> : null}
            {rulings.length ? (
              <ul className={styles.rulings}>
                {rulings.map((r, i) => (
                  <li key={`${r.rule}-${i}`} className={r.passed ? styles.pass : styles.fail} style={{ animationDelay: `${0.35 + i * 0.08}s` }}>
                    <span className={styles.mark} aria-label={r.passed ? "passed" : "failed"}>
                      {r.passed ? "✓" : "✗"}
                    </span>
                    <span className={styles.rule}>{r.rule}</span>
                    {r.reason ? <span className={styles.reason}>{r.reason}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.dim}>No certification record for the best run.</div>
            )}
          </section>
        </div>

        {flow ? (
          <section className={styles.card}>
            <button type="button" className={styles.flowToggle} onClick={() => setFlowOpen((o) => !o)} aria-expanded={flowOpen}>
              <span className={styles.caret} data-open={flowOpen ? "1" : "0"}>▶</span> THE FLOW
              <span className={styles.dim}> · what the agents were taught</span>
            </button>
            {flowOpen ? <pre className={styles.flow}>{flow}</pre> : null}
          </section>
        ) : null}

        {state.order.length ? (
          <section className={styles.card}>
            <h2 className={styles.cardHead}>RESULTS</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>FIGHTER</th>
                    <th>PASS RATE</th>
                    <th>JEV</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {state.order.map((id) => {
                    const f = state.fighters[id];
                    if (!f) return null;
                    const isChamp = id === champId;
                    return (
                      <tr key={id} className={isChamp ? styles.champRow : undefined}>
                        <td>
                          <span className={styles.swatch} style={{ background: f.def.palette.aura }} />
                          {f.def.name} <span className={styles.dim}>#{f.def.shortId}</span>
                        </td>
                        <td>
                          {pct(passRateOf(f))} <span className={styles.dim}>({f.certified}/{f.runs})</span>
                        </td>
                        <td>{f.score === null ? "—" : `${f.score}/10`}</td>
                        <td>
                          {isChamp ? (
                            <span className={styles.tagWin}>CHAMPION</span>
                          ) : f.eliminated ? (
                            <span className={styles.tagOut}>ELIMINATED</span>
                          ) : (
                            <span className={styles.dim}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <footer className={styles.foot}>
          <div className={styles.saved}>
            {state.dry ? (
              <>
                <span className={styles.dryTag}>DRY RUN</span> saved to a throwaway registry (dry run)
                {registry ? <code className={styles.path}>{registry}</code> : null}
              </>
            ) : (
              <>
                SAVED TO <code className={styles.path}>{registry ? `${registry.replace(/\/+$/, "")}/` : ""}{recordPath}</code>
              </>
            )}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.rematch} onClick={onRematch} ref={rematchRef}>
              REMATCH
            </button>
            {!state.dry ? (
              <a className={styles.link} href="/?mode=live">
                Open lifecycle page →
              </a>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "green" | "cyan" | "gold" | "pink" }) {
  return (
    <div className={`${styles.stat} ${styles[tone]}`}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
      {sub ? <div className={styles.statSub}>{sub}</div> : null}
    </div>
  );
}

export { Victory };
