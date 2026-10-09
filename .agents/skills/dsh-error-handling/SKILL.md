---
name: dsh-error-handling
description: Design and review DeepSeek Harness error handling. Use when adding or changing thrown errors, failure results, catch blocks, retries, recovery, background-task failure handling, or user-visible error reports. Covers typed errors, localized actionable messages, handling ownership, fault containment, and guarantees after failure.
---

# DeepSeek Harness Error Handling

Define how callers identify a failure, who decides its disposition, what state remains valid, and how affected users learn about it. Apply these rules to the changed operation and its consumers; preserve existing package dependencies and error representations instead of introducing a parallel error framework.

## Typed, structured failures

- Errors raised by owned code must carry a declared type and a stable machine-readable discriminant, with typed details needed for handling. Do not introduce message-only `new Error(...)`, thrown strings, or decisions based on parsing your own error messages. Expected failures returned as values need discriminated result types too.
- Reuse the package's error taxonomy. [HarnessError](../../../packages/llm/llm/src/error.ts) provides a stable `code` and standard `cause`; do not add a dependency cycle merely to inherit it. A compatible package-owned representation is valid, as illustrated by [attachment errors](../../../packages/attachment/attachment/README.md).
- Preserve the original cause when translating external failures into domain errors. Normalize untyped dependency failures at the owning integration; do not invent a specific diagnosis when the cause is unknown. Across process, wire, or persistence interfaces, preserve the declared failure fields through the existing serialization format; do not rely on `instanceof` surviving transport.
- Keep machine identity separate from display text. Codes, typed parameters, and diagnostic causes serve different consumers; a localized sentence is not an error identifier. Do not serialize secrets or expose unrestricted internal diagnostics to users.

## Responsibility and guarantees before implementation

For each failure category, establish the following in the owning API's JSDoc or package README where callers need it. Keep rationale and extended examples out of local comments.

| Subject | Required decision |
|---|---|
| Failure definition | Which component defines the meaning, discriminant, and handling-relevant details? |
| Handling owner | Which layer has the context and authority to recover, terminate, or escalate? |
| Containment boundary | Which operation, task, instance, or process may be affected, and what mechanism limits the effects? |
| Failure guarantee | Which invariants remain valid? Are effects absent, partial, committed, or unknown? What cleanup remains necessary? |
| Reporting owner | Who publishes the terminal status and user-visible report, including if the normal presenter fails? |

A low-level component specifies its own guarantees and cleans up its resources; it need not know a concrete upper-layer catch function. The caller or application composition assigns final disposition. Background tasks need an observer and reporting owner before they start; returning to the caller does not discharge those responsibilities.

## Catch, recover, or stop

- A catch must recover, clean up and propagate, translate and propagate, or terminate and report. Logging alone is not recovery. Catch expected failures narrowly; an unexpected defect must not become an ordinary success or an empty result.
- Continue only when the preconditions for subsequent work still hold. Roll back, compensate, or discard affected state as required. If state validity cannot be established, stop dependent work and invalidate the instance or escalate to its supervisor. Unaffected work may continue only when actual isolation supports it.
- A try/catch limits propagation of an exception, not mutation of shared state. Use resource ownership, transactions, rollback, instance disposal, or process isolation to enforce the declared containment. Apply the [dispatcher and teardown rules](../../../docs/defensive-patterns.md) to their lifecycle responsibilities.
- Retry only when operation semantics and current effects make repetition safe, with cancellation and an explicit retry owner. Finite operations need an attempt or time budget. Long-lived supervision or reconnection may continue under an explicit lifecycle, with backoff, per-attempt limits, and observable degraded status. A timeout may mean the remote operation committed; reconcile the result or use supported idempotency before repeating it. An error code alone does not establish retry safety.
- Expected cancellation has its own outcome. It is neither success nor automatically a fatal defect; partial or unknown effects still require cleanup, disposition, and reporting. Preserve both the original failure and cleanup failures rather than hiding one with the other.

## Localized, actionable, visible reports

Every final human-facing error report must be localized, readable, and actionable. Use the receiving application's locale mechanism; Client UI follows the [locale-owned copy rule](../../notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md). Map structured identity to a summary, affected operation, and safe next action. Keep raw causes as separately accessible, appropriately redacted diagnostics; an untranslated exception message alone is not the report. Unknown codes still need a localized fallback that admits uncertainty and offers a safe next step.

**Untrusted state or an unknown outcome must never fail silently.** Stop work that depends on that state and explicitly report what is affected, what is known or uncertain, what the system has done, and what the user can safely do next. Never claim rollback, unchanged data, success, or safe retry without the corresponding guarantee.

- **Interactive UI:** show the failure where the affected operation or component is visible. A persistent invalid or unknown state needs a persistent notice or unavailable state; a disappearing toast or background log is insufficient. Follow [UI feedback placement](../dsh-client-ui-ux/SKILL.md#feedback-surfaces).
- **CLI:** emit a readable diagnostic and fail the invocation with a nonzero exit status. A long-running command must expose the affected operation's failed status even when its host remains running.
- **Unattended tasks and services:** emit an error record through a default-enabled channel accessible to the user or operator, and expose failed, unknown, or unavailable task/component status for inspection. Disabled debug logs do not satisfy this requirement.

Assign a reporting fallback outside the failed component, such as host stderr or an independent fatal-error presenter. Reporting failure must not turn the original operation into success or cause an unbounded reporting loop. Machine-oriented logs may retain stable codes and raw diagnostic text; the explanation presented to a human still requires localized context and next steps.

For example, a timed-out remote save with an unknown result must report uncertainty and suspend dependent writes until reconciliation. Direct the user to check the operation's authoritative status; a stale read or a still-running write cannot establish that retry is safe.

## Verification

Trace representative failures from the producer through the actual consumer to the final status and report. Test structured identity across any affected serialization, state validity after partial effects, cleanup, retry budgets or supervisor lifecycle, cancellation, and the visible report in supported locales. Include unexpected failures, unknown outcomes, and a failed normal reporter when those paths apply. Assert that dependent work stops and that no success signal is published; asserting only that an exception was caught or a logger was called is insufficient. Use the existing [testing policy](../../../docs/testing.md) for the relevant unit, integration, and output evidence.

## Conceptual references

- Bertrand Meyer, *Object-Oriented Software Construction*, second edition (1997): exception handling in relation to routine contracts, invariants, retry, and failure propagation.
- Herb Sutter, *Exceptional C++* (1999): exception safety guarantees distinguish valid state and resource cleanup from rollback of observable effects.
- Joe Armstrong, [*Making reliable distributed systems in the presence of software errors*](https://www.erlang.org/download/armstrong_thesis_2003.pdf) (2003), and [OTP supervision principles](https://www.erlang.org/doc/system/sup_princ.html): isolation and an explicit supervisor responsible for recovery.
