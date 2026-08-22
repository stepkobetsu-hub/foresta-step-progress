# V3 staging validation trigger

This branch exists only to trigger the isolated V3 staging deployment workflow.
It must not be merged into production. The workflow explicitly checks out `agent/step-progress-v3-implementation` and deploys only `step-progress-v3-staging`.
