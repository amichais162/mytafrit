// ============================================
// Mytafrit Worker — OG injection + /publish endpoint
// ============================================

const SUPABASE_URL = 'https://uskwkqibrjmeocildgay.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVza3drcWlicmptZW9jaWxkZ2F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MzI2NDksImV4cCI6MjA5MTAwODY0OX0.TzpDmbMdLxWQ2atag9FSviQ0feTB6FIGMKJLgdqxfuc';

const CACHE_TTL = 300; // 5 minutes for /menu* cache
const PUBLISH_RATE_LIMIT = 10; // publishes per minute per user
const PUBLISH_RATE_WINDOW = 60; // seconds

// ⚠️ When adding a new table that should be published to KV,
// add it to this list and run `npx wrangler deploy`.
// Missing a table here means it won't appear on the public menu.
const TABLES_TO_PUBLISH = ['settings', 'categories', 'products'];

const ALLOWED_ORIGIN = 'https://mytafrit.co.il';

// ============================================
// Main fetch handler
// ============================================
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // CORS preflight for /publish
      if (request.method === 'OPTIONS' && url.pathname === '/publish') {
        return handleCorsPreflightResponse();
      }

      // CORS preflight for /rename-slug
      if (request.method === 'OPTIONS' && url.pathname === '/rename-slug') {
        return handleCorsPreflightResponse();
      }

      // /publish endpoint
      if (url.pathname === '/publish') {
        if (request.method !== 'POST') {
          return jsonResponse({ error: 'Method not allowed' }, 405);
        }
        return await handlePublish(request, env, ctx);
      }

      // /rename-slug endpoint
      if (url.pathname === '/rename-slug') {
        if (request.method !== 'POST') {
          return jsonResponse({ error: 'Method not allowed' }, 405);
        }
        return await handleRenameSlug(request, env, ctx);
      }

      // CORS preflight for /admin-delete-kv (allows localhost for admin tool)
      if (request.method === 'OPTIONS' && url.pathname === '/admin-delete-kv') {
        return handleAdminCorsPreflightResponse(request);
      }

      // /admin-delete-kv endpoint — internal admin tool, secret-protected
      if (url.pathname === '/admin-delete-kv') {
        if (request.method !== 'POST') {
          return jsonResponse({ error: 'Method not allowed' }, 405);
        }
        return await handleAdminDeleteKv(request, env, ctx);
      }

      // Existing /menu* handling — passthrough to current OG injection logic
      if (url.pathname.startsWith('/menu')) {
        return await handleMenuRequest(request, env, ctx);
      }

      // Anything else — pass through
      return fetch(request);

    } catch (e) {
      console.error('Top-level worker error:', e);
      return fetch(request);
    }
  }
};

// ============================================
// /rename-slug handler — migrate KV from old slug to new slug
// ============================================
async function handleRenameSlug(request, env, ctx) {
  try {
    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

    const oldSlug = (body.oldSlug || '').trim();
    const newSlug = (body.newSlug || '').trim();

    if (!oldSlug || !newSlug) return jsonResponse({ error: 'Missing oldSlug or newSlug' }, 400);
    if (oldSlug === newSlug) return jsonResponse({ ok: true, action: 'noop' }, 200);

    const authHeader = request.headers.get('Authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return jsonResponse({ error: 'Missing Authorization' }, 401);
    const accessToken = match[1];

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return jsonResponse({ error: 'Invalid session', code: 'SESSION_EXPIRED' }, 401);
    const userData = await userRes.json();
    const userId = userData.id;
    if (!userId) return jsonResponse({ error: 'Could not resolve user' }, 401);

    // Verify the new slug actually belongs to this user (after Supabase was already updated)
    const settingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?user_id=eq.${encodeURIComponent(userId)}&select=slug`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } }
    );
    if (!settingsRes.ok) return jsonResponse({ error: 'Failed to verify ownership' }, 502);
    const settingsRows = await settingsRes.json();
    if (!Array.isArray(settingsRows) || !settingsRows.length || settingsRows[0].slug !== newSlug) {
      return jsonResponse({ error: 'Slug ownership mismatch', code: 'OWNERSHIP_MISMATCH' }, 403);
    }

    const oldKvKey = `published:${oldSlug}`;
    const newKvKey = `published:${newSlug}`;

    const oldData = await env.MYTAFRIT_KV_PROD.get(oldKvKey);

    if (oldData) {
      await env.MYTAFRIT_KV_PROD.put(newKvKey, oldData);
      await env.MYTAFRIT_KV_PROD.delete(oldKvKey);
      return jsonResponse({ ok: true, action: 'migrated' }, 200);
    } else {
      return jsonResponse({ ok: true, action: 'no_data_to_migrate' }, 200);
    }
  } catch (e) {
    console.error('Rename slug error:', e);
    return jsonResponse({ error: 'Internal error', message: String(e.message || e) }, 500);
  }
}

// ============================================
// /publish handler
// ============================================
async function handlePublish(request, env, ctx) {
  try {
    // 1. Parse body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const slug = (body.slug || '').trim();
    if (!slug) {
      return jsonResponse({ error: 'Missing slug' }, 400);
    }

    // 2. Extract access token from Authorization header
    const authHeader = request.headers.get('Authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return jsonResponse({ error: 'Missing or invalid Authorization header' }, 401);
    }
    const accessToken = match[1];

    // 3. Validate token + get user_id via Supabase /auth/v1/user
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!userRes.ok) {
      return jsonResponse({ error: 'Invalid or expired session', code: 'SESSION_EXPIRED' }, 401);
    }

    const userData = await userRes.json();
    const userId = userData.id;
    if (!userId) {
      return jsonResponse({ error: 'Could not resolve user' }, 401);
    }

    // 4. Rate limiting check
    const rateLimitOk = await checkRateLimit(env, userId);
    if (!rateLimitOk.allowed) {
      return jsonResponse({
        error: 'Too many publishes',
        code: 'RATE_LIMIT',
        retryAfterSeconds: rateLimitOk.retryAfter,
      }, 429);
    }

    // 5. Fetch settings for this user and verify slug matches
    const settingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?user_id=eq.${encodeURIComponent(userId)}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!settingsRes.ok) {
      return jsonResponse({ error: 'Failed to fetch settings', status: settingsRes.status }, 502);
    }

    const settingsRows = await settingsRes.json();
    if (!Array.isArray(settingsRows) || settingsRows.length === 0) {
      return jsonResponse({ error: 'Settings not found for current user' }, 404);
    }
    const settings = settingsRows[0];

    // Verify the slug in request matches user's actual slug
    if (settings.slug !== slug) {
      return jsonResponse({
        error: 'Slug mismatch — you can only publish your own slug',
        code: 'SLUG_MISMATCH',
      }, 403);
    }

    // 6. Fetch categories and products in parallel (also via RLS)
    const [catsRes, prodsRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/categories?user_id=eq.${encodeURIComponent(userId)}&select=*&order=sort_order`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
        }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/products?user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true&select=*&order=sort_order`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
        }
      ),
    ]);

    if (!catsRes.ok || !prodsRes.ok) {
      return jsonResponse({
        error: 'Failed to fetch related data',
        catsStatus: catsRes.status,
        prodsStatus: prodsRes.status,
      }, 502);
    }

    const categories = await catsRes.json();
    const products = await prodsRes.json();

    // 7. Build payload
    const publishedAt = new Date().toISOString();
    const payload = {
      version: 1,
      publishedAt,
      settings,
      categories: Array.isArray(categories) ? categories : [],
      products: Array.isArray(products) ? products : [],
    };

    // 8. Save to KV
    const kvKey = `published:${slug}`;
    await env.MYTAFRIT_KV_PROD.put(kvKey, JSON.stringify(payload));

    // 9. Update last_published_at in Supabase
    // Two UPDATEs because of the BEFORE UPDATE trigger that bumps updated_at to NOW:
    //   (a) set last_published_at = NOW — trigger sets updated_at = NOW automatically
    //   (b) set updated_at = last_published_at — force them equal for dirty-state comparison
    const updateRes1 = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ last_published_at: publishedAt }),
      }
    );

    if (!updateRes1.ok) {
      console.error('First update (last_published_at) failed', updateRes1.status);
      // KV already updated — publish is functionally OK, but dirty state may be wrong.
      // Don't fail the whole operation, but return warning.
      return jsonResponse({
        ok: true,
        publishedAt,
        warning: 'KV updated but last_published_at not persisted',
      }, 200);
    }

    // Second update to force updated_at == last_published_at
    const updateRes2 = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ updated_at: publishedAt }),
      }
    );

    if (!updateRes2.ok) {
      console.warn('Second update (updated_at sync) failed', updateRes2.status);
      // Publish still succeeded, dirty state may flicker
    }

    // 10. Return success
    return jsonResponse({ ok: true, publishedAt }, 200);

  } catch (e) {
    console.error('Publish handler error:', e);
    return jsonResponse({ error: 'Internal error', message: String(e.message || e) }, 500);
  }
}

// ============================================
// Rate limiting via KV
// ============================================
async function checkRateLimit(env, userId) {
  const key = `rate:${userId}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    const raw = await env.MYTAFRIT_KV_PROD.get(key);
    let data = raw ? JSON.parse(raw) : { count: 0, windowStart: now };

    // Reset window if expired
    if (now - data.windowStart >= PUBLISH_RATE_WINDOW) {
      data = { count: 0, windowStart: now };
    }

    if (data.count >= PUBLISH_RATE_LIMIT) {
      const retryAfter = PUBLISH_RATE_WINDOW - (now - data.windowStart);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }

    data.count += 1;
    await env.MYTAFRIT_KV_PROD.put(key, JSON.stringify(data), {
      expirationTtl: PUBLISH_RATE_WINDOW + 10,
    });

    return { allowed: true };
  } catch (e) {
    // If rate limit check itself fails, fail open (allow the request)
    console.warn('Rate limit check failed, allowing request', e);
    return { allowed: true };
  }
}

// ============================================
// JSON response helper with CORS
// ============================================
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Cache-Control': 'no-store',
    },
  });
}

// ============================================
// CORS preflight helper
// ============================================
function handleCorsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// ============================================
// Existing /menu* handler — unchanged from current behavior
// (OG injection only, no data injection yet)
// ============================================
async function handleMenuRequest(request, env, ctx) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  // No slug — passthrough (preview mode handled by menu.html itself)
  if (!slug) {
    return fetch(request);
  }

  const cacheKey = new Request(url.toString(), request);
  const cache = caches.default;

  let cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const originalResponse = await fetch(request);
  const contentType = originalResponse.headers.get('content-type') || '';

  if (!originalResponse.ok || !contentType.includes('text/html')) {
    return originalResponse;
  }

  // Fetch settings from Supabase (for OG tags)
  let settings = null;
  try {
    const supabaseRes = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?slug=eq.${encodeURIComponent(slug)}&select=business_name,tagline,logo_url,hero_bg_url,about_text`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept': 'application/json',
        },
      }
    );
    if (supabaseRes.ok) {
      const data = await supabaseRes.json();
      if (Array.isArray(data) && data.length > 0) {
        settings = data[0];
      }
    }
  } catch (e) {
    console.error('Supabase settings fetch failed:', e);
  }

  // Fetch published data from KV
  let publishedData = null;
  try {
    const kvKey = `published:${slug}`;
    const rawData = await env.MYTAFRIT_KV_PROD.get(kvKey);
    if (rawData) {
      publishedData = rawData;
    }
  } catch (e) {
    console.error('KV read failed:', e);
  }

  // Read HTML
  let html = await originalResponse.text();

  // Inject OG tags (only if we have settings)
  if (settings) {
    const bizName = (settings.business_name || 'התפריט שלי').trim();
    const tagline = (settings.tagline || '').trim();
    const description = tagline || `תפריט דיגיטלי של ${bizName} - הזמנה ישירה בוואטסאפ`;
    const ogImage = settings.logo_url || settings.hero_bg_url || '';
    const logoUrl = settings.logo_url || '';
    const pageTitle = tagline ? `${bizName} - ${tagline}` : bizName;

    html = injectMetaTags(html, {
      title: pageTitle,
      description: description,
      ogTitle: pageTitle,
      ogDescription: description,
      ogImage: ogImage,
      ogUrl: url.toString(),
      logoUrl: logoUrl,
      bizName: bizName,
    });
  }

  // Inject __MYTAFRIT_DATA__ script tag (always — either real data or not_published)
  const dataPayload = publishedData || '{"status":"not_published"}';
  const safeDataPayload = dataPayload.replace(/<\/script>/gi, '<\\/script>');
  const dataScriptTag = `<script id="__MYTAFRIT_DATA__" type="application/json">${safeDataPayload}</script>`;
  html = html.replace('</head>', `${dataScriptTag}\n</head>`);

  // Build response
  const newResponse = new Response(html, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });

  newResponse.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
  newResponse.headers.delete('Content-Length');

  ctx.waitUntil(cache.put(cacheKey, newResponse.clone()));

  return newResponse;
}

// ============================================
// HTML escape helper
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
// Meta tag injection — unchanged
// ============================================
function injectMetaTags(html, data) {
  const { title, description, ogTitle, ogDescription, ogImage, ogUrl, logoUrl } = data;

  const safeTitle = escapeHtmlAttr(title);
  const safeDescription = escapeHtmlAttr(description);
  const safeOgTitle = escapeHtmlAttr(ogTitle);
  const safeOgDescription = escapeHtmlAttr(ogDescription);
  const safeOgImage = escapeHtmlAttr(ogImage);
  const safeOgUrl = escapeHtmlAttr(ogUrl);
  const safeLogoUrl = escapeHtmlAttr(logoUrl);

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${safeTitle}</title>`);

  if (/<meta\s+[^>]*name=["']description["'][^>]*>/i.test(html)) {
    html = html.replace(
      /<meta\s+[^>]*name=["']description["'][^>]*>/i,
      `<meta name="description" content="${safeDescription}">`
    );
  }

  if (safeLogoUrl) {
    html = html.replace(
      /<link\s+rel=["']icon["'][^>]*>/i,
      `<link rel="icon" type="image/png" href="${safeLogoUrl}">`
    );
    html = html.replace(
      /<link\s+rel=["']apple-touch-icon["'][^>]*>/i,
      `<link rel="apple-touch-icon" href="${safeLogoUrl}">`
    );
  }

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

  html = html.replace('</head>', `${ogTags}\n</head>`);

  return html;
}

// ============================================
// /admin-delete-kv handler — internal admin tool
// Deletes published:{slug} from KV. Requires ADMIN_SECRET in header.
// ============================================
async function handleAdminDeleteKv(request, env, ctx) {
  try {
    // 1. Verify admin secret
    const providedSecret = request.headers.get('X-Admin-Secret') || '';
    if (!env.ADMIN_SECRET) {
      console.error('ADMIN_SECRET not configured in Worker env');
      return adminJsonResponse({ error: 'Admin secret not configured on server' }, 500, request);
    }
    if (providedSecret !== env.ADMIN_SECRET) {
      return adminJsonResponse({ error: 'Invalid admin secret' }, 403, request);
    }

    // 2. Parse body
    let body;
    try { body = await request.json(); }
    catch { return adminJsonResponse({ error: 'Invalid JSON body' }, 400, request); }

    const slug = (body.slug || '').trim();
    if (!slug) return adminJsonResponse({ error: 'Missing slug' }, 400, request);

    // 3. Delete from KV
    const kvKey = `published:${slug}`;
    const existed = await env.MYTAFRIT_KV_PROD.get(kvKey);
    await env.MYTAFRIT_KV_PROD.delete(kvKey);

    return adminJsonResponse({
      ok: true,
      slug,
      action: existed ? 'deleted' : 'not_found',
    }, 200, request);

  } catch (e) {
    console.error('Admin delete KV error:', e);
    return adminJsonResponse({ error: 'Internal error', message: String(e.message || e) }, 500, request);
  }
}

// ============================================
// JSON response helper for /admin-delete-kv (allows localhost)
// ============================================
function adminJsonResponse(obj, status, request) {
  const origin = request.headers.get('Origin') || '';
  // Allow mytafrit.co.il production AND localhost (for local admin tool)
  const isAllowed =
    origin === 'https://mytafrit.co.il' ||
    /^http:\/\/localhost(:\d+)?$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': isAllowed ? origin : 'https://mytafrit.co.il',
      'Access-Control-Allow-Credentials': 'true',
      'Cache-Control': 'no-store',
    },
  });
}

// ============================================
// CORS preflight for /admin-delete-kv (allows localhost)
// ============================================
function handleAdminCorsPreflightResponse(request) {
  const origin = request.headers.get('Origin') || '';
  const isAllowed =
    origin === 'https://mytafrit.co.il' ||
    /^http:\/\/localhost(:\d+)?$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': isAllowed ? origin : 'https://mytafrit.co.il',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}
