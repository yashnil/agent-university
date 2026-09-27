# Seeded stand-ins for the composite run

`repo_analysis-vercel.json` and `score-vercel.json` are **hand-written demo fixtures**. They stand
in for the Analyze Repository and Evaluate Opportunity skills, which are not implemented live and
are **not certified**. The composite run (`lib/composite.ts`) labels every step that uses one as
`source: "fixture"`, `status: "uncertified"`, `inherited: false`. Nothing here is agent output.
