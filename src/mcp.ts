#!/usr/bin/env node

/**
 * BuildingLink MCP Server
 *
 * An MCP (Model Context Protocol) server that exposes BuildingLink
 * property management functionality as tools. Uses web scraping and
 * API access to interact with BuildingLink.
 *
 * Authentication is handled via environment variables:
 *   BUILDINGLINK_USERNAME - BuildingLink login username
 *   BUILDINGLINK_PASSWORD - BuildingLink login password
 *   BUILDINGLINK_API_KEY  - (Optional) API key for user endpoint
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { BuildingLink } from "./BuildingLink";

// Lazy-initialized client instance shared across tool calls
let client: BuildingLink | undefined;

/**
 * Returns an authenticated BuildingLink client, creating one if needed.
 * Credentials are read from environment variables.
 */
function getClient(): BuildingLink {
  if (client) return client;

  const username = process.env.BUILDINGLINK_USERNAME;
  const password = process.env.BUILDINGLINK_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "BUILDINGLINK_USERNAME and BUILDINGLINK_PASSWORD environment variables are required"
    );
  }

  client = new BuildingLink({
    username,
    password,
    apiKey: process.env.BUILDINGLINK_API_KEY,
  });

  return client;
}

/**
 * Returns a text content response for MCP.
 */
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Returns a JSON content response for MCP.
 */
function jsonResult(data: unknown) {
  return textResult(JSON.stringify(data, null, 2));
}

/**
 * Returns an error content response for MCP.
 */
function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// Tool definitions
const TOOLS = [
  {
    name: "login",
    description:
      "Authenticate with BuildingLink. Must be called before other tools if not already authenticated. Returns the authentication token on success.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_buildings",
    description:
      "Get a list of authorized buildings/properties associated with the authenticated user. Returns property details including name, address, coordinates, and management info.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_occupant",
    description:
      "Get the current occupant's information including unit details, contact info, and occupancy status.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_announcements",
    description:
      "Get active announcements from the building management. Returns announcement content, dates, and distribution details.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_deliveries",
    description:
      "Get open deliveries/packages waiting for pickup. Returns delivery details including type, location, description, and authorization status.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_events",
    description:
      "Get calendar events within a date range. Returns event details including title, description, dates, RSVP status, and recurrence info.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from_date: {
          type: "string",
          description:
            "Start date for the event range in ISO 8601 format (e.g. '2025-01-01')",
        },
        to_date: {
          type: "string",
          description:
            "End date for the event range in ISO 8601 format (e.g. '2025-01-31')",
        },
      },
      required: ["from_date", "to_date"],
    },
  },
  {
    name: "get_library",
    description:
      "Get the document library including both apartment-specific and building-wide documents. Documents are scraped from the BuildingLink web interface and include titles, categories, dates, and download URLs.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_vendors",
    description:
      "Get the list of preferred vendors/service providers for the building. Returns vendor details including name, category, contact info, address, and business hours.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_user",
    description:
      "Get the authenticated user's profile information including name, email, phone numbers, and account details. Requires BUILDINGLINK_API_KEY environment variable to be set.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

// Create the MCP server
const server = new Server(
  { name: "buildinglink", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const bl = getClient();

    switch (name) {
      case "login": {
        const token = await bl.login();
        return jsonResult({ authenticated: true, hasToken: !!token });
      }

      case "get_buildings": {
        await bl.login();
        return jsonResult(await bl.getBuildings());
      }

      case "get_occupant": {
        await bl.login();
        return jsonResult(await bl.getOccupant());
      }

      case "get_announcements": {
        await bl.login();
        return jsonResult(await bl.getAnnouncements());
      }

      case "get_deliveries": {
        await bl.login();
        return jsonResult(await bl.getDeliveries());
      }

      case "get_events": {
        await bl.login();
        const fromDate = args?.from_date as string;
        const toDate = args?.to_date as string;

        if (!fromDate || !toDate) {
          throw new Error("from_date and to_date are required");
        }

        const from = new Date(fromDate);
        const to = new Date(toDate);

        if (isNaN(from.getTime()) || isNaN(to.getTime())) {
          throw new Error(
            "Invalid date format. Use ISO 8601 format (e.g. '2025-01-01')"
          );
        }

        return jsonResult(await bl.getEvents(from, to));
      }

      case "get_library": {
        await bl.login();
        const library = await bl.getLibrary();
        return jsonResult({
          aptDocuments: library.aptDocuments.map((doc) => ({
            ...doc,
            postedOn: doc.postedOn?.toISOString(),
            revisedOn: doc.revisedOn?.toISOString(),
            fileBytes: undefined,
          })),
          buildingDocuments: library.buildingDocuments.map((doc) => ({
            ...doc,
            postedOn: doc.postedOn?.toISOString(),
            revisedOn: doc.revisedOn?.toISOString(),
            fileBytes: undefined,
          })),
        });
      }

      case "get_vendors": {
        await bl.login();
        return jsonResult(await bl.getVendors());
      }

      case "get_user": {
        await bl.login();
        return jsonResult(await bl.getUser());
      }

      default:
        return textResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(error);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start BuildingLink MCP server:", error);
  process.exit(1);
});
