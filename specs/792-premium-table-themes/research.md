# Research — #792 premium table art

Baseline: live main `669cfdb41f98dde8adf179445360c1916e021612`, retrieved 2026-10-09. Latest issue body supersedes the three-theme amendment; issue comments were empty at read time. Repository was obtained as the public main source archive, without Git shell commands.

- Decision: six complete packages, preserving current Classic default. Rationale: latest owner requirements explicitly include room, rail/felt, lighting, faces/backs, avatar frames and static dealer. Alternative: three felt colors is obsolete.
- Decision: existing CSS hooks and small page-local catalog. Rationale: `createCard()` already renders live rank/suit text and back classes; no need for 52 face images or another table engine. Alternatives: generic config/skin framework or persistent user preference are outside V1.
- Decision: extend `bindCelebrationPreview()` only after approval. Rationale: existing build gate verifies both `context` and `isPreview`; existing `render()` hides its container unless seated/connected. Permit art review separately from celebration execution, whose click handler already checks live eligibility.
- Decision: preserve dealer pose and hand registration. Rationale: card FX derives origin from the rendered dealer box at normalized `(0.5, 0.84)`; CSS overlays the lower artwork using `::after` clipping. A new illustration must align, not move the box.
- Decision: concept boards plus unchanged baseline at design stage; optimized per-layer exports after owner approval. Rationale: avoid committing product behavior before approval while making the six directions reviewable.
- Governance: read local SpecKit skills and templates, constitution 1.1.1, agents.md and skills.md. No `.specify/extensions.yml` was present, so there are no extension hooks to run. Setup wrappers inspect Git and generic feature context; artifacts are populated directly for this explicitly named feature directory to respect the issue's no-Git constraint. No generic tooling/ignore/dependency changes are planned.
- No technology uncertainty requires external research delegation. No Stage/WS/Production changes are planned.
