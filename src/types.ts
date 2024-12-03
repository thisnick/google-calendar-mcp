// ... existing imports ...
import { z } from "zod";

// Add schemas at the top of the file after imports
export const CreateEventArgsSchema = z.object({
  accountId: z.string().optional(),
  calendarId: z.string().optional(),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string(),
  end: z.string()
});

export const SearchEventsArgsSchema = z.object({
  accountId: z.string().optional(),
  query: z.string()
});

export const ListEventsArgsSchema = z.object({
  accountId: z.string(),
  calendarId: z.string().optional(),
  maxResults: z.number().int().positive().default(10),
  timeMin: z.string(),
  timeMax: z.string()
});

export const SetCalendarDefaultsArgsSchema = z.object({
  accountId: z.string(),
  calendarId: z.string().optional()
});

export const ListCalendarsArgsSchema = z.object({
  accountId: z.string()
});

// ... existing code ...

// Then in the CallToolRequestSchema handler, update the cases:
