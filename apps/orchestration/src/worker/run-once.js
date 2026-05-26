#!/usr/bin/env node

process.env.WORKER_RUN_ONCE = 'true';

const { runCli } = require('./indexing-runner');

runCli();
