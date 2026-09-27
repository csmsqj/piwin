# ADR 0077: GitHub backed piwin extension registry

Status: Accepted (2026-09-28)

## Decision

The community piwin extension market reads `index.json` from the public [piwin-extensions registry](https://github.com/mimimaster/piwin-extensions). Each entry points to a public GitHub repository, an optional subdirectory, and an immutable 40-character commit. The registry stores metadata, not executable code. The Host validates the index, fetches a selected commit, checks the checked-out commit exactly, and stages the source in the managed immutable extension store. It does not run npm install or lifecycle scripts.

The Host owns catalog retrieval and installation; Desktop and CLI only request Host data or use its public application APIs. The curated offline catalog remains available when the community index cannot be fetched. The Host caches a successful community index for five minutes and keeps that snapshot during a temporary fetch failure.

The first published entry is `mimimaster/commandcode-provider`, an MIT-licensed adaptation of `patlux/pi-commandcode-provider`. Its `piwin/piwin.json` declares `authProvider: "commandcode"`. The Host reads this metadata only from the selected, enabled managed revision. `@piwin/agent-host` loads that exact extension through Pi's resource loader into its separate auth model runtime. The extension's own `registerProvider` registration supplies OAuth and the model catalog; piwin stores credentials under its Host `pi-agent/auth.json`. The OAuth card appears while the extension is enabled; the Models provider is projected after the account connects.

The first auth bridge recognizes only `commandcode`. Adding other extension-provided OAuth providers requires a new contract and explicit Host validation; the registry entry alone cannot register a new auth surface.

## Consequences

- Registry entries are reviewable, reproducible source pins. A branch or tag cannot silently change an installed version.
- Installing stages code without executing it; enabling and applying an extension are separate user actions.
- Enabled provider extensions run with Host user permissions, including when Pi loads them for the OAuth page.
- Uninstalling or disabling the Command Code extension removes its card and model projection at the next Host status reconciliation. Stored credentials remain in the Host auth file until sign-out.
- The registry can be redirected by the Host's `PIWIN_EXTENSION_REGISTRY_URL` environment variable for a private or self-hosted index.
