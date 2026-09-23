# Research

- Decision: same-hand `mergeSnapshot` transition, after `syncStickyWinnerReveal`; observe next hand in `onSnapshot` before existing defer. Rationale: disposable passenger in existing reveal; changing WINNER_REVEAL_MS or scheduling gameplay is prohibited.
- Decision: royal from `mapRevealedShowdownCards` plus board through existing evaluator; board-only royal is provable too. Rationale: never inspect hidden opponent cards; category alone cannot distinguish royal from other straight flushes.
- Decision: sum per-recipient `presentation.pots[].recipients`, only main/side with at least two eligible users. Rationale: totals/payouts include returns; split recipients must be checked individually. Missing buy-in skips pot effect.
- Decision: no live streak. Snapshot/patch version proves ordering, not complete sequence of settled outcomes across reconnect. Alternative new history/WS fields rejected by scope.
- Decision: layered CSS with existing locally hosted chip art; no new raster assets. Rationale: small payload and bounded mobile work, no dependency/download overhead.
- Decision: skip late effects, 1800 ms dramatic plus 400 ms ring-only exit; no abbreviated full hero. Rationale: simplest explicit deadline guarantee.
