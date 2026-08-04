import { TodoistApi } from "@doist/todoist-sdk"
import { App, requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";
type IdMappingObjectName = 'projects' | 'tasks' | 'sections';

function normalizeRequestHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const normalizedHeaders: Record<string, string> = {};
    headers.forEach((value, key) => {
      normalizedHeaders[key] = String(value);
    });
    return normalizedHeaders;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, String(value)]));
  }

  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function normalizeResponseHeaders(headers: RequestUrlResponse['headers']): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)])
  );
}

function createObsidianFetchAdapter(requestUrlFn: (request: RequestUrlParam | string) => Promise<RequestUrlResponse>) {
  return async (url: string, options?: RequestInit & { timeout?: number }) => {
    const body = options?.body;
    const normalizedBody = typeof body === 'string'
      ? body
      : body instanceof URLSearchParams
        ? body.toString()
        : body == null
          ? undefined
          : String(body);

    const response = await requestUrlFn({
      url,
      method: options?.method ?? 'GET',
      headers: normalizeRequestHeaders(options?.headers),
      body: normalizedBody,
      throw: false,
    });

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: '',
      headers: normalizeResponseHeaders(response.headers),
      text: async () => typeof response.text === 'string' ? response.text : JSON.stringify(response.json ?? ''),
      json: async () => response.json,
    };
  };
}

export class TodoistRestAPI  {
	app:App;
  plugin: UltimateTodoistSyncForObsidian;
  private api: TodoistApi | null = null;
  private apiToken = '';
  private readonly idMappingCache = new Map<string, string>();

	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
    this.plugin = plugin;
	}

  private getApi(): TodoistApi {
    const token = this.plugin.settings.todoistAPIToken;
    if (!token) {
      throw new Error('Todoist API token is missing');
    }

    if (!this.api || this.apiToken !== token) {
      this.api = new TodoistApi(token, {
        customFetch: createObsidianFetchAdapter(requestUrl),
      });
      this.apiToken = token;
      this.idMappingCache.clear();
    }

    return this.api;
  }

  private isLegacyNumericId(id?: string | null): id is string {
    return typeof id === 'string' && /^\d+$/.test(id);
  }

  async resolveId(objName: IdMappingObjectName, id?: string | null): Promise<string | undefined> {
    if (!id) {
      return undefined;
    }

    if (!this.isLegacyNumericId(id)) {
      return id;
    }

    const cacheKey = `${objName}:${id}`;
    const cached = this.idMappingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const mappings = await this.getApi().getIdMappings({
      objName,
      objIds: [id],
    });

    const resolved = mappings.find((entry) => entry.oldId === id)?.newId ?? id;
    if (resolved && resolved !== id) {
      this.idMappingCache.set(cacheKey, resolved);
    }

    return resolved;
  }

  async resolveIds(objName: IdMappingObjectName, ids: string[]): Promise<Record<string, string>> {
    const uniqueIds = Array.from(new Set(ids.filter((id): id is string => this.isLegacyNumericId(id))));
    if (uniqueIds.length === 0) {
      return {};
    }

    const uncached = uniqueIds.filter((id) => !this.idMappingCache.has(`${objName}:${id}`));
    if (uncached.length > 0) {
      const mappings = await this.getApi().getIdMappings({
        objName,
        objIds: uncached as [string, ...string[]],
      });

      for (const mapping of mappings) {
        if (mapping.oldId && mapping.newId) {
          this.idMappingCache.set(`${objName}:${mapping.oldId}`, mapping.newId);
        }
      }
    }

    return Object.fromEntries(uniqueIds.map((id) => [id, this.idMappingCache.get(`${objName}:${id}`) ?? id]));
  }

    initializeAPI(){
        return this.getApi()
    }

    async AddTask({ projectId, content, parentId, dueDate, dueDatetime,labels, description,priority }: { projectId?: string, content: string, parentId?: string | null , dueDate?: string,dueDatetime?: string, labels?: Array<string>, description?: string,priority?:number }) {
        const api = this.initializeAPI()
        try {
      const addTaskArgs: Record<string, unknown> = {
        content,
        parentId: parentId || undefined,
        labels,
        description,
        priority,
      };

      if (projectId) {
        addTaskArgs.projectId = projectId;
      }

      if (dueDate) {
        addTaskArgs.dueDate = dueDate;
      } else if (dueDatetime) {
        addTaskArgs.dueDatetime = dueDatetime;
      }

      const newTask = await api.addTask(addTaskArgs as any);
          return newTask;
        } catch (error) {
          throw new Error(`Error adding task: ${error.message}`);
        }
    }


    //options:{ projectId?: string, section_id?: string, label?: string , filter?: string,lang?: string, ids?: Array<string>}
    async GetActiveTasks(options:{ projectId?: string, section_id?: string, label?: string , filter?: string,lang?: string, ids?: Array<string>}) {
      const api = this.initializeAPI()
      try {
        const result = await api.getTasks({
			projectId: options.projectId,
			sectionId: options.section_id,
			label: options.label,
			ids: options.ids,
		});
        return result.results;
      } catch (error) {
        throw new Error(`Error get active tasks: ${error.message}`);
      }
    }


    //Also note that to remove the due date of a task completely, you should set the due_string parameter to no date or no due date.
    //api 没有 update task project id 的函数
    async UpdateTask(taskId: string, updates: { content?: string, description?: string, labels?:Array<string>,dueDate?: string,dueDatetime?: string,dueString?:string,parentId?:string,priority?:number }) {
        const api = this.initializeAPI()
        if (!taskId) {
        throw new Error('taskId is required');
        }
        if (!updates.content && !updates.description &&!updates.dueDate && !updates.dueDatetime && !updates.dueString && !updates.labels &&!updates.parentId && !updates.priority) {
        throw new Error('At least one update is required');
        }
        try {
        if (updates.parentId) {
			await api.moveTask(taskId, { parentId: updates.parentId });
		}

    const updateTaskArgs: Record<string, unknown> = {
      content: updates.content,
      description: updates.description,
      labels: updates.labels,
      priority: updates.priority,
    };

    if (updates.dueDate) {
      updateTaskArgs.dueDate = updates.dueDate;
    } else if (updates.dueDatetime) {
      updateTaskArgs.dueDatetime = updates.dueDatetime;
    } else if (updates.dueString !== undefined) {
      updateTaskArgs.dueString = updates.dueString || null;
    }

    const updatedTask = await api.updateTask(taskId, updateTaskArgs as any);
        return updatedTask;
        } catch (error) {
        throw new Error(`Error updating task: ${error.message}`);
        }
    }




    //open a task
    async OpenTask(taskId:string): Promise<boolean> {
      const api = this.initializeAPI()
        try {
        const isSuccess = await api.reopenTask(taskId);
        this.plugin.debugLog(`Task ${taskId} is reopend`)
        return(isSuccess)
    
        } catch (error) {
            console.error('Error open a  task:', error);
            throw error;
        }
    }

    // Close a task in Todoist API
    async CloseTask(taskId: string): Promise<boolean> {
      const api = this.initializeAPI()
        try {
        const isSuccess = await api.closeTask(taskId);
        this.plugin.debugLog(`Task ${taskId} is closed`)
        return isSuccess;
        } catch (error) {
        console.error('Error closing task:', error);
        throw error; // 抛出错误使调用方能够捕获并处理它
        }
    }
  
    

 
    /**
     * Ask Todoist directly what became of a task, for tasks that are absent from
     * the sync response.
     *
     * `/api/v1/sync` only returns active items, so a task completed in Todoist
     * disappears from it entirely instead of coming back with checked=true — which
     * is indistinguishable from deletion without asking. This lookup is definitive
     * regardless of how long ago the task was completed, unlike a completed-tasks
     * query over a date window.
     *
     * Never throws: transport, auth and rate-limit failures all report 'unknown',
     * because the callers use this to decide whether to disable a task's sync and
     * must not do that on the strength of a failed request.
     */
    async getTaskCompletionState(taskId: string): Promise<'completed' | 'active' | 'missing' | 'unknown'> {
        if (!taskId) return 'unknown';

        // These calls go through the SDK, which does not pass through the plugin's
        // own rate-limit accounting, so a repair sweep over many tasks can walk
        // into a 429. Without this retry a throttled batch would silently report
        // 'unknown' and look identical to "nothing happened".
        const MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const task = await this.initializeAPI().getTask(taskId);
                if (!task) return 'missing';
                if ((task as { isDeleted?: boolean }).isDeleted) return 'missing';
                return task.checked ? 'completed' : 'active';
            } catch (error) {
                const statusCode = (error as { httpStatusCode?: number })?.httpStatusCode;
                if (statusCode === 404) return 'missing';

                if (statusCode === 429 && attempt < MAX_ATTEMPTS) {
                    const retryAfterSeconds = Number((error as { responseData?: { error_extra?: { retry_after?: unknown } } })?.responseData?.error_extra?.retry_after);
                    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
                        ? Math.min(retryAfterSeconds * 1000, 30_000)
                        : attempt * 1000;
                    this.plugin.debugLog(`[TodoistRestAPI] Rate limited on ${taskId}, retrying in ${waitMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                    continue;
                }

                console.warn(`[TodoistRestAPI] Could not determine completion state for ${taskId} (HTTP ${statusCode ?? 'n/a'}):`, error);
                return 'unknown';
            }
        }

        return 'unknown';
    }

    // get a task by Id
    async getTaskById(taskId: string) {
      const api = this.initializeAPI()
        if (!taskId) {
        throw new Error('taskId is required');
        }
        try {
        const task = await api.getTask(taskId);
        return task;
        } catch (error) {
          if (error.response && error.response.status) {
            const statusCode = error.response.status;
            throw new Error(`Error retrieving task. Status code: ${statusCode}`);
          } else {
            throw new Error(`Error retrieving task: ${error.message}`);
          }
        }
    }

    //get a task due by id
    async getTaskDueById(taskId: string) {
      const api = this.initializeAPI()
        if (!taskId) {
        throw new Error('taskId is required');
        }
        try {
        const task = await api.getTask(taskId);
        const due = task.due ?? null
        return due;
        } catch (error) {
        throw new Error(`Error updating task: ${error.message}`);
        }
    }


    //get all projects
    async GetAllProjects() {
        const api = this.initializeAPI()
        try {
        const projects = [];
    let cursor: string | null = null;
    do {
      const result = await api.getProjects({ cursor: cursor ?? undefined, limit: 200 });
      projects.push(...result.results);
      cursor = result.nextCursor;
    } while (cursor);

    return projects;
    
        } catch (error) {
            console.error('Error get all projects', error);
            return false
        }
    }

  async DeleteTask(taskId: string): Promise<boolean> {
    const api = this.initializeAPI();
    try {
      return await api.deleteTask(taskId);
    } catch (error) {
      throw new Error(`Error deleting task: ${error.message}`);
    }
  }


}





















