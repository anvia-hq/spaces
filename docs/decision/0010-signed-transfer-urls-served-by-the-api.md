# 0010 — Signed transfer URLs are served by the API, not the guest

- **Status:** accepted
- **Date:** 2026-11-15

## Context

`download-url` / `upload-url` could hand out a link that the sandbox serves itself, but our guests
have no inbound address, so that is not implementable. The client-facing shape is what matters, and it
stays the same regardless: `GET` or `PUT` raw bytes with **no** `Authorization` header, valid for one
path and one method until it expires.

## Decision

The API serves the transfer itself and streams to and from the guest. The token is
`base64url(claims) + "." + HMAC-SHA256`, keyed by `SPACES_SIGNING_KEY` (derived from the API key when
unset). Claims pin the **method, sandbox id, path and expiry**.

Transfer and preview routes are the only paths exempt from bearer auth, because the token _is_ the
credential.

## Consequences

- Links work in a browser, `curl` and `wget` with no header, which is the reason the route exists.
- A download token cannot be replayed as an upload; both are refused after expiry. Rotating the API
  key invalidates every outstanding link, because the signing key derives from it.
- The token is self-contained: no server-side session to store or expire.
- **Accepted cost:** the body is buffered in memory on both sides, bounded by
  `SPACES_TRANSFER_MAX` (100 MiB). True unbounded streaming would need a transport `msb exec` cannot
  express. Documented rather than hidden.

## Alternatives considered

- **Guest-side server.** Impossible without inbound networking.
- **Bearer header on transfers.** Rejected: an `<a>` or an `<img>` cannot send one.
- **Short-lived random tokens in the database.** Rejected: the HMAC token is stateless and equally
  safe, with no expiry table to sweep.
