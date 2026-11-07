#!/usr/bin/env -S node --experimental-strip-types
// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { agentFromEnv } from "../config.ts";
import { createMcpServer } from "../mcp.ts";

// Stdout belongs to the protocol: everything human goes to stderr.
const agent = agentFromEnv();
await createMcpServer(agent).connect(new StdioServerTransport());
console.error(`ghosts MCP server on ${agent.backend.network} as ${agent.backend.address}`);
