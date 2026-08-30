<!-- Write all pull request text in Simplified Technical English (ASD-STE100): short sentences, one instruction per sentence, simple approved vocabulary, and the active voice. -->

## Thinking Path

<!--
  Required. Trace your reasoning from the top of the project down to this
  specific change. Start with what Pilot is, then narrow through the
  subsystem, the problem, and why this PR exists. Use blockquote style.
  Aim for 5–8 steps. See CONTRIBUTING.md for an example.
-->

> - Pilot is the control plane for AI-agent companies
> - [Which subsystem or capability is involved]
> - [What problem or gap exists]
> - [Why it needs to be addressed]
> - This pull request ...
> - The benefit is ...

## Linked Issues or Issue Description

<!--
  Required. Pick ONE of the two paths below.

  (A) Issue exists — replace the placeholder below with your issue links.
      Tag each linked issue with `Fixes: #123`, `Closes: #123`, or `Refs: #123`.

  (B) No issue exists — describe the underlying problem here in plain terms:
      what happened, expected behavior, how to reproduce, and why it matters.
      A reviewer must be able to understand the issue without leaving the PR.
-->

-

## What Changed

<!-- Bullet list of concrete changes. One bullet per logical unit. -->

-

## Verification

<!--
  How can a reviewer confirm this works? Include test commands you ran and
  their results, or manual steps. If something could not be run, say so
  explicitly.
-->

-

## Risks

<!--
  What could go wrong? Mention migration safety, breaking changes,
  behavioral shifts, or "Low risk" if genuinely minor.
-->

-

## Model Used

<!--
  Required. Specify which AI model was used to produce or assist with
  this change: provider, exact model ID/version, context window, and any
  relevant capability details (reasoning mode, tool use). If no AI was
  used, write "None — human-authored".
-->

-

## Checklist

- [ ] Thinking path traces from project context to this change
- [ ] Model used is specified (with version and capability details)
- [ ] I searched open PRs for duplicates and linked the closest one
- [ ] Tests run locally and pass; anything not run is stated above
- [ ] Tests added or updated where applicable
- [ ] Schema/API changes are synced across db / shared / server / ui
- [ ] UI changes include before/after screenshots and pass `pnpm check:token-gates`
- [ ] Relevant documentation updated
- [ ] Risks documented above
- [ ] All CI gates are green
