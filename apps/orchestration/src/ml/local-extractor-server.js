#!/usr/bin/env node

const { createLocalExtractorApp, localExtractorConfigFromEnv } = require('./localExtractorService');

function runCli() {
  const config = localExtractorConfigFromEnv();
  const app = createLocalExtractorApp({ config });
  const server = app.listen(config.port, config.host, () => {
    console.log(`IScraper local extractor listening on http://${config.host}:${config.port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  runCli,
};
