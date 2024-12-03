#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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

const server = new Server(
  {
    name: "Google Calendar",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  const resources = [];

  // List events from all connected accounts
  for (const [accountId, auth] of Object.entries(authInstances)) {
    google.options({ auth });

    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - 7); // Last 7 days

    const params = {
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime'
    };

    const res = await calendar.events.list(params);
    const events = res.data.items!;

    // Add events as resources with account prefix
    resources.push(...events.map(event => ({
      uri: `gcal://${accountId}/${event.id}`,
      mimeType: "application/json",
      name: event.summary || "Untitled Event",
      description: `${event.start?.dateTime || event.start?.date} - ${event.end?.dateTime || event.end?.date}`
    })));
  }

  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  // Parse account and event ID from URI
  const [_, accountId, eventId] = request.params.uri.split('/');
  const auth = getAuthInstance(accountId);

  if (!auth) {
    throw new Error(`Account ${accountId} not found`);
  }

  google.options({ auth });

  const event = await calendar.events.get({
    calendarId: 'primary',
    eventId: eventId
  });

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "application/json",
      text: JSON.stringify(event.data, null, 2)
    }]
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_event",
        description: "Create a new calendar event",
        inputSchema: zodToJsonSchema(CreateEventArgsSchema)
      },
      {
        name: "search_events",
        description: "Search for calendar events",
        inputSchema: zodToJsonSchema(SearchEventsArgsSchema)
      },
      {
        name: "list_events",
        description: "List calendar events",
        inputSchema: zodToJsonSchema(ListEventsArgsSchema)
      },
      {
        name: "set_calendar_defaults",
        description: "Set default account and calendar",
        inputSchema: zodToJsonSchema(SetCalendarDefaultsArgsSchema)
      },
      {
        name: "list_calendar_accounts",
        description: "List all authenticated Google Calendar accounts",
        inputSchema: zodToJsonSchema(ListCalendarsArgsSchema)
      },
      {
        name: "list_calendars",
        description: "List all calendars in an account",
        inputSchema: zodToJsonSchema(ListCalendarsArgsSchema)
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const accountId = request.params.arguments?.accountId as string;
  const auth = getAuthInstance(accountId);

  if (!auth) {
    throw new Error(`Account ${accountId} not found`);
  }

  google.options({ auth });

  switch (request.params.name) {
    case "create_event": {
      const settings = loadSettings();
      const args = CreateEventArgsSchema.safeParse(request.params.arguments);

      if (!args.success) {
        throw new Error(`Invalid arguments: ${args.error.message}`);
      }

      const { summary, description, start, end, calendarId, location } = args.data;

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
    }

    case "search_events": {
      const args = SearchEventsArgsSchema.safeParse(request.params.arguments);

      if (!args.success) {
        throw new Error(`Invalid arguments: ${args.error.message}`);
      }

      const { query } = args.data;

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
    }

    case "list_events": {
      const args = ListEventsArgsSchema.safeParse(request.params.arguments);

      if (!args.success) {
        throw new Error(`Invalid arguments: ${args.error.message}`);
      }

      const { accountId, calendarId, maxResults = 10, timeMin, timeMax } = args.data;
      const auth = getAuthInstance(accountId);

      if (!auth) {
        throw new Error(`Account ${accountId} not found`);
      }

      google.options({ auth });

      const defaultTimeMin = new Date();
      defaultTimeMin.setDate(defaultTimeMin.getDate() - 7);

      // If calendarId is provided, list events from that calendar only
      if (calendarId) {
        try {
          await calendar.calendars.get({ calendarId });
        } catch (error) {
          throw new Error(`Calendar ${calendarId} not found`);
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

      // If no calendarId provided, list events from all calendars
      const calendarsResponse = await calendar.calendarList.list();
      const calendars = calendarsResponse.data.items || [];
      let allEvents = [];

      for (const cal of calendars) {
        if (!cal.id) continue; // Skip calendars without IDs

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

      // Sort all events by start time
      allEvents.sort((a, b) => {
        const dateA = a.start ? new Date(a.start).getTime() : 0;
        const dateB = b.start ? new Date(b.start).getTime() : 0;
        return dateA - dateB;
      });

      // Take only the requested number of events
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
    }

    case "set_calendar_defaults": {
      const args = SetCalendarDefaultsArgsSchema.safeParse(request.params.arguments);

      if (!args.success) {
        throw new Error(`Invalid arguments: ${args.error.message}`);
      }

      const { accountId, calendarId } = args.data;

      // Verify account exists
      if (!authInstances[accountId]) {
        throw new Error(`Account ${accountId} not found`);
      }

      // Verify calendar exists if provided
      if (calendarId) {
        google.options({ auth });
        try {
          await calendar.calendars.get({ calendarId });
        } catch {
          throw new Error(`Calendar ${calendarId} not found`);
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
    }

    case "list_calendar_accounts": {
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
    }

    case "list_calendars": {
      const args = ListCalendarsArgsSchema.safeParse(request.params.arguments);

      if (!args.success) {
        throw new Error(`Invalid arguments: ${args.error.message}`);
      }

      const { accountId } = args.data;
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
    }

    default:
      throw new Error("Tool not found");
  }
});

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

async function authenticateAccount(accountId: string) {
  console.log(`Launching auth flow for account ${accountId}...`);
  const oAuth2Client = getOAuthClient();

  // Generate auth url
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent' // Forces refresh token generation
  });

  console.log('Authorize this app by visiting this url:', authUrl);

  // You'll need to implement this to get the code from user input
  const code = await getAuthorizationCode();

  // Exchange code for tokens
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  // Save tokens
  fs.writeFileSync(
    getTokensPath(accountId),
    JSON.stringify(tokens)
  );

  console.log(`Tokens saved for account ${accountId}`);
  return oAuth2Client;
}

async function loadCredentialsAndRunServer() {
  // Load all token files
  const tokenFiles = fs.readdirSync(path.join(path.dirname(new URL(import.meta.url).pathname), ".."))
    .filter(f => f.startsWith('.gcal-tokens-'));

  if (tokenFiles.length === 0) {
    console.error("No tokens found. Please run with 'auth <account-id>' first.");
    process.exit(1);
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
      console.log(`Tokens refreshed for account ${accountId}`);
    });

    authInstances[accountId] = oAuth2Client;
  }

  console.log(`Loaded tokens for ${Object.keys(authInstances).length} accounts`);

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

if (process.argv[2] === "auth") {
  const accountId = process.argv[3];
  if (!accountId) {
    console.error("Please provide an account ID");
    process.exit(1);
  }
  authenticateAccount(accountId).catch(console.error);
} else {
  loadCredentialsAndRunServer().catch(console.error);
}
