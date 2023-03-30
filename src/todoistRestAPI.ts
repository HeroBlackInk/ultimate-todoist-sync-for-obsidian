import { TodoistApi } from "@doist/todoist-api-typescript"
import { App} from 'obsidian';
import { UltimateTodoistSyncSettings } from 'src/settings';



export class TodoistRestAPI  {
	app:App;
    settings:UltimateTodoistSyncSettings;

	constructor(app, settings) {
		//super(app,settings);
		this.app = app;
        this.settings = settings;
	}


    initializeAPI(){
        const token = this.settings.todoistAPIToken
        const api = new TodoistApi(token)
        return(api)
    }

    async AddTask({ projectId, content, parentId = null, dueDate, labels, description }: { projectId: string, content: string, parentId?: string , dueDate?: string, labels?: Array<string>, description?: string }) {
        const api = await this.initializeAPI()
        try {
          const newTask = await api.addTask({
            projectId,
            content,
            parentId,
            dueDate,
            labels,
            description
          });
          return newTask;
        } catch (error) {
          throw new Error(`Error adding task: ${error.message}`);
        }
    }



    //Also note that to remove the due date of a task completely, you should set the due_string parameter to no date or no due date.
    //api 没有 update task project id 的函数
    async UpdateTask(taskId: string, updates: { content?: string, labels?:Array<string>,dueDate?: string,dueString?:string,parentId?:string }) {
        const api = await this.initializeAPI()
        if (!taskId) {
        throw new Error('taskId is required');
        }
        if (!updates.content && !updates.dueDate  && !updates.dueString && !updates.labels &&!updates.parentId) {
        throw new Error('At least one update is required');
        }
        try {
        const updatedTask = await api.updateTask(taskId, updates);
        return updatedTask;
        } catch (error) {
        throw new Error(`Error updating task: ${error.message}`);
        }
    }

    //open a task
    async OpenTask(taskId:string) {
        const api = await this.initializeAPI()
        try {
    
        const isSuccess = await api.reopenTask(taskId);
        console.log(`task ${taskId} opend`)
        return(isSuccess)
    
        } catch (error) {
            console.error('Error open a  task:', error);
            return
        }
    }

    // Close a task in Todoist API
    async CloseTask(taskId: string): Promise<boolean> {
        const api = await this.initializeAPI()
        try {
        const isSuccess = await api.closeTask(taskId);
        console.log(`task ${taskId} closed`)
        return isSuccess;
        } catch (error) {
        console.error('Error closing task:', error);
        throw error; // 抛出错误使调用方能够捕获并处理它
        }
    }
  
    

 
    // get a task by Id
    async getTaskById(taskId: string) {
        const api = await this.initializeAPI()
        if (!taskId) {
        throw new Error('taskId is required');
        }
        try {
        const task = await api.getTask(taskId);
        return task;
        } catch (error) {
        throw new Error(`Error updating task: ${error.message}`);
        }
    }

    //get a task due by id
    async getTaskDueById(taskId: string) {
        const api = await this.initializeAPI()
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
        const api = await this.initializeAPI()
        try {
        const result = await api.getProjects();
        return(result)
    
        } catch (error) {
            console.error('Error get all projects', error);
            return false
        }
    }


}





















