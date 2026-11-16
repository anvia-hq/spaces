# 0032 — Tracing that ships with the server, not with a vendor

- **Status:** accepted
- **Date:** 2026-11-16

## Context

A request that feels slow on this server can be slow in five different places: the HTTP layer, the
database, `msb` running on the host, a microVM booting, or the guest executing a command. Nothing
records which. The audit log (0031) says a delete took 79 ms; it cannot say how much of that was
Postgres and how much was the driver.

The usual answer is an OpenTelemetry SDK pointed at a collector (Jaeger, Tempo, Honeycomb). That is the
wrong default here: spaces is a self-hosted server on one machine, and "install a collector to see your
own traces" is the same mistake as requiring a queue to read a log. But the _instrumentation_ should be
standard, so the same traces can go anywhere if the operator wants.

Constraints: no external collector required, traces queryable per user, request ids already exist and
must correlate with the audit log, storage must not grow without bound, and the driver seam (0007) is
where the interesting durations are — it must be instrumented without editing 40 methods by hand.

## Options

**A. OpenTelemetry API + SDK, with a custom span exporter into Postgres, and an optional OTLP exporter.**
Instrument with `tracer.startActiveSpan` (standard API, standard attributes), let `sdk-trace-base`
handle context propagation and batching, and write finished spans through a `SpanExporter` that inserts
into the same database everything else lives in. `SPACES_OTLP_ENDPOINT` adds a second exporter when the
operator has a collector. Retention is a sweep in the existing reaper loop.

**B. Hand-rolled spans (start/finish helpers writing rows) with no OpenTelemetry dependency.**
Fewer moving parts, but every instrumentation call site becomes spaces-specific, context propagation
across `await` has to be hand-managed (an `AsyncLocalStorage` of parents), and the "same traces
anywhere" promise disappears — an OTLP export would have to be written from scratch as well.

**C. Instrument only at the HTTP layer (a duration per request).**
Trivial, and answers none of the questions above: it cannot separate driver from database, and
provisioning/stop/snapshot — the multi-second work — would stay opaque.

## Decision

**A.** In detail:

- Dependencies are the OpenTelemetry _libraries_, not a hosted SDK: `@opentelemetry/api`,
  `sdk-trace-base`, `context-async-hooks`, `resources`, and `exporter-trace-otlp-http` (only used when
  the endpoint is configured).
- `modules/traces` owns the provider, the Postgres exporter, the read service and the routes. The
  provider is created once at boot with `AsyncLocalStorageContextManager`, a `BatchSpanProcessor`
  (2 s), and a sampler from `SPACES_TRACE_SAMPLE_RATE` (default `1`).
- **HTTP**: one `http.request` span per request, carrying `spaces.request_id`, the route template, the
  status and the actor kind. It is the parent of everything else in the request.
- **Driver**: the driver module returns a proxy over `SandboxDriver` that wraps every async method in a
  span (`driver.create`, `driver.exec`, …) with the sandbox id. One file, forty methods covered, and no
  service knows tracing exists.
- **Database**: the store is wrapped the same way (`db.sandbox.list`, `db.command.insert`, …), so a
  span measures the query and the mapping.
- **Lifecycle**: provisioning, stop, resume, fork and snapshot get their own spans around the
  multi-step work (`sandbox.provision`, `sandbox.stop`, …), so the phases are visible and their
  durations are the "sandbox lifecycle durations" the metrics need.
- **Storage**: a `spans` table (trace id, span id, parent, name, kind, start/end, duration, status,
  attributes `jsonb`, `request_id`, `owner_id`), one index per access path, written through one
  function. Read API: `GET /api/v1/traces` (recent traces, filters) and `GET /api/v1/traces/:traceId`
  (the span tree), scoped per user like everything else (0028).
- **Retention**: `SPACES_TRACE_RETENTION_DAYS` (default 7) swept by the reaper every few minutes, so an
  unconfigured server does not fill its disk with its own telemetry.
- **Correlation**: the audit log's `request_id` and the trace's `spaces.request_id` are the same value,
  and the console links one to the other.
- **Metrics**: computed from spans at query time — request rate, error rate, p50/p95 latency and the
  lifecycle durations — which is honest for this scale and needs no second store. Rollups are the next
  step if the table ever gets big enough to care.

## Consequences

- A self-hosted deployment gets traces with no extra service, and the same spans can be shipped to a
  collector by setting one variable.
- The `spans` table is the largest thing this server writes: roughly one row per request plus one per
  driver call and per query. That is why retention is on by default and why the export is batched.
- A proxy around the driver and the store is indirection: stack traces gain a frame and a debugger
  shows wrapper functions. The alternative was 80 hand-edited call sites.
- Trace queries are scoped by owner, so a user sees their own requests. The operator key sees
  everything, including system spans (the reaper), which have no owner.
- Attributes are capped (a few KB per span, long strings truncated) so a command's output can never
  become a span attribute.

## Alternatives ruled out

- **An OTel collector as a requirement.** Same reasoning as 0025's "one process": the server should
  answer its own questions.
- **Journal-only timing logs.** Not queryable, not scoped, and gone after a rotation.
- **`sdk-node`.** It pulls in Node-specific auto-instrumentation this Bun process does not use; the
  base SDK plus three small packages is the same behaviour without the weight.
