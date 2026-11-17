# Security policy

Setaside holds people's money records, so security reports are very welcome.

## Reporting a problem

**Please don't open a public issue.** Report it privately through GitHub: the repo's **Security** tab → **Report a vulnerability** ([direct link](https://github.com/BimsaraGamage/setaside/security/advisories/new)).

Helpful to include: what an attacker could do, the steps to show it, and the version or commit.

You can expect a first answer within 7 days. Fixes ship in a new release; you'll be credited in the advisory unless you'd rather not be.

## Supported versions

Only the latest release is supported. Self-hosters get fixes by merging the next Release PR (see [docs/self-hosting.md](docs/self-hosting.md)).

## Scope

In scope: this repo's code and its release workflow, e.g. one user reading or changing another user's data, getting past the allowed-email list, or leaking secrets.

Out of scope: problems in Cloudflare, GitHub or Google themselves (report those to them), and a self-hoster's own setup mistakes.
