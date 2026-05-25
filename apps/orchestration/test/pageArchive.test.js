const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  PageArchiveError,
  captureReadableCopy,
  extractReadableCopy,
  shouldAttemptPageArchive,
} = require('../src/services/pageArchive');

test('extractReadableCopy keeps readable text and strips unsafe markup', () => {
  const archive = extractReadableCopy({
    sourceUrl: 'https://example.com/article',
    finalUrl: 'https://example.com/article',
    statusCode: 200,
    contentType: 'text/html',
    body: `
      <html>
        <head>
          <title>Useful article</title>
          <meta name="description" content="A useful summary">
          <script>window.steal = true</script>
        </head>
        <body>
          <article>
            <h1>Useful article</h1>
            <p>This is a long enough paragraph about creator research and saving references for later.</p>
            <iframe src="https://tracker.example"></iframe>
            <p>It should become safe text that can be shown without running page code.</p>
          </article>
        </body>
      </html>
    `,
  });

  assert.equal(archive.status, 'ready');
  assert.equal(archive.title, 'Useful article');
  assert.match(archive.contentText, /creator research/);
  assert.doesNotMatch(archive.contentText, /window\.steal/);
  assert.doesNotMatch(archive.contentHtml, /<script/i);
  assert.doesNotMatch(archive.contentHtml, /<iframe/i);
});

test('captureReadableCopy rejects private localhost targets before fetching', async () => {
  const server = http.createServer((_req, res) => {
    res.end('<article><p>This local page should not be fetched by page backup.</p></article>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      () => captureReadableCopy(`http://127.0.0.1:${port}/private`),
      (error) => error instanceof PageArchiveError && ['blocked_host', 'blocked_port'].includes(error.code),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('shouldAttemptPageArchive only allows normal web saves', () => {
  assert.equal(shouldAttemptPageArchive({ url: 'https://example.com/a', platformKey: 'web' }), true);
  assert.equal(shouldAttemptPageArchive({ url: 'file:///etc/passwd', platformKey: 'web' }), false);
  assert.equal(shouldAttemptPageArchive({ url: 'https://example.com/note', contentType: 'note', platformKey: 'iscraper-note' }), false);
});
