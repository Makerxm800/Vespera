# Vespera project site

`index.html` is a standalone, static landing page. It is intentionally separate from the browser UI in `src/renderer/` and uses no third-party scripts, fonts, analytics, or build step. Its release pill should be updated alongside the root README and changelog whenever the package version changes.

To publish it with GitHub Pages, enable Pages in the repository settings and choose **Deploy from a branch**, then select the default branch and the `/docs` folder. The current repository has Pages disabled, so changes to `index.html` do not publish the site by themselves.

Run `npm test` to check the landing-page links, installer filename patterns, current release label, and key product-limit copy.
