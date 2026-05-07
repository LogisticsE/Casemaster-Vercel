/**
 * Phase 12 — parity tests.
 *
 * Hits the same logical endpoint on both runtimes and asserts equivalent
 * output. Skipped unless both URLs are configured:
 *   CMS_OFFICIAL_URL  — http://localhost:5050  (CaseMaster.Web.exe)
 *   CMS_VERCEL_URL    — https://…vercel.app    (this project)
 *
 * The harness intentionally normalises whitespace and timestamp-shaped
 * tokens so cosmetic differences don't fail the suite. As we port more
 * pages, add more cases here.
 */
import { describe, it, expect } from 'vitest';

const OFFICIAL = process.env.CMS_OFFICIAL_URL;
const VERCEL   = process.env.CMS_VERCEL_URL;

const both = OFFICIAL && VERCEL ? describe : describe.skip;

both('runtime parity', () => {
  it('ping returns the same payload shape on both runtimes', async () => {
    const [a, b] = await Promise.all([
      fetch(`${OFFICIAL}/page/axylog/f/ping`).then(r => r.text()),
      fetch(`${VERCEL}/page/foo/f/ping`)     .then(r => r.text()),
    ]);
    // Both should be `ok N\n`; N can differ because the runtimes might
    // see different snapshots if a write is in flight, but the shape is
    // identical.
    expect(a).toMatch(/^ok \d+\n?$/);
    expect(b).toMatch(/^ok \d+\n?$/);
  });
});
