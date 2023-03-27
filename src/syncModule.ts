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


    async  lineModifiedTaskCheck(filePath:string,lineNumber:string): Promise<void>{
        const lineText = await this.fileOperation.getLineTextFromFilePath(filePath,lineNumber)

        //检查task

        if (this.taskParser.hasTodoistId(lineText) && this.taskParser.hasTodoistTag(lineText)) {

            const lineTask = await this.taskParser.convertTextToTodoistTaskObject(lineText,filePath,lineNumber)
            //console.log(lastLineTask)
            const lineTask_todoist_id = (lineTask.todoist_id).toString()
            //console.log(`lastline task id is ${lastLineTask_todoist_id}`)
            const savedTask = await this.cacheOperation.loadTaskFromCacheyID(lineTask_todoist_id)  //dataview中 id为数字，todoist中id为字符串，需要转换
            if(!savedTask){
            return
            }
        //console.log(savedTask)

            //检查内容是否修改
            const lineTaskContent = lineTask.content;


            //content 是否修改
            const contentModified = !this.taskParser.taskContentCompare(lineTask,savedTask)
            //tag or labels 是否修改
            const tagsModified = !this.taskParser.taskTagCompare(lineTask,savedTask)
            //project 是否修改
            const projectModified = !(await this.taskParser.taskProjectCompare(lineTask,savedTask))
            //status 是否修改
            const statusModified = !this.taskParser.taskStatusCompare(lineTask,savedTask)
            //due date 是否修改
            const dueDateModified = !(await this.taskParser.compareTaskDueDate(lineTask,savedTask))
            //parent id 是否修改
            const parentIdModified = !(lineTask.parentId === savedTask.parentId)

            try {
            let contentChanged= false;
            let tagsChanged = false;
            let projectChanged = false;
            let statusChanged = false;
            let dueDateChanged = false;
            let parentIdChanged = false;
            
            let updatedContent = {}
            if (contentModified) {
                console.log(`Content modified for task ${lineTask_todoist_id}`)
                updatedContent.content = lineTaskContent
                contentChanged = true;
            }

            if (tagsModified) {
                console.log(`Tags modified for task ${lineTask_todoist_id}`)
                updatedContent.labels = lineTask.labels
                tagsChanged = true;
            }
            

            if (dueDateModified) {
                console.log(`Due date modified for task ${lineTask_todoist_id}`)
                updatedContent.dueDate = lineTask.dueDate
                dueDateChanged = true;
            }

            //todoist Rest api 没有 move task to new project的功能
            if (projectModified) {
                console.log(`Project id modified for task ${lineTask_todoist_id}`)
                updatedContent.projectId = lineTask.projectId
                projectChanged = false;
            }

            //todoist Rest api 没有修改 parent id 的借口
            if (parentIdModified) {
                console.log(`Parnet id modified for task ${lineTask_todoist_id}`)
                updatedContent.parentId = lineTask.parentId
                parentIdChanged = false;
            }


            if (contentChanged || tagsChanged ||dueDateChanged ||projectChanged || parentIdChanged) {
                //console.log("task content was modified");
                console.log(updatedContent)
                const updatedTask = await this.todoistRestAPI.UpdateTask(lineTask.todoist_id.toString(),updatedContent)
                updatedTask.path = filePath
                this.cacheOperation.updateTaskToCacheByID(updatedTask);
            } 

            if (statusModified) {
                console.log(`Status modified for task ${lineTask_todoist_id}`)
                if (lineTask.isCompleted === true) {
                console.log(`task completed`)
                this.todoistRestAPI.CloseTask(lineTask.todoist_id.toString());
                this.cacheOperation.closeTaskToCacheByID( lineTask.todoist_id.toString());
                } else {
                console.log(`task umcompleted`)
                this.todoistRestAPI.OpenTask(lineTask.todoist_id.toString());
                this.cacheOperation.reopenTaskToCacheByID( lineTask.todoist_id.toString());
                }
                
                statusChanged = true;
            }


            
            if (contentChanged || statusChanged ||dueDateChanged ||tagsChanged || projectChanged) {
                console.log(lineTask)
                console.log(savedTask)
                //`Task ${lastLineTaskTodoistId} was modified`
                new Notice(`Task ${lineTask_todoist_id} was modified`)
            } else {
                console.log(`Task ${lineTask_todoist_id} did not change`);
            }
            
            } catch (error) {
            console.error('Error updating task:', error);
            }


        }
    }


    async  fullTextModifiedTaskCheck(): Promise<void>{

    console.log(`检查file修改的任务`)

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = this.app.workspace.getActiveFile()
    const filepath = this.app.workspace.getActiveFile()?.path
    //const editor = this.app.workspace.activeEditor?.editor
    //const filepath = this.app.workspace.activeEditor?.file?.path
    //console.log(filepath)
    //const file = this.app.vault.getAbstractFileByPath(filepath);
    const content = await this.app.vault.read(file)


    let hasModifiedTask = false;
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes("todoist_id") && line.includes('#todoist')) {
            //console.log(`current line is ${i}`)
            console.log(`line text: ${line}`)
            try {
            await this.lineModifiedTaskCheck(filepath,i)
            hasModifiedTask = true
            } catch (error) {
                console.error('Error modify task:', error);
                continue
            }
        
        }
    }
    if(hasModifiedTask){
        //文本和 frontMatter
        try {
            //do nothing
            
        } catch (error) {
            console.error(error);
        }

    }
    
    }


    // Close a task by calling API and updating JSON file
    async  closeTask(taskId: string): Promise<void> {
    try {
        await this.todoistRestAPI.closeTask(taskId);
        await this.cacheOperation.closeTaskToCacheByID(taskId);
    } catch (error) {
        console.error('Error closing task:', error);
        throw error; // 抛出错误使调用方能够捕获并处理它
    }
    }

    //open task
    async  repoenTask(taskId:string) : Promise<void>{
        try {
            await this.todoistRestAPI.OpenTask(taskId)
            await this.cacheOperation.reopenTaskToCacheByID(taskId)
        } catch (error) {
            console.error('Error opening task:', error);
            throw error; // 抛出错误使调用方能够捕获并处理它
        }
    } 


    /**
     * 从任务列表中删除指定 ID 的任务并更新 JSON 文件
     * @param taskIds 要删除的任务 ID 数组
     * @returns 返回被成功删除的任务 ID 数组
     */
    async  deleteTasksByIds(taskIds: string[]): Promise<string[]> {
    const deletedTaskIds = [];

    for (const taskId of taskIds) {
        const api = await this.todoistRestAPI.initializeAPI()
        try {
        const response = await api.deleteTask(taskId);
        console.log(`response is ${response}`);

        if (response) {
            console.log(`Task ${taskId} 删除成功`);
            deletedTaskIds.push(taskId); // 将被删除的任务 ID 加入数组
        }
        } catch (error) {
        console.error(`Failed to delete task ${taskId}: ${error}`);
        // 可以添加更好的错误处理方式，比如在这里抛出异常或者记录日志等
        }
    }

    if (!deletedTaskIds.length) {
        console.log("没有删除任务");
        return [];
    }

    await this.cacheOperation.deleteTaskFromCacheByIDs(deletedTaskIds); // 更新 JSON 文件

    console.log(`共删除了 ${deletedTaskIds.length} 条 task`);

    return deletedTaskIds;
    }


    

}