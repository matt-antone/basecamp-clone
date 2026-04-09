import type {
  ActivityRecord,
  BasecampAccess,
  BasecampAssignedTodoList,
  BasecampDocument,
  BasecampEvent,
  BasecampProject,
  BasecampTodo,
  BasecampTopic,
  DocumentRecord,
  MessageRecord,
  ProjectMemberRecord,
  ProjectSummary,
  TodoRecord
} from "./types.js";

export function normalizeProjectMember(access: BasecampAccess): ProjectMemberRecord {
  return {
    id: access.id,
    name: access.name,
    emailAddress: access.email_address ?? null
  };
}

export function normalizeProject(project: BasecampProject): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    updatedAt: project.updated_at,
    archived: project.archived,
    color: project.color,
    url: project.url,
    appUrl: project.app_url
  };
}

export function normalizeActivity(
  event: BasecampEvent,
  project: ProjectSummary
): ActivityRecord {
  return {
    id: event.id,
    projectId: project.id,
    projectName: project.name,
    entityId: event.eventable.id,
    entityType: event.eventable.type,
    action: event.action,
    target: event.target,
    summary: event.summary,
    creatorId: event.creator?.id ?? null,
    creatorName: event.creator?.name ?? null,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    url: event.url,
    appUrl: event.html_url
  };
}

export function normalizeMessage(
  topic: BasecampTopic,
  project: ProjectSummary
): MessageRecord {
  return {
    id: topic.id,
    messageId: topic.topicable.id,
    projectId: project.id,
    projectName: project.name,
    subject: topic.title,
    excerpt: topic.excerpt,
    attachments: topic.attachments,
    updatedAt: topic.updated_at,
    createdAt: topic.created_at,
    lastUpdaterId: topic.last_updater?.id ?? null,
    lastUpdaterName: topic.last_updater?.name ?? null,
    url: topic.topicable.url,
    appUrl: topic.topicable.app_url
  };
}

export function normalizeDocument(
  document: BasecampDocument,
  project: ProjectSummary
): DocumentRecord {
  return {
    id: document.id,
    projectId: project.id,
    projectName: project.name,
    title: document.title,
    private: document.private,
    updatedAt: document.updated_at,
    createdAt: document.created_at,
    url: document.url,
    appUrl: document.app_url
  };
}

export function normalizeTodo(
  todolist: BasecampAssignedTodoList,
  todo: BasecampTodo,
  project: ProjectSummary
): TodoRecord {
  return {
    id: todo.id,
    projectId: project.id,
    projectName: project.name,
    todolistId: todolist.id,
    todolistName: todolist.name,
    content: todo.content,
    assigneeId: todo.assignee?.id ?? null,
    assigneeName: todo.assignee?.name ?? null,
    dueAt: todo.due_at ?? todo.due_on,
    completed: todo.completed,
    createdAt: todo.created_at,
    updatedAt: todo.updated_at,
    url: todo.url,
    appUrl: todo.app_url
  };
}
