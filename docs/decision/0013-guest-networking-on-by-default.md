# 0013 — Guests boot with networking enabled

- **Status:** accepted
- **Date:** 2026-11-15

## Context

For most of the build, microVMs booted with **no network device at all**. That was not a limitation of
msb — it supports `--net`, `--net-rule`, DNS forwarding and port publishing — it was simply never
enabled. The consequence was large and diffuse: `apk add` failed, SSH was impossible, Docker could not
pull an image, and exposed ports were meaningless. Three product features looked "not supported" when
they were one flag away.

## Decision

Enable networking by default with the `public` profile (egress plus gateway DNS), and make the policy
configurable rather than hardcoded:

| Variable                                 | Purpose                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `SPACES_NET`                             | `public`, `private`, `host`, `all`, `none`                 |
| `SPACES_NET_RULES`                       | `msb --net-rule` entries, e.g. `allow@example.com:tcp:443` |
| `SPACES_NET_DEFAULT_EGRESS` / `_INGRESS` | default action for unmatched traffic                       |
| `SPACES_NET_DNS`                         | nameserver forwarded for guest DNS                         |

`none` maps to `--no-net`, so air-gapping is one setting.

## Consequences

- Package installs, DNS, HTTPS, SSH, Docker and port publishing all work with no host configuration.
  Verified: `apk add python3` pulls 17 packages / 50 MiB inside a guest.
- The sandbox record now carries a real guest `ip`, read back after create, fork and resume.
- Every sandbox reaches the internet by default. That is the right default for a developer tool and
  the wrong one for untrusted code — hence the profile and rule knobs, and `none` for the strict case.
  This trade-off is documented in the README rather than left implicit.
- msb's per-sandbox `/30` subnet still isolates guests from the host and from each other.

## Alternatives considered

- **Keep networking off, enable per sandbox.** Rejected: every user would pay a configuration tax for
  a capability they almost always want.
- **Default to `none`.** Rejected as a default; available as a setting for exactly this reason.
