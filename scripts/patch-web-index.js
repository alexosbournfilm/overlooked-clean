const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'dist', 'index.html');

const SITE_NAME = 'Overlooked';
const SITE_URL = 'https://www.overlooked.cloud/';
const DESCRIPTION =
  'Create an account or log in to Overlooked - Share your films and acting monologues, sharpen your craft, build your portfolio, and meet collaborators.';
const ICON_PATH = '/ol-favicon-999.png?v=999';
const ICON_URL = 'https://www.overlooked.cloud/ol-favicon-999.png';

if (!fs.existsSync(indexPath)) {
  throw new Error(`Cannot find ${indexPath}. Run the Expo web export first.`);
}

const structuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: ICON_URL,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
  },
];

const seoTags = `
    <meta name="description" content="${DESCRIPTION}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${SITE_URL}" />
    <link rel="icon" href="${ICON_PATH}" />
    <link rel="apple-touch-icon" href="${ICON_PATH}" />
    <meta name="application-name" content="${SITE_NAME}" />
    <meta name="apple-mobile-web-app-title" content="${SITE_NAME}" />
    <meta name="theme-color" content="#000000" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${SITE_NAME}" />
    <meta property="og:description" content="${DESCRIPTION}" />
    <meta property="og:url" content="${SITE_URL}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${ICON_URL}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${SITE_NAME}" />
    <meta name="twitter:description" content="${DESCRIPTION}" />
    <script type="application/ld+json">${JSON.stringify(structuredData)}</script>`;

const noScript = `
    <noscript>
      <div class="nojs-hero">
        <h1>${SITE_NAME}</h1>
        <p>${DESCRIPTION}</p>
      </div>
    </noscript>`;

const noScriptStyles = `
    <style id="overlooked-seo-reset">
      html,
      body,
      #root {
        width: 100%;
        min-height: 100%;
        margin: 0;
        padding: 0;
      }

      body {
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }

      .nojs-hero {
        box-sizing: border-box;
        max-width: 860px;
        margin: 48px auto;
        padding: 24px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111111;
      }

      .nojs-hero h1 {
        margin: 0 0 10px;
        font-size: 44px;
        line-height: 1;
        letter-spacing: 0;
      }

      .nojs-hero p {
        margin: 0;
        max-width: 700px;
        font-size: 20px;
        line-height: 1.45;
      }
    </style>`;

let html = fs.readFileSync(indexPath, 'utf8');

html = html
  .replace(/<title>[\s\S]*?<\/title>/i, `<title>${SITE_NAME}</title>`)
  .replace(/\s*<meta name="theme-color" content="[^"]*">\s*/gi, '\n')
  .replace(/\s*<link rel="icon" href="[^"]*" \/>/gi, '\n')
  .replace(/\s*<link rel="icon" href="[^"]*">\s*/gi, '\n')
  .replace(/\s*<meta name="description" content="[^"]*" \/>/gi, '\n')
  .replace(/\s*<meta name="robots" content="[^"]*" \/>/gi, '\n')
  .replace(/\s*<meta name="application-name" content="[^"]*" \/>/gi, '\n')
  .replace(/\s*<meta name="apple-mobile-web-app-title" content="[^"]*" \/>/gi, '\n')
  .replace(/\s*<link rel="apple-touch-icon" href="[^"]*" \/>/gi, '\n')
  .replace(/\s*<link rel="canonical" href="[^"]*" \/>/gi, '\n')
  .replace(/\s*<meta property="og:[^"]+" content="[^"]*" \/>/gi, '\n')
  .replace(/\s*<meta name="twitter:[^"]+" content="[^"]*" \/>/gi, '\n')
  .replace(/\s*<style id="overlooked-seo-reset">[\s\S]*?<\/style>/gi, '\n')
  .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, '\n');

html = html.replace('</head>', `${seoTags}\n${noScriptStyles}\n</head>`);
html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, noScript);

fs.writeFileSync(indexPath, html);

console.log('Patched dist/index.html with Overlooked SEO metadata.');
