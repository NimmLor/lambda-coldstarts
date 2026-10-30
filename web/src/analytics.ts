/**
 * PostHog product analytics, on when build.ts inlines `POSTHOG_PROJECT_TOKEN` and off otherwise:
 * in dev.ts, whose bunfig.toml defines it empty, and on every stage but production, which
 * infra/perf.ts builds with it empty. The no-external build never loads PostHog's own scripts, and
 * events go to /ingest, which PerfRouter forwards to PostHog's EU cloud, so the page stays
 * same-origin. Memory persistence sets no cookies and writes no browser storage, as privacy.html
 * promises.
 */
import posthog from 'posthog-js/no-external'

const token = process.env.POSTHOG_PROJECT_TOKEN

if (token) {
  posthog.init(token, {
    api_host: '/ingest',
    ui_host: 'https://eu.posthog.com',
    persistence: 'memory',
    person_profiles: 'identified_only',
    respect_dnt: true,
    disable_session_recording: true,
    disable_surveys: true,
  })
}

/** Records a dashboard choice the autocaptured click alone doesn't name, like the option picked. */
export const track = (event: string, properties: Record<string, string | number>) => {
  if (token) posthog.capture(event, properties)
}
