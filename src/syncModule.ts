import MyPlugin from "main";
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting ,TFile} from 'obsidian';
import { MyPluginSettings } from 'src/settings';
import { TodoistRestAPI } from "./todoistRestAPI";
import { TodoistSyncAPI } from "./todoistSyncAPI";
import { TaskParser } from "./taskParser";
import { CacheOperation } from "./cacheOperation";
import { FileOperation } from "./fileOperation";

type FrontMatter = {
    todoistTasks: string[];
    todoistCount: number;
  };

export class TodoistSync  {
	app:App;
    settings:MyPluginSettings;
    todoistRestAPI:TodoistRestAPI;
    todoistSyncAPI:TodoistSyncAPI;
    taskParser:TaskParser;
    cacheOperation:CacheOperation;
    fileOperation:FileOperation;

	constructor(app:App, settings:MyPluginSettings,todoistRestAPI:TodoistRestAPI,todoistSyncAPI:TodoistSyncAPI,taskParser:TaskParser,cacheOperation:CacheOperation,fileOperation:FileOperation) {
		//super(app,settings,todoistRestAPI,todoistSyncAPI,taskParser,cacheOperation);
		this.app = app;
        this.settings = settings;
        this.todoistRestAPI = todoistRestAPI;
        this.todoistSyncAPI = todoistSyncAPI;
        this.taskParser = taskParser;
        this.cacheOperation = cacheOperation;
        this.fileOperation = fileOperation;

	}




      
    async deletedTaskCheck(): Promise<void> {


        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        //const editor = this.app.workspace.activeEditor?.editor
        const file = this.app.workspace.getActiveFile()
        const filepath = file.path
        //console.log(filepath)
      
      
        const frontMatter = await this.fileOperation.getFrontMatter(file);
        if (!frontMatter || !frontMatter.todoistTasks) {
          console.log('frontmatter没有task')
          return;
        }
      
        //const currentFileValue  = await this.app.vault.read(file)
        const currentFileValue = await	this.app.vault.cachedRead(file)
        //console.log(currentFileValue)
        const currentFileValueWithOutFrontMatter = currentFileValue.replace(/^---[\s\S]*?---\n/, '');
        const frontMatter_todoistTasks = frontMatter.todoistTasks;
        const frontMatter_todoistCount = frontMatter.todoistCount;
      
        const deleteTasksPromises = frontMatter_todoistTasks
          .filter((taskId) => !currentFileValueWithOutFrontMatter.includes(taskId))
          .map(async (taskId) => {
            try {
              //console.log(`initialize todoist api`)
              const api = this.todoistRestAPI.initializeAPI()
              const response = await api.deleteTask(taskId);
              console.log(`response is ${response}`);
      
              if (response) {
                //console.log(`task ${taskId} 删除成功`);
                new Notice(`task ${taskId} 删除成功`)
                return taskId; // 返回被删除的任务 ID
              }
            } catch (error) {
              console.error(`Failed to delete task ${taskId}: ${error}`);
            }
          });
      
        const deletedTaskIds = await Promise.all(deleteTasksPromises);
        const deletedTaskAmount = deletedTaskIds.length
        if (!deletedTaskIds.length) {
          //console.log("没有删除任务");
          return;
        }
        this.cacheOperation.deleteTaskFromCacheByIDs(deletedTaskIds)
        console.log(`删除了${deletedTaskAmount} 条 task`)
        // 更新 newFrontMatter_todoistTasks 数组
        
        // Disable automatic merging
       
        const newFrontMatter_todoistTasks = frontMatter_todoistTasks.filter(
          (taskId) => !deletedTaskIds.includes(taskId)
        );
      
      
      
        await this.fileOperation.updateFrontMatter(file, (frontMatter) => {
          frontMatter.todoistTasks = newFrontMatter_todoistTasks;
          frontMatter.todoistCount = frontMatter_todoistCount - deletedTaskAmount;
        });
    }

    async lineContentNewTaskCheck(editor:Editor,view:MarkdownView): Promise<void>{
        //const editor = this.app.workspace.activeEditor?.editor
        //const view =this.app.workspace.getActiveViewOfType(MarkdownView)

        const filePath = view.file?.path
        const cursor = editor.getCursor()
        const line = cursor.line
        const linetxt = editor.getLine(line)
    
    
    
        //添加task
        if (this.taskParser.hasTodoistTag(linetxt)) {   //是否包含#todoist
            if(this.taskParser.hasTodoistId(linetxt))   //是否包含todoist id
            {
                //console.log('task is esixted')
                return
            }
            console.log('this is a new task')
    
            const currentTask =await this.taskParser.convertTextToTodoistTaskObject(linetxt,filePath,line)
            console.log(currentTask)
    
          
    
    
    
            try {
                const newTask = await this.todoistRestAPI.AddTask(currentTask)
                const { id: todoist_id, projectId: todoist_projectId, url: todoist_url } = newTask;
                newTask.path = filePath;
                //console.log(newTask);
                new Notice(`new task ${newTask.content} id is ${newTask.id}`)
                //newTask写入缓存
                this.cacheOperation.appendTaskToCache(newTask)
                //如果任务已完成
                if(currentTask.isCompleted === true){
                  await this.todoistRestAPI.CloseTask(newTask.id)
                  this.cacheOperation.closeTaskToCacheByID(todoist_id)
                }

                //todoist id 保存到 任务后面
                const text = `${linetxt} %%[todoist_id:: ${todoist_id}]%%`;
                const from = { line: cursor.line, ch: 0 };
                const to = { line: cursor.line, ch: linetxt.length };
                view.app.workspace.activeEditor?.editor?.replaceRange(text, from, to)
    
                //处理frontMatter
                try {
                    // 处理 front matter
                    view.app.fileManager.processFrontMatter(view.file, (frontMatter) => {
                      console.log(frontMatter);
                  
                      if (!frontMatter) {
                        console.log('frontmatter is empty');
                        return;
                      }
                  
                      // 将 todoistCount 加 1
                      const newFrontMatter = { ...frontMatter };
                      newFrontMatter.todoistCount = (newFrontMatter.todoistCount ?? 0) + 1;
                  
                      // 记录 taskID
                      newFrontMatter.todoistTasks = [...(newFrontMatter.todoistTasks || []), todoist_id];
                  
                      // 更新 front matter
        
                     this.fileOperation.updateFrontMatter(view.file, (frontMatter) => {
                        frontMatter.todoistTasks = newFrontMatter.todoistTasks;
                        frontMatter.todoistCount = newFrontMatter.todoistCount;
                      });
                    });

                  } catch (error) {
                    console.error(error);
                  }
    
              } catch (error) {
                    console.error('Error adding task:', error);
                    return
              }
    
        }
    }
    
    
    async fullTextNewTaskCheck(): Promise<void>{
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = this.app.workspace.getActiveFile()
        const filepath = file.path
        //const content = await this.app.vault.read(file)
        const content = await	this.app.vault.cachedRead(file)
    
        let newFrontMatter
        //frontMatteer
        this.app.fileManager.processFrontMatter(file, (frontMatter) => {
        console.log(frontMatter);
    
        if (!frontMatter) {
            console.log('frontmatter is empty');
            return;
        }
    
        newFrontMatter = { ...frontMatter };
        })
    
        let hasNewTask = false;
        const lines = content.split('\n')
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.includes("todoist_id") && line.includes('#todoist')) {
            console.log('this is a new task')
            console.log(`current line is ${i}`)
            console.log(`line text: ${line}`)
            console.log(filepath)
            const currentTask =await this.taskParser.convertTextToTodoistTaskObject(line,filepath,i)
            if(typeof currentTask === "undefined"){
                continue
            }
            console.log(currentTask)
            try {
                const newTask = await this.todoistRestAPI.AddTask(currentTask)
                const { id: todoist_id, projectId: todoist_projectId, url: todoist_url } = newTask;
                newTask.path = filepath;
                console.log(newTask);
                new Notice(`new task ${newTask.content} id is ${newTask.id}`)
                //newTask写入json文件
                this.cacheOperation.appendTaskToCache(newTask)
                //如果任务已完成
                if(currentTask.isCompleted === true){
                await this.todoistRestAPI.CloseTask(newTask.id)
                this.cacheOperation.closeTaskToCacheByID(todoist_id)
                }
    
                //todoist id 保存到 任务后面
                const text = `${line} %%[todoist_id:: ${todoist_id}]%%`;
                lines[i] = text;
    
                newFrontMatter.todoistCount = (newFrontMatter.todoistCount ?? 0) + 1;
                
                // 记录 taskID
                newFrontMatter.todoistTasks = [...(newFrontMatter.todoistTasks || []), todoist_id];
    
                hasNewTask = true
    
            } catch (error) {
                console.error('Error adding task:', error);
                continue
            }
            
        }
        }
        if(hasNewTask){
            //文本和 frontMatter
            try {
            // 保存file
            const newContent = lines.join('\n')
            await this.app.vault.modify(file, newContent)
    
            
                // 更新 front matter
    
                this.fileOperation.updateFrontMatter(file, (frontMatter) => {
                frontMatter.todoistTasks = newFrontMatter.todoistTasks;
                frontMatter.todoistCount = newFrontMatter.todoistCount;
                });
            
            } catch (error) {
            console.error(error);
            }
    
        }
    
    
    }


    

}