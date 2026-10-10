# Preview FX art contract

- Gate: `window.BUILD_INFO.context === 'deploy-preview'` and `window.BUILD_INFO.isPreview === true`; fail closed when absent.
- Entry: existing Table settings → Diagnostics → Preview FX panel. One labeled Theme select with the six owner labels and separate loading/error/applied status.
- Input: catalog ID only. No arbitrary asset URL, query-string preference or account entitlement input.
- Effect: commit one `data-preview-theme` on `#pokerTableScreen` after all required selected art has loaded. Classic removes it and invalidates pending loads. No poker state writes, persistence, new network APIs or WS messages.
- Scope: current page and local view only. Guest/spectator/demo/reconnect art access does not relax existing celebration, gift or action eligibility.
- Render: existing cards/ranks/suits and scene geometry; same art applies to scene dealing/showdown/fold card FX and revealed faces without changing privacy. Celebration `.poker-celebration__card` cards retain their existing separate treatment.
- Error/race: retain current complete art, expose text feedback, reject stale request completion, keep controls/play usable.
