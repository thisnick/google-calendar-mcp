// ... existing imports ...
import { z } from "zod";

// Add schemas at the top of the file after imports
export const CreateEventArgsSchema = z.object({
  accountId: z.string(),
  calendarId: z.string().optional(),
  summary: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string(),
  end: z.string()
});

export const SearchEventsArgsSchema = z.object({
  accountId: z.string(),
  query: z.string()
});

export const ListEventsArgsSchema = z.object({
  accountId: z.string(),
  calendarId: z.string().optional(),
  maxResults: z.number().optional().default(10),
  timeMin: z.string().optional(),
  timeMax: z.string().optional()
});

export const SetCalendarDefaultsArgsSchema = z.object({
  accountId: z.string(),
  calendarId: z.string().optional()
});

export const ListCalendarsArgsSchema = z.object({
  accountId: z.string()
});

export type CreateEventArgs = z.infer<typeof CreateEventArgsSchema>;
export type SearchEventsArgs = z.infer<typeof SearchEventsArgsSchema>;
export type ListEventsArgs = z.infer<typeof ListEventsArgsSchema>;
export type SetCalendarDefaultsArgs = z.infer<typeof SetCalendarDefaultsArgsSchema>;
export type ListCalendarsArgs = z.infer<typeof ListCalendarsArgsSchema>;

// ... existing code ...

// Then in the CallToolRequestSchema handler, update the cases:
