#!/usr/bin/env node

process.env.DESIGNECHO_REFERENCE_REPLICATION_SMOKE_CASE = 'neutral-text-layout';

require('./smoke-chat-ui-reference-replication.cjs');
