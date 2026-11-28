# Research

- Current workflow and `authorizeApply()` both restrict apply to OWNER. The existing Stage environment has a branch policy and no required reviewer. The WS Preview pattern reads environment protection via API and checks approval history before exposing runtime secrets to a step.
- A dedicated environment limits changes to the new apply job. Adding reviewers to `stage-automation` would also affect inspect and other operations using that environment. Keeping the OWNER-only dispatch would preserve current friction. A separate dispatch service is unnecessary.
- A dedicated environment approval plus independent fail-closed checks covers accidental loss of environment configuration. A trusted main run is the security boundary. A malicious administrator able to rewrite main or alter repository secrets is outside scope.
- GitHub approval history is available for public repositories and readable by installation tokens with Actions read. Dispatch capability and actual observed bot identity must be confirmed with the approved App before rollout. Missing capability is a rollout blocker, not grounds to use OWNER credentials.
- Avoid reruns because approval history is keyed by run ID. A fresh dispatch yields a fresh review. Keep both launcher and executor actor checks. Do not invent a second migration engine or new DB migration format.

Sources [stage workflow](https://github.com/krzysztofcal/arcadePlatform/blob/f5d1fb6ee4777d1d7180ec18786b58ba167e5ce8/.github/workflows/db-stage-apply-pr.yml), [WS Preview](https://github.com/krzysztofcal/arcadePlatform/blob/f5d1fb6ee4777d1d7180ec18786b58ba167e5ce8/.github/workflows/ws-preview-deploy.yml), [GitHub approval history](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run).
