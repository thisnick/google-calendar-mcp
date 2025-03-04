#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { OAuth2Client } from 'google-auth-library';
import { CreateEventArgsSchema,
  SearchEventsArgsSchema,
  ListEventsArgsSchema,
  SetCalendarDefaultsArgsSchema,
  ListCalendarsArgsSchema,
} from "./types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

const calendar = google.calendar("v3");

// Store multiple auth instances
const authInstances: { [accountId: string]: any } = {};

interface Settings {
  defaultAccountId?: string;
  defaultCalendarId?: string;
}

function getSettingsPath() {
  return path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    ".gcal-settings.json"
  );
}

function loadSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"));
  } catch {
    return {};
  }
}

function saveSettings(settings: Settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function getAuthInstance(accountId?: string): OAuth2Client {
  if (!accountId) {
    const settings = loadSettings();
    accountId = settings.defaultAccountId;

    if (!accountId) {
      const firstAccount = Object.keys(authInstances)[0];
      if (!firstAccount) throw new Error("No authenticated accounts found");
      return authInstances[firstAccount];
    }
  }
  const auth = authInstances[accountId];
  if (!auth) throw new Error(`Account ${accountId} not found`);
  return auth;
}

interface ToolCapability {
  description: string;
  inputSchema: any;
  outputSchema: any;
}

interface ServerCapabilities {
  resources: {
    [mimeType: string]: {
      description: string;
    };
  };
  tools: {
    [name: string]: ToolCapability;
  };
}

// Store tool definitions for reuse
const toolDefinitions = {
  create_event: {
    description: "Create a new calendar event",
    inputSchema: zodToJsonSchema(CreateEventArgsSchema),
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["text"] },
              text: { type: "string" }
            },
            required: ["type", "text"]
          }
        }
      },
      required: ["content"]
    }
  },
  search_events: {
    description: "Search for calendar events",
    inputSchema: zodToJsonSchema(SearchEventsArgsSchema),
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["text"] },
              text: { type: "string" }
            },
            required: ["type", "text"]
          }
        }
      },
      required: ["content"]
    }
  },
  list_events: {
    description: "List calendar events",
    inputSchema: zodToJsonSchema(ListEventsArgsSchema),
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["text"] },
              text: { type: "string" }
            },
            required: ["type", "text"]
          }
        }
      },
      required: ["content"]
    }
  },
  set_calendar_defaults: {
    description: "Set default account and calendar",
    inputSchema: zodToJsonSchema(SetCalendarDefaultsArgsSchema),
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["text"] },
              text: { type: "string" }
            },
            required: ["type", "text"]
          }
        }
      },
      required: ["content"]
    }
  },
  list_calendar_accounts: {
    description: "List all authenticated Google Calendar accounts",
    inputSchema: zodToJsonSchema(ListCalendarsArgsSchema),
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["text"] },
              text: { type: "string" }
            },
            required: ["type", "text"]
          }
        }
      },
      required: ["content"]
    }
  },
  list_calendars: {
    description: "List all calendars in an account",
    inputSchema: zodToJsonSchema(ListCalendarsArgsSchema),
    outputSchema: {
      type: "object",
      properties: {
        content: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["text"] },
              text: { type: "string" }
            },
            required: ["type", "text"]
          }
        }
      },
      required: ["content"]
    }
  }
};

const server = new McpServer({
  name: "Google Calendar",
  version: "0.1.0",
  protocolVersion: "2.0"
}, {
  capabilities: {
    tools: toolDefinitions
  }
});

// Register tools
server.tool(
  "create_event",
  CreateEventArgsSchema.shape,
  async ({ summary, description, start, end, calendarId, location, accountId }: z.infer<typeof CreateEventArgsSchema>) => {
    const auth = getAuthInstance(accountId);
    google.options({ auth });
    const settings = loadSettings();

    try {
      const event = await calendar.events.insert({
        calendarId: calendarId || settings.defaultCalendarId || 'primary',
        requestBody: {
          summary,
          description,
          start: { dateTime: start },
          end: { dateTime: end },
          location
        }
      });

      return {
        content: [{
          type: "text",
          text: `Created event: ${event.data.htmlLink}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to create event: ${error.message}`);
    }
  }
);

server.tool(
  "search_events",
  SearchEventsArgsSchema.shape,
  async ({ query, accountId }: z.infer<typeof SearchEventsArgsSchema>) => {
    const auth = getAuthInstance(accountId);
    google.options({ auth });

    try {
      const res = await calendar.events.list({
        calendarId: 'primary',
        q: query,
        maxResults: 10
      });

      const eventList = res.data.items
        ?.map(event => `${event.summary} (${event.start?.dateTime || event.start?.date})`)
        .join("\n");

      return {
        content: [{
          type: "text",
          text: `Found ${res.data.items?.length ?? 0} events:\n${eventList}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to search events: ${error.message}`);
    }
  }
);

server.tool(
  "list_events",
  ListEventsArgsSchema.shape,
  async ({ accountId, calendarId, maxResults = 10, timeMin, timeMax }: z.infer<typeof ListEventsArgsSchema>) => {
    const auth = getAuthInstance(accountId);
    google.options({ auth });

    const defaultTimeMin = new Date();
    defaultTimeMin.setDate(defaultTimeMin.getDate() - 7);

    try {
      if (calendarId) {
        try {
          await calendar.calendars.get({ calendarId });
        } catch (error: any) {
          throw new Error(`Calendar ${calendarId} not found: ${error.message}`);
        }

        const params = {
          calendarId,
          timeMin: timeMin || defaultTimeMin.toISOString(),
          timeMax: timeMax || undefined,
          maxResults,
          singleEvents: true,
          orderBy: 'startTime'
        };

        const res = await calendar.events.list(params);
        const eventList = res.data.items
          ?.map(event => `- ${event.summary || 'Untitled'} (${event.start?.dateTime || event.start?.date})`)
          .join("\n");

        return {
          content: [{
            type: "text",
            text: `Events for calendar ${calendarId} in account ${accountId}:\n${eventList}`
          }]
        };
      }

      const calendarsResponse = await calendar.calendarList.list();
      const calendars = calendarsResponse.data.items || [];
      let allEvents = [];

      for (const cal of calendars) {
        if (!cal.id) continue;

        const params = {
          calendarId: cal.id,
          timeMin: timeMin || defaultTimeMin.toISOString(),
          timeMax: timeMax || undefined,
          maxResults,
          singleEvents: true,
          orderBy: 'startTime'
        };

        const res = await calendar.events.list(params);
        const events = res.data.items || [];
        allEvents.push(...events.map(event => ({
          summary: event.summary || 'Untitled',
          calendar: cal.summary,
          start: event.start?.dateTime || event.start?.date
        })));
      }

      allEvents.sort((a, b) => {
        const dateA = a.start ? new Date(a.start).getTime() : 0;
        const dateB = b.start ? new Date(b.start).getTime() : 0;
        return dateA - dateB;
      });

      allEvents = allEvents.slice(0, maxResults);

      const eventList = allEvents
        .map(event => `- [${event.calendar}] ${event.summary} (${event.start})`)
        .join("\n");

      return {
        content: [{
          type: "text",
          text: `Events across all calendars for account ${accountId}:\n${eventList}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to list events: ${error.message}`);
    }
  }
);

server.tool(
  "set_calendar_defaults",
  SetCalendarDefaultsArgsSchema.shape,
  async ({ accountId, calendarId }: z.infer<typeof SetCalendarDefaultsArgsSchema>) => {
    if (!authInstances[accountId]) {
      throw new Error(`Account ${accountId} not found`);
    }

    const auth = getAuthInstance(accountId);
    google.options({ auth });

    try {
      if (calendarId) {
        try {
          await calendar.calendars.get({ calendarId });
        } catch (error: any) {
          throw new Error(`Calendar ${calendarId} not found: ${error.message}`);
        }
      }

      const settings = loadSettings();
      settings.defaultAccountId = accountId;
      if (calendarId) settings.defaultCalendarId = calendarId;
      saveSettings(settings);

      return {
        content: [{
          type: "text",
          text: `Default account set to ${accountId}${calendarId ? ` and calendar set to ${calendarId}` : ''}`
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to set calendar defaults: ${error.message}`);
    }
  }
);

server.tool(
  "list_calendar_accounts",
  z.object({}).shape,
  async () => {
    try {
      const accounts = Object.keys(authInstances).map(accountId => {
        const isDefault = loadSettings().defaultAccountId === accountId;
        return `${isDefault ? '* ' : '- '}${accountId}`;
      }).join('\n');

      return {
        content: [{
          type: "text",
          text: accounts ? `Available accounts:\n${accounts}\n(* indicates default account)` : "No accounts configured"
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to list calendar accounts: ${error.message}`);
    }
  }
);

server.tool(
  "list_calendars",
  ListCalendarsArgsSchema.shape,
  async ({ accountId }: z.infer<typeof ListCalendarsArgsSchema>) => {
    const auth = getAuthInstance(accountId);
    google.options({ auth });

    try {
      const calendars = await calendar.calendarList.list();
      const defaultCalendarId = loadSettings().defaultCalendarId;

      const calendarList = calendars.data.items?.map(cal => {
        const isDefault = cal.id === defaultCalendarId;
        return `${isDefault ? '* ' : '- '}${cal.summary} (${cal.id})`;
      }).join('\n');

      return {
        content: [{
          type: "text",
          text: calendarList ? `Available calendars:\n${calendarList}\n(* indicates default calendar)` : "No calendars found"
        }]
      };
    } catch (error: any) {
      throw new Error(`Failed to list calendars: ${error.message}`);
    }
  }
);

// Helper to get tokens path for an account
const getTokensPath = (accountId: string) => {
  return path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    `.gcal-tokens-${accountId}.json`
  );
};

// Create OAuth client from credentials file
function getOAuthClient() {
  const credentials = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".client_secret.json"),
      "utf-8"
    )
  );

  return new google.auth.OAuth2(
    credentials.installed.client_id,
    credentials.installed.client_secret,
    "urn:ietf:wg:oauth:2.0:oob"
  );
}

async function loadCredentialsAndRunServer() {
  const tokenFiles = fs.readdirSync(path.join(path.dirname(new URL(import.meta.url).pathname), ".."))
    .filter(f => f.startsWith('.gcal-tokens-'));

  if (tokenFiles.length === 0) {
    throw new Error("No tokens found. Please run with 'auth <account-id>' first.");
  }

  // Initialize auth for each account
  for (const file of tokenFiles) {
    const accountId = file.replace('.gcal-tokens-', '').replace('.json', '');
    const tokens = JSON.parse(
      fs.readFileSync(getTokensPath(accountId), "utf-8")
    );

    const oAuth2Client = getOAuthClient();
    oAuth2Client.setCredentials(tokens);

    // Set up token refresh handler
    oAuth2Client.on('tokens', (tokens) => {
      const allTokens = {
        ...JSON.parse(fs.readFileSync(getTokensPath(accountId), "utf-8")),
        ...tokens
      };
      fs.writeFileSync(getTokensPath(accountId), JSON.stringify(allTokens));
    });

    authInstances[accountId] = oAuth2Client;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Helper function to get authorization code from user
async function getAuthorizationCode(): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Enter the authorization code: ', (code: string) => {
      rl.close();
      resolve(code.trim());
    });
  });
}

async function authenticateAccount(accountId: string) {
  const oAuth2Client = getOAuthClient();

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent'
  });

  console.log(`Please authorize this app by visiting: ${authUrl}`);

  const code = await getAuthorizationCode();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  fs.writeFileSync(
    getTokensPath(accountId),
    JSON.stringify(tokens)
  );

  console.log(`Successfully authenticated ${accountId}`);
  return oAuth2Client;
}

if (process.argv[2] === "auth") {
  const accountId = process.argv[3];
  if (!accountId) {
    throw new Error("Please provide an account ID");
  }
  authenticateAccount(accountId).catch(error => {
    console.error("Authentication failed:", error.message);
    process.exit(1);
  });
} else {
  loadCredentialsAndRunServer().catch(error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
}
