/**
 * The browser is part of the product surface now, so it gets a real test:
 * navigation, redirects, cookies, link indexing, back/forward, find, JSON,
 * error pages and the private-network guard.
 *
 * Run: npm run test:browser
 */
import { createServer, type Server } from 'node:http';
import { strict as assert } from 'node:assert';

process.env.VESPER_BROWSER_ALLOW_PRIVATE = '1';
const { browser, resetBrowser, assertPublicUrl, normalizeUrl, extractPage } = await import('../server/browser/index.ts');

const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head>
      <title>Alpha &amp; Omega</title>
      <meta name="description" content="A test page for the reader.">
      </head><body>
      <nav><a href="/ignored-nav">Nav</a></nav>
      <h1>Alpha</h1>
      <p>First paragraph with &amp; an entity &mdash; and a <strong>bold</strong> word.</p>
      <p>Second paragraph.</p>
      <a href="/about">Read about it</a>
      <a href="/cookie">Set a cookie</a>
      <a href="https://example.com/x">External</a>
      <a href="#section">Anchor only</a>
      <script>window.secret = 'not page text'</script>
      </body></html>`);
    return;
  }
  if (url.pathname === '/about') {
    res.setHeader('content-type', 'text/html');
    res.end(`<html><head><title>About</title></head><body><h1>About</h1><p>Alpha details live here.</p><a href="/">Home</a></body></html>`);
    return;
  }
  if (url.pathname === '/redirect') {
    res.writeHead(302, { location: '/about' });
    res.end();
    return;
  }
  if (url.pathname === '/cookie') {
    res.setHeader('set-cookie', 'session=abc123; Path=/; HttpOnly');
    res.setHeader('content-type', 'text/html');
    res.end('<html><head><title>Cookie</title></head><body>cookie set</body></html>');
    return;
  }
  if (url.pathname === '/whoami') {
    res.setHeader('content-type', 'text/html');
    res.end(`<html><head><title>Whoami</title></head><body>cookie=${req.headers.cookie ?? 'none'}</body></html>`);
    return;
  }
  if (url.pathname === '/json') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ alpha: 1, beta: [2, 3] }));
    return;
  }
  if (url.pathname === '/error') {
    res.writeHead(500, { 'content-type': 'text/html' });
    res.end('<html><head><title>Boom</title></head><body>server error</body></html>');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;

try {
  resetBrowser();
  const opened = await browser().open(`${base}/`);
  assert.equal(opened.page.title, 'Alpha & Omega', 'title entity is decoded');
  assert.match(opened.page.text, /First paragraph with & an entity — and a bold word/, 'text is readable');
  assert.doesNotMatch(opened.page.text, /not page text/, 'scripts are stripped');
  assert.ok(opened.page.links.length >= 3, 'links are indexed');
  const aboutLink = opened.page.links.find((link) => link.url.endsWith('/about'));
  assert.ok(aboutLink, 'relative links resolve');
  assert.equal(opened.page.links[0]?.index, 1, 'link indexes are 1-based');

  const clicked = await browser().click(aboutLink.index);
  assert.equal(clicked.page.title, 'About');
  const back = await browser().back('agent');
  assert.equal(back.page.title, 'Alpha & Omega', 'back returns to the previous page');

  const found = await browser().find('bold');
  assert.match(found, /match for “bold”/, 'find returns context');

  const redirected = await browser().open(`${base}/redirect`);
  assert.equal(redirected.page.title, 'About', 'redirects are followed');
  assert.equal(redirected.page.url, `${base}/about`, 'final URL is recorded');

  await browser().open(`${base}/cookie`);
  const who = await browser().open(`${base}/whoami`);
  assert.match(who.page.text, /session=abc123/, 'cookies are replayed');

  const json = await browser().open(`${base}/json`);
  assert.match(json.page.text, /"alpha": 1/, 'JSON is pretty-printed');

  const failed = await browser().open(`${base}/error`);
  assert.equal(failed.page.status, 500);
  assert.match(String(failed.page.error), /HTTP 500/, 'HTTP failures are surfaced');

  assert.equal(normalizeUrl('example.com/a b'), 'https://example.com/a%20b');
  assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(normalizeUrl('http://example.com/x'), 'http://example.com/x');

  delete process.env.VESPER_BROWSER_ALLOW_PRIVATE;
  assert.throws(() => assertPublicUrl('http://127.0.0.1:8787/'), /private or loopback/, 'private hosts are blocked');
  assert.throws(() => assertPublicUrl('http://169.254.169.254/latest/meta-data'), /private or loopback/, 'metadata IP is blocked');
  assert.doesNotThrow(() => assertPublicUrl('https://example.com/'), 'public hosts pass');

  const extracted = extractPage('<html><head><title>T</title></head><body><a href="/x"> X </a></body></html>', 'https://example.com');
  assert.equal(extracted.links[0]?.url, 'https://example.com/x', 'absolute URLs resolve');

  console.log('browser: 18 checks passed');
} finally {
  server.close();
}
