# Vespera project site

`index.html` is a standalone, static landing page. It is intentionally separate from the browser UI in `src/renderer/` and uses no third-party scripts, fonts, analytics, or build step.

To publish it with GitHub Pages, enable Pages in the repository settings and choose **Deploy from a branch**, then select the default branch and the `/docs` folder. The current repository has Pages disabled, so adding these files alone does not publish the site.

The landing-page smoke test checks the canonical GitHub links, published asset filename patterns, and key product-limit copy with `npm test`.
