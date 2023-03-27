import MyPlugin from "main";
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting ,TFile} from 'obsidian';
import { MyPluginSettings } from 'src/settings';
import { TodoistRestAPI } from "./todoistRestAPI";

export class CacheOperation   {
	app:App;
    settings:MyPluginSettings;
    todoistRestAPI:TodoistRestAPI;

	constructor(app:App, settings:MyPluginSettings,todoistRestAPI:TodoistRestAPI) {
		//super(app,settings);
		this.app = app;
        this.settings = settings;
        this.todoistRestAPI = todoistRestAPI;
	}

          
      
      
      
      
      
    // 从 Cache读取所有task
    loadTasksFromCache() {
    try {
        const savedTasks = this.settings.todoistTasksData.tasks
        return savedTasks;
    } catch (error) {
        console.error(`Error loading tasks from Cache: ${error}`);
        return [];
    }
    }
      

    // 覆盖保存所有task到cache
    saveTasksToCache(newTasks) {
        try {
            this.settings.todoistTasksData.tasks = newTasks
            
        } catch (error) {
            console.error(`Error saving tasks to Cache: ${error}`);
            return false;
        }
    }
      
      
      
      
    // append event 到 Cache
    appendEventToCache(event:Object[]) {
        try {
            this.settings.todoistTasksData.events.push(event)
        } catch (error) {
            console.error(`Error append event to Cache: ${error}`);
        }
    }

    // append events 到 Cache
    appendEventsToCache(events:Object[]) {
        try {
            this.settings.todoistTasksData.events.push(...events)
        } catch (error) {
            console.error(`Error append events to Cache: ${error}`);
        }
    }
      
      
    // 从 Cache 文件中读取所有events
    loadEventsFromCache() {
    try {

            const savedEvents = this.settings.todoistTasksData.events
            return savedEvents;
        } catch (error) {
            console.error(`Error loading events from Cache: ${error}`);
        }
    }


      
    // 追加到 Cache 文件
    appendTaskToCache(task) {
        try {
            const savedTasks = this.settings.todoistTasksData.tasks
            const taskAlreadyExists = savedTasks.some((t) => t.id === task.id);
            if (!taskAlreadyExists) {
                this.settings.todoistTasksData.tasks.push(task);   //，使用push方法将字符串插入到Cache对象时，它将被视为一个简单的键值对，其中键是数组的数字索引，而值是该字符串本身。但如果您使用push方法将另一个Cache对象（或数组）插入到Cache对象中，则该对象将成为原始Cache对象的一个嵌套子对象。在这种情况下，键是数字索引，值是嵌套的Cache对象本身。
            }
        } catch (error) {
            console.error(`Error appending task to Cache: ${error}`);
        }
    }
      
      
      
      
    //读取指定id的任务
    loadTaskFromCacheyID(taskId) {
        try {

            const savedTasks = this.settings.todoistTasksData.tasks
            const savedTask = savedTasks.find((t) => t.id === taskId);
            //console.log(savedTask)
            return(savedTask)
        } catch (error) {
            console.error(`Error finding task from Cache: ${error}`);
            return [];
        }
    }
      
    //update指定id的task
    updateTaskToCacheByID(task) {
        try {
        
        
            //删除就的task
            this.deleteTaskFromCache(task.id)
            //添加新的task
            this.appendTaskToCache(task)
        
        } catch (error) {
            console.error(`Error updating task to Cache: ${error}`);
            return [];
        }
    }
      
      
      //open a task status
    reopenTaskToCacheByID(taskId:string) {
        try {
            const savedTasks = this.settings.todoistTasksData.tasks

        
            // 遍历数组以查找具有指定 ID 的项
            for (let i = 0; i < savedTasks.length; i++) {
            if (savedTasks[i].id === taskId) {
                // 修改对象的属性
                savedTasks[i].isCompleted = false;
                break; // 找到并修改了该项，跳出循环
            }
            }
            this.settings.todoistTasksData.tasks = savedTasks
        
        } catch (error) {
            console.error(`Error open task to Cache file: ${error}`);
            return [];
        }
    }
      
      
      
    //close a task status
    closeTaskToCacheByID(taskId:string):Promise<void> {
        try {
            const savedTasks = this.settings.todoistTasksData.tasks
        
            // 遍历数组以查找具有指定 ID 的项
            for (let i = 0; i < savedTasks.length; i++) {
            if (savedTasks[i].id === taskId) {
                // 修改对象的属性
                savedTasks[i].isCompleted = true;
                break; // 找到并修改了该项，跳出循环
            }
            }
            this.settings.todoistTasksData.tasks = savedTasks
        
        } catch (error) {
            console.error(`Error close task to Cache file: ${error}`);
            throw error; // 抛出错误使调用方能够捕获并处理它
        }
    }
      
      
    // 通过 ID 删除任务
    deleteTaskFromCache(taskId) {
        try {
        const savedTasks = this.settings.todoistTasksData.tasks
        const newSavedTasks = savedTasks.filter((t) => t.id !== taskId);
        this.settings.todoistTasksData.tasks = newSavedTasks                                         
        } catch (error) {
        console.error(`Error deleting task from Cache file: ${error}`);
        }
    }
      
      
      
      
      
    // 通过 ID 数组 删除task
    deleteTaskFromCacheByIDs(deletedTaskIds) {
        try {
            const savedTasks = this.settings.todoistTasksData.tasks
            const newSavedTasks = savedTasks.filter((t) => !deletedTaskIds.includes(t.id))
            this.settings.todoistTasksData.tasks = newSavedTasks
        } catch (error) {
            console.error(`Error deleting task from Cache : ${error}`);
        }
    }
      
      
    //通过 name 查找 project id
    getProjectIdByNameFromCache(projectName:string) {
        try {
        const savedProjects = this.settings.todoistTasksData.projects
        const targetProject = savedProjects.find(obj => obj.name === projectName);
        const projectId = targetProject ? targetProject.id : null;
        return(projectId)
        } catch (error) {
        console.error(`Error finding project from Cache file: ${error}`);
        return(false)
        }
    }
      


    //save projects data to json file
    async saveProjectsToCache() {
        try{
                //get projects
            const projects = await this.todoistRestAPI.GetAllProjects()
            if(!projects){
                return false
            }
        
            //save to json
            this.settings.todoistTasksData.projects = projects

            return true

        }catch(error){
            console.log(`error downloading projects: ${error}`)

    }
    
    }


    async updateRenamedFilePath(oldpath:string,newpath:string){
        try{
            const savedTask = await this.loadTasksFromCache()
            const newTasks = savedTask.map(obj => {
                if (obj.path === oldpath) {
                  return { ...obj, path: newpath };
                }
            })
            await this.saveTasksToCache(newTasks)

        }catch(error){
            console.log(`Error updating renamed file path to cache: ${error}`)
        }


    }



}
