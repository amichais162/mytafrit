// ============================================
// Mytafrit Worker — Dynamic OG Tags Injection
// ============================================
// Intercepts requests to /menu and injects dynamic meta tags
// based on the slug parameter.

const SUPABASE_URL = 'https://uskwkqibrjmeocildgay.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVza3drcWlicmptZW9jaWxkZ2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MzI2NDksImV4cCI6MjA5MTAwODY0OX0.TzpDmbMdLxWQ2atag9FSviQ0feTB6FIGMKJLgdqxfuc';

const CACHE_TTL = 300; // 5 minutes

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Only process /menu paths. Let everything else pass through.
      if (!url.pathname.startsWith('/menu')) {
        return fetch(request);
      }

      // Extract slug from query string
      const slug = url.searchParams.get('slug');

      // Build cache key
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;

      // Try cache first
      let response = await cache.match(cacheKey);
      if (response) {
        return response;
      }

      // Fetch the original HTML from GitHub Pages
      const originalResponse = await fetch(request);

      // If no slug, or response not ok, or not HTML — pass through
      const contentType = originalResponse.headers.get('content-type') || '';
      if (!slug || !originalResponse.ok || !contentType.includes('text/html')) {
        return originalResponse;
      }

      // Fetch settings from Supabase
      let settings = null;
      try {
        const supabaseRes = await fetch(
          `${SUPABASE_URL}/rest/v1/settings?slug=eq.${encodeURIComponent(slug)}&select=business_name,tagline,logo_url,hero_bg_url,about_text`,
          {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Accept': 'application/json'
            }
          }
        );

        if (supabaseRes.ok) {
          const data = await supabaseRes.json();
          if (Array.isArray(data) && data.length > 0) {
            settings = data[0];
          }
        }
      } catch (e) {
        // Supabase unreachable — fall through to serve original
        console.error('Supabase fetch failed:', e);
      }

      // If no settings found — serve the original HTML untouched
      if (!settings) {
        return originalResponse;
      }

      // Build meta tag values
      const bizName = (settings.business_name || 'התפריט שלי').trim();
      const tagline = (settings.tagline || '').trim();
      const description = tagline || `תפריט דיגיטלי של ${bizName} - הזמנה ישירה בוואטסאפ`;
      const ogImage = settings.logo_url || settings.hero_bg_url || '';
      const logoUrl = settings.logo_url || '';
      const pageTitle = tagline ? `${bizName} - ${tagline}` : bizName;
      const canonicalUrl = url.toString();

      // Get the HTML as text
      let html = await originalResponse.text();

      // Inject dynamic meta tags
      html = injectMetaTags(html, {
        title: pageTitle,
        description: description,
        ogTitle: pageTitle,
        ogDescription: description,
        ogImage: ogImage,
        ogUrl: canonicalUrl,
        logoUrl: logoUrl,
        bizName: bizName
      });

      // Build new response with same headers
      const newResponse = new Response(html, {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers: originalResponse.headers
      });

      // Adjust headers for caching
      newResponse.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
      newResponse.headers.delete('Content-Length'); // length changed after injection

      // Store in cache
      ctx.waitUntil(cache.put(cacheKey, newResponse.clone()));

      return newResponse;

    } catch (e) {
      // Catch-all: any error — fall back to origin
      console.error('Worker error:', e);
      return fetch(request);
    }
  }
};

// ============================================
// Helper: escape HTML attribute values
// ============================================
function escapeHtmlAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================
// Helper: inject meta tags into HTML
// ============================================
function injectMetaTags(html, data) {
  const {
    title,
    description,
    ogTitle,
    ogDescription,
    ogImage,
    ogUrl,
    logoUrl,
    bizName
  } = data;

  // Escape all user-facing strings
  const safeTitle = escapeHtmlAttr(title);
  const safeDescription = escapeHtmlAttr(description);
  const safeOgTitle = escapeHtmlAttr(ogTitle);
  const safeOgDescription = escapeHtmlAttr(ogDescription);
  const safeOgImage = escapeHtmlAttr(ogImage);
  const safeOgUrl = escapeHtmlAttr(ogUrl);
  const safeLogoUrl = escapeHtmlAttr(logoUrl);

  // 1. Replace the <title> tag
  html = html.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${safeTitle}</title>`
  );

  // 2. Replace or add description meta tag
  if (/<meta\s+[^>]*name=["']description["'][^>]*>/i.test(html)) {
    html = html.replace(
      /<meta\s+[^>]*name=["']description["'][^>]*>/i,
      `<meta name="description" content="${safeDescription}">`
    );
  }

  // 3. Replace favicon if logo is available
  if (safeLogoUrl) {
    // Replace the SVG favicon link
    html = html.replace(
      /<link\s+rel=["']icon["'][^>]*>/i,
      `<link rel="icon" type="image/png" href="${safeLogoUrl}">`
    );
    // Replace apple-touch-icon if exists
    html = html.replace(
      /<link\s+rel=["']apple-touch-icon["'][^>]*>/i,
      `<link rel="apple-touch-icon" href="${safeLogoUrl}">`
    );
  }

  // 4. Build Open Graph and Twitter Card tags
  const ogTags = `
  <!-- Open Graph / Facebook / WhatsApp -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${safeOgUrl}">
  <meta property="og:title" content="${safeOgTitle}">
  <meta property="og:description" content="${safeOgDescription}">
  ${safeOgImage ? `<meta property="og:image" content="${safeOgImage}">` : ''}
  <meta property="og:locale" content="he_IL">
  <meta property="og:site_name" content="Mytafrit">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeOgTitle}">
  <meta name="twitter:description" content="${safeOgDescription}">
  ${safeOgImage ? `<meta name="twitter:image" content="${safeOgImage}">` : ''}`;

  // Inject OG tags before </head>
  html = html.replace('</head>', `${ogTags}\n</head>`);

  return html;
}
