# 0007: Keep the data fresh with a daily GitHub Actions refresh

- **Status:** accepted
- **Date:** 2026-11-01

## Context

- The collection changes: galleries reopen, works rotate, temporary shows come and go. Andrei asked for the map
  data to update itself "since it changes over time".
- `fetch` already reads the live sources, but someone had to run it by hand. Until then, the snapshots committed
  in `data/` slowly go stale.
- The planned web app can't read the museum's feed from the browser, and shouldn't: every visitor would hit
  inhotim.org.br. It needs a published snapshot that something keeps current.

## Decision

- A scheduled workflow, `.github/workflows/refresh-data.yml`, runs `fetch` once a day at 06:17 Brasília time
  (09:17 UTC). It can also be run by hand.
- When `data/` changed, it runs the tests and a smoke route. It then commits the snapshots as
  `github-actions[bot]`, with fetch's report as the message body (POIs added, removed or changed), and pushes to
  `main`.
- The museum's sources must succeed: a failure probably means their site changed, and someone should look.
  OpenStreetMap is best-effort: if every Overpass mirror fails, the last good snapshot stays.

## Consequences

- ✅ `data/` (and later the web app) follows the live map within a day, with nobody running anything. The git
  history of `data/` becomes a changelog of the collection.
- ✅ One fetcher for everyone: about six requests a day to the museum and Overpass, within the "daily at most"
  etiquette.
- ✅ A broken source shows up as a failed scheduled run. GitHub notifies whoever last changed the schedule.
- ⚠️ Commits made by the bot don't count towards anyone's contribution graph.
- ⚠️ GitHub pauses scheduled workflows in public repos after 60 days without activity in the repository.
  Re-enable it from the Actions tab.
- ⚠️ Pushes made with the workflow's token don't trigger other workflows, so CI doesn't run on the bot's
  commits. That's why the refresh job runs the tests itself before committing.
- CLI users get the fresh data with `git pull`, or can still run `inhotim-path fetch` themselves.
