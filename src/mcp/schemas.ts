import * as z from "zod/v4";

export const projectSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  updatedAt: z.string(),
  archived: z.boolean(),
  color: z.string().nullable(),
  url: z.string(),
  appUrl: z.string()
});

export const activityRecordSchema = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  projectName: z.string(),
  entityId: z.number().int().positive(),
  entityType: z.string(),
  action: z.string(),
  target: z.string().nullable(),
  summary: z.string(),
  creatorId: z.number().int().positive().nullable(),
  creatorName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  url: z.string(),
  appUrl: z.string()
});

export const messageRecordSchema = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  projectName: z.string(),
  subject: z.string(),
  excerpt: z.string().nullable(),
  attachments: z.number().int().nonnegative(),
  updatedAt: z.string(),
  createdAt: z.string(),
  lastUpdaterId: z.number().int().positive().nullable(),
  lastUpdaterName: z.string().nullable(),
  url: z.string(),
  appUrl: z.string()
});

export const documentRecordSchema = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  projectName: z.string(),
  title: z.string(),
  private: z.boolean(),
  updatedAt: z.string(),
  createdAt: z.string(),
  url: z.string(),
  appUrl: z.string()
});

export const todoRecordSchema = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive(),
  projectName: z.string(),
  todolistId: z.number().int().positive(),
  todolistName: z.string(),
  content: z.string(),
  assigneeId: z.number().int().positive().nullable(),
  assigneeName: z.string().nullable(),
  dueAt: z.string().nullable(),
  completed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  url: z.string(),
  appUrl: z.string()
});

export const projectIdSchema = z.number().int().positive();
export const limitSchema = z.number().int().positive().max(100).optional();
export const hoursSchema = z.number().int().positive().max(24 * 90).optional();

export const listStarredProjectsInputSchema = z.object({});
export const listStarredProjectsOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  projects: z.array(projectSchema)
});

export const getProjectActivityInputSchema = z.object({
  projectId: projectIdSchema.optional(),
  since: z.iso.datetime().optional(),
  hours: hoursSchema,
  eventType: z.string().min(1).optional(),
  limit: limitSchema
});

export const getProjectActivityOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  since: z.string(),
  activities: z.array(activityRecordSchema)
});

export const getProjectMessagesInputSchema = z.object({
  projectId: projectIdSchema.optional(),
  since: z.iso.datetime().optional(),
  hours: hoursSchema,
  limit: limitSchema
});

export const getProjectMessagesOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  since: z.string(),
  messages: z.array(messageRecordSchema)
});

export const getProjectDocumentsInputSchema = z.object({
  projectId: projectIdSchema.optional(),
  since: z.iso.datetime().optional(),
  hours: hoursSchema,
  limit: limitSchema
});

export const getProjectDocumentsOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  since: z.string(),
  documents: z.array(documentRecordSchema)
});

export const getOpenTodosInputSchema = z.object({
  projectId: projectIdSchema.optional(),
  assigneeId: projectIdSchema.optional(),
  dueSince: z.iso.date().optional(),
  limit: limitSchema
});

export const getOpenTodosOutputSchema = z.object({
  assigneeId: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  todos: z.array(todoRecordSchema)
});
