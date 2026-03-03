export type BasecampPerson = {
  id: number;
  name: string;
  email_address?: string;
};

export type BasecampStar = {
  project_id: number;
  created_at: string;
  url: string;
  app_url: string;
};

export type BasecampProject = {
  id: number;
  name: string;
  description: string | null;
  updated_at: string;
  url: string;
  app_url: string;
  template: boolean;
  archived: boolean;
  starred: boolean;
  trashed: boolean;
  draft: boolean;
  is_client_project: boolean;
  color: string | null;
};

export type BasecampBucket = {
  id: number;
  name: string;
  type: string;
  url: string;
  app_url: string;
};

export type BasecampEvent = {
  id: number;
  created_at: string;
  updated_at: string;
  action: string;
  target: string | null;
  summary: string;
  url: string;
  html_url: string;
  creator?: BasecampPerson;
  bucket?: BasecampBucket;
  eventable: {
    id: number;
    type: string;
    url: string;
    app_url: string;
  };
};

export type BasecampTopic = {
  id: number;
  title: string;
  excerpt: string | null;
  created_at: string;
  updated_at: string;
  attachments: number;
  private: boolean;
  trashed: boolean;
  last_updater: BasecampPerson | null;
  topicable: {
    id: number;
    type: string;
    url: string;
    app_url: string;
  };
  bucket?: BasecampBucket;
};

export type BasecampDocument = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  url: string;
  app_url: string;
  private: boolean;
  trashed: boolean;
  bucket?: BasecampBucket;
};

export type BasecampTodo = {
  id: number;
  todolist_id: number;
  position: number;
  content: string;
  due_at: string | null;
  due_on: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | false;
  comments_count: number;
  private: boolean;
  trashed: boolean;
  completed: boolean;
  url: string;
  app_url: string;
  assignee?: {
    id: number;
    type: string;
    name: string;
  } | null;
};

export type BasecampAssignedTodoList = {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  url: string;
  app_url: string;
  completed: boolean;
  position: number;
  private: boolean;
  trashed: boolean;
  completed_count: number;
  remaining_count: number;
  bucket?: BasecampBucket;
  assigned_todos: BasecampTodo[];
};

export type ProjectSummary = {
  id: number;
  name: string;
  description: string | null;
  updatedAt: string;
  archived: boolean;
  color: string | null;
  url: string;
  appUrl: string;
};

export type ActivityRecord = {
  id: number;
  projectId: number;
  projectName: string;
  entityId: number;
  entityType: string;
  action: string;
  target: string | null;
  summary: string;
  creatorId: number | null;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  appUrl: string;
};

export type MessageRecord = {
  id: number;
  projectId: number;
  projectName: string;
  subject: string;
  excerpt: string | null;
  attachments: number;
  updatedAt: string;
  createdAt: string;
  lastUpdaterId: number | null;
  lastUpdaterName: string | null;
  url: string;
  appUrl: string;
};

export type DocumentRecord = {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  private: boolean;
  updatedAt: string;
  createdAt: string;
  url: string;
  appUrl: string;
};

export type TodoRecord = {
  id: number;
  projectId: number;
  projectName: string;
  todolistId: number;
  todolistName: string;
  content: string;
  assigneeId: number | null;
  assigneeName: string | null;
  dueAt: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  url: string;
  appUrl: string;
};
