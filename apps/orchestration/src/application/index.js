const { createArchiveWorkflow } = require('./archiveWorkflow');
const { createBillingWorkflow } = require('./billingWorkflow');
const { createImportWorkflow } = require('./importWorkflow');
const { createLibraryWorkflow } = require('./libraryWorkflow');
const { createNoteAssetWorkflow } = require('./noteAssetWorkflow');
const { createScreenshotWorkflow } = require('./screenshotWorkflow');
const { createSearchWorkflow } = require('./searchWorkflow');
const { createWorkerWorkflow } = require('./workerWorkflow');

function createWorkflows({ store, config, http, observability = null }) {
  const worker = createWorkerWorkflow({
    store,
    config,
    http,
    observability,
  });
  const archive = createArchiveWorkflow({ store, config });
  const library = createLibraryWorkflow({ store, config, worker });
  const imports = createImportWorkflow({ store, config, archive, library, worker });

  return {
    archive,
    billing: createBillingWorkflow({ store, config }),
    imports,
    library,
    notes: createNoteAssetWorkflow({ store, config }),
    screenshots: createScreenshotWorkflow({ store, config }),
    search: createSearchWorkflow({ store, config, http }),
    worker,
  };
}

module.exports = {
  createWorkflows,
};
