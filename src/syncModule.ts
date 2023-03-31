import UltimateTodoistSyncForObsidian from "main";
import { App, Editor, MarkdownView, Notice} from 'obsidian';
import { UltimateTodoistSyncSettings } from 'src/settings';
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
    plugin: UltimateTodoistSyncForObsidian;
    settings:UltimateTodoistSyncSettings;
    todoistRestAPI:TodoistRestAPI;
    todoistSyncAPI:TodoistSyncAPI;
    taskParser:TaskParser;
    cacheOperation:CacheOperation;
    fileOperation:FileOperation;

	constructor(app:App, plugin:MyPlugin,settings:UltimateTodoistSyncSettings,todoistRestAPI:TodoistRestAPI,todoistSyncAPI:TodoistSyncAPI,taskParser:TaskParser,cacheOperation:CacheOperation,fileOperation:FileOperation) {
		//super(app,settings,todoistRestAPI,todoistSyncAPI,taskParser,cacheOperation);
		this.app = app;
        this.plugin = plugin;
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
      
        //const frontMatter = await this.fileOperation.getFrontMatter(file);
        const frontMatter = await this.cacheOperation.getFileMetadata(filepath)
        if (!frontMatter || !frontMatter.todoistTasks) {
          console.log('frontmatter没有task')
          return;
        }
      
        const currentFileValueReadFromFile = await this.app.vault.cachedRead(file)
        //使用view.data 代替 valut.read。vault.read有延迟
        const currentFileValue = view?.data ?? currentFileValueReadFromFile
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
              //console.log(`response is ${response}`);
      
              if (response) {
                //console.log(`task ${taskId} 删除成功`);
                new Notice(`task ${taskId} was deleted`)
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
        //console.log(`删除了${deletedTaskAmount} 条 task`)
        this.plugin.saveSettings()
        // 更新 newFrontMatter_todoistTasks 数组
        
        // Disable automatic merging
       
        const newFrontMatter_todoistTasks = frontMatter_todoistTasks.filter(
          (taskId) => !deletedTaskIds.includes(taskId)
        );
      
      
        /*
        await this.fileOperation.updateFrontMatter(file, (frontMatter) => {
          frontMatter.todoistTasks = newFrontMatter_todoistTasks;
          frontMatter.todoistCount = frontMatter_todoistCount - deletedTaskAmount;
        });
        */
        const newFileMetadata = {todoistTasks:newFrontMatter_todoistTasks,todoistCount:(frontMatter_todoistCount - deletedTaskAmount)}
        await this.cacheOperation.updateFileMetadata(filepath,newFileMetadata)
    }

    async lineContentNewTaskCheck(editor:Editor,view:MarkdownView): Promise<void>{
        //const editor = this.app.workspace.activeEditor?.editor
        //const view =this.app.workspace.getActiveViewOfType(MarkdownView)

        const filepath = view.file?.path
        const fileContent = view?.data
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
            //console.log('this is a new task')
            console.log(linetxt)
            const currentTask =await this.taskParser.convertTextToTodoistTaskObject(linetxt,filepath,line,fileContent)
            console.log(currentTask)
    
          
    
    
    
            try {
                const newTask = await this.todoistRestAPI.AddTask(currentTask)
                const { id: todoist_id, projectId: todoist_projectId, url: todoist_url } = newTask;
                newTask.path = filepath;
                console.log(newTask);
                new Notice(`new task ${newTask.content} id is ${newTask.id}`)
                //newTask写入缓存
                this.cacheOperation.appendTaskToCache(newTask)
                
                //如果任务已完成
                if(currentTask.isCompleted === true){
                  await this.todoistRestAPI.CloseTask(newTask.id)
                  this.cacheOperation.closeTaskToCacheByID(todoist_id)
                
                }
                this.plugin.saveSettings()

                //todoist id 保存到 任务后面
                const text = `${linetxt} %%[todoist_id:: ${todoist_id}]%%`;
                const from = { line: cursor.line, ch: 0 };
                const to = { line: cursor.line, ch: linetxt.length };
                view.app.workspace.activeEditor?.editor?.replaceRange(text, from, to)
    
                //处理frontMatter
                try {
                    // 处理 front matter
                    const frontMatter = await this.cacheOperation.getFileMetadata(filepath)
                      //console.log(frontMatter);
                  
                      if (!frontMatter) {
                        console.log('frontmatter is empty');
                        //return;
                      }
                  
                      // 将 todoistCount 加 1
                      const newFrontMatter = { ...frontMatter };
                      newFrontMatter.todoistCount = (newFrontMatter.todoistCount ?? 0) + 1;
                  
                      // 记录 taskID
                      newFrontMatter.todoistTasks = [...(newFrontMatter.todoistTasks || []), todoist_id];
                  
                      // 更新 front matter
                      /*
                     this.fileOperation.updateFrontMatter(view.file, (frontMatter) => {
                        frontMatter.todoistTasks = newFrontMatter.todoistTasks;
                        frontMatter.todoistCount = newFrontMatter.todoistCount;
                      });
                      */
                      console.log(newFrontMatter)
                      await this.cacheOperation.updateFileMetadata(filepath,newFrontMatter)

                    

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
        const contentFromFile = await	this.app.vault.cachedRead(file)
        const content = view?.data ?? contentFromFile
    
        let newFrontMatter
        //frontMatteer
        const frontMatter = await this.cacheOperation.getFileMetadata(filepath)
        //console.log(frontMatter);
    
        if (!frontMatter) {
            console.log('frontmatter is empty');
            return;
        }
    
        newFrontMatter = { ...frontMatter };
        
    
        let hasNewTask = false;
        const lines = content.split('\n')
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.includes("todoist_id") && line.includes('#todoist')) {
            //console.log('this is a new task')
            //console.log(`current line is ${i}`)
            //console.log(`line text: ${line}`)
            console.log(filepath)
            const currentTask =await this.taskParser.convertTextToTodoistTaskObject(line,filepath,i,content)
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
                this.plugin.saveSettings()
    
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
                /*
                this.fileOperation.updateFrontMatter(file, (frontMatter) => {
                frontMatter.todoistTasks = newFrontMatter.todoistTasks;
                frontMatter.todoistCount = newFrontMatter.todoistCount;
                });
                */

                await this.cacheOperation.updateFileMetadata(filepath,newFrontMatter)
            
            } catch (error) {
            console.error(error);
            }
    
        }
    
    
    }


    async lineModifiedTaskCheck(filepath:string,lineText:string,lineNumber:number,fileContent:string): Promise<void>{
        //const lineText = await this.fileOperation.getLineTextFromFilePath(filepath,lineNumber)

        //检查task

        if (this.taskParser.hasTodoistId(lineText) && this.taskParser.hasTodoistTag(lineText)) {

            const lineTask = await this.taskParser.convertTextToTodoistTaskObject(lineText,filepath,lineNumber,fileContent)
            //console.log(lastLineTask)
            const lineTask_todoist_id = (lineTask.todoist_id).toString()
            console.log(lineTask_todoist_id )
            //console.log(`lastline task id is ${lastLineTask_todoist_id}`)
            const savedTask = await this.cacheOperation.loadTaskFromCacheyID(lineTask_todoist_id)  //dataview中 id为数字，todoist中id为字符串，需要转换
            if(!savedTask){
                console.log(`本地缓存中没有task ${lineTask.todoist_id}`)
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
                console.log(lineTask.dueDate)
                //console.log(savedTask.due.date)
                if(lineTask.dueDate === ""){
                    updatedContent.dueString = "no date"
                }else{
                    updatedContent.dueDate = lineTask.dueDate
                }

                dueDateChanged = true;
            }

            //todoist Rest api 没有 move task to new project的功能
            if (projectModified) {
                //console.log(`Project id modified for task ${lineTask_todoist_id}`)
                //updatedContent.projectId = lineTask.projectId
                //projectChanged = false;
            }

            //todoist Rest api 没有修改 parent id 的借口
            if (parentIdModified) {
                //console.log(`Parnet id modified for task ${lineTask_todoist_id}`)
                //updatedContent.parentId = lineTask.parentId
                //parentIdChanged = false;
            }


            if (contentChanged || tagsChanged ||dueDateChanged ||projectChanged || parentIdChanged) {
                //console.log("task content was modified");
                //console.log(updatedContent)
                const updatedTask = await this.todoistRestAPI.UpdateTask(lineTask.todoist_id.toString(),updatedContent)
                updatedTask.path = filepath
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
                this.plugin.saveSettings()
                new Notice(`Task ${lineTask_todoist_id} was modified`)

            } else {
                //console.log(`Task ${lineTask_todoist_id} did not change`);
            }
            
            } catch (error) {
            console.error('Error updating task:', error);
            }


        }
    }


    async fullTextModifiedTaskCheck(): Promise<void>{

        //console.log(`检查file修改的任务`)

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = this.app.workspace.getActiveFile()
        const filepath = this.app.workspace.getActiveFile()?.path
        //console.log(filepath)
        //const editor = this.app.workspace.activeEditor?.editor
        //const filepath = this.app.workspace.activeEditor?.file?.path
        //console.log(filepath)
        //const file = this.app.vault.getAbstractFileByPath(filepath);
        const content1 = await this.app.vault.read(file)
        const content = view?.data ?? content1
        //console.log(content)


        let hasModifiedTask = false;
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (line.includes("todoist_id") && line.includes('#todoist')) {
                //console.log(`current line is ${i}`)
                //console.log(`line text: ${line}`)
                try {
                await this.lineModifiedTaskCheck(filepath,line,i,content)
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
    async closeTask(taskId: string): Promise<void> {
    try {
        await this.todoistRestAPI.CloseTask(taskId);
        await this.cacheOperation.closeTaskToCacheByID(taskId);
        this.plugin.saveSettings()
        new Notice(`Task ${taskId} id closed.`)
    } catch (error) {
        console.error('Error closing task:', error);
        throw error; // 抛出错误使调用方能够捕获并处理它
    }
    }

    //open task
    async repoenTask(taskId:string) : Promise<void>{
        try {
            await this.todoistRestAPI.OpenTask(taskId)
            await this.cacheOperation.reopenTaskToCacheByID(taskId)
            this.plugin.saveSettings()
            new Notice(`Task ${taskId} id reopend.`)
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
    async deleteTasksByIds(taskIds: string[]): Promise<string[]> {
    const deletedTaskIds = [];

    for (const taskId of taskIds) {
        const api = await this.todoistRestAPI.initializeAPI()
        try {
        const response = await api.deleteTask(taskId);
        console.log(`response is ${response}`);

        if (response) {
            //console.log(`Task ${taskId} 删除成功`);
            new Notice(`Task ${taskId} was deleted.`)
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
    this.plugin.saveSettings()
    //console.log(`共删除了 ${deletedTaskIds.length} 条 task`);
    

    return deletedTaskIds;
    }

    // 获取未同步的item completed事件
    async  getObdisianUnsynchronizedCompletedEvents() {
        const completedItemsActivityEvents = await this.todoistSyncAPI.getNonObsidianCompletedItemsActivity()
    
        // 找出 task id 存在于 Obsidian 中的 activity
        const savedTasks = await this.cacheOperation.loadTasksFromCache()
        const result1 = completedItemsActivityEvents.filter(
        (objA) => savedTasks.some((objB) => objB.id === objA.object_id)
        )
    
        // 删除已经保存的 events
        const savesEvents = this.settings.todoistTasksData.events
        const result2 = result1.filter(
        (objA) => !savesEvents.some((objB) => objB.id === objA.id)
        )
        return result2
    }
  
    // 获取未同步的item uncompleted事件
    async  getObdisianUnsynchronizedUncompletedEvents() {
        const uncompletedItemsActivityEvents = await this.todoistSyncAPI.getNonObsidianUncompletedItemsActivity()
    
        // 找出 task id 存在于 Obsidian 中的 activity
        const savedTasks = await this.cacheOperation.loadTasksFromCache()
        const result1 = uncompletedItemsActivityEvents.filter(
        (objA) => savedTasks.some((objB) => objB.id === objA.object_id)
        )
    
        // 删除已经保存的 events
        const savesEvents = await this.cacheOperation.loadEventsFromCache()
        const result2 = result1.filter(
        (objA) => !savesEvents.some((objB) => objB.id === objA.id)
        )
        return result2
    }
  
  
    // 获取未同步的item updated事件
    async  getObdisianUnsynchronizedUpdatedEvents() {
        const updatedItemsActivityEvents = await this.todoistSyncAPI.getNonObsidianUpdatedItemsActivity()
    
        // 找出 task id 存在于 Obsidian 中的 activity
        const savedTasks = this.cacheOperation.loadTasksFromCache()
        const result1 = updatedItemsActivityEvents.filter(
        (objA) => savedTasks.some((objB) => objB.id === objA.object_id)
        )
    
        // 删除已经保存的 events
        const savedEvents = await this.cacheOperation.loadEventsFromCache()
        const result2 = result1.filter(
        (objA) => !savedEvents.some((objB) => objB.id === objA.id)
        )
        return result2
    }


    // 同步已完成的任务状态到 Obsidian file
    async  syncCompletedTaskStatusToObsidian() {
        // 获取未同步的事件
        const unSynchronizedEvents = await this.getObdisianUnsynchronizedCompletedEvents()
        //console.log(unSynchronizedEvents)    
        try {
        
        // 处理未同步的事件并等待所有处理完成
        const processedEvents = []
        for (const e of unSynchronizedEvents) {   //如果要修改代码，让completeTaskInTheFile(e.object_id)按照顺序依次执行，可以将Promise.allSettled()方法改为使用for...of循环来处理未同步的事件。具体步骤如下：
            //console.log(`正在 complete ${e.object_id}`)
            await this.fileOperation.completeTaskInTheFile(e.object_id)
            await this.cacheOperation.closeTaskToCacheByID(e.object_id)
            new Notice(`Task ${e.object_id} was closed.`)
            processedEvents.push(e)
        }

        // 将新事件合并到现有事件中并保存到 JSON
        //const allEvents = [...savedEvents, ...unSynchronizedEvents]
        await this.cacheOperation.appendEventsToCache(processedEvents)
        this.plugin.saveSettings()
        } catch (error) {
        console.error('同步任务状态时出错：', error)
        }
    }
  
  
    // 同步已完成的任务状态到 Obsidian file
    async  syncUncompletedTaskStatusToObsidian() {
        // 获取未同步的事件
        const unSynchronizedEvents = await this.getObdisianUnsynchronizedUncompletedEvents()
        //console.log(unSynchronizedEvents)
    
        try {
        
        // 处理未同步的事件并等待所有处理完成
        const processedEvents = []
        for (const e of unSynchronizedEvents) {   //如果要修改代码，让uncompleteTaskInTheFile(e.object_id)按照顺序依次执行，可以将Promise.allSettled()方法改为使用for...of循环来处理未同步的事件。具体步骤如下：
            //console.log(`正在 uncheck task: ${e.object_id}`)
            await this.fileOperation.uncompleteTaskInTheFile(e.object_id)
            await this.cacheOperation.reopenTaskToCacheByID(e.object_id)
            new Notice(`Task ${e.object_id} was reopend.`)
            processedEvents.push(e)
        }
    
    
    
        // 将新事件合并到现有事件中并保存到 JSON
        //const allEvents = [...savedEvents, ...unSynchronizedEvents]
        await this.cacheOperation.appendEventsToCache(processedEvents)
        this.plugin.saveSettings()
        } catch (error) {
        console.error('同步任务状态时出错：', error)
        }
    }
  
    // 同步updated item状态到 Obsidian 中
    async  syncUpdatedTaskToObsidian() {
        // 获取未同步的事件
        const unSynchronizedEvents = await this.getObdisianUnsynchronizedUpdatedEvents()
        //console.log(unSynchronizedEvents) 
        try {
        
        // 处理未同步的事件并等待所有处理完成
        const processedEvents = []
        for (const e of unSynchronizedEvents) {   //如果要修改代码，让completeTaskInTheFile(e.object_id)按照顺序依次执行，可以将Promise.allSettled()方法改为使用for...of循环来处理未同步的事件。具体步骤如下：
            //console.log(`正在 sync ${e.object_id} 的变化到本地`)
            console.log(e)
            console.log(typeof e.extra_data.last_due_date === 'undefined')
            if(!(typeof e.extra_data.last_due_date === 'undefined')){
                console.log(`prepare update dueDate`)
                await this.syncUpdatedTaskDueDateToObsidian(e)

            }

            if(!(typeof e.extra_data.last_content === 'undefined')){
                console.log(`prepare update content`)
                await this.syncUpdatedTaskContentToObsidian(e)
            }

            //await this.fileOperation.syncUpdatedTaskToTheFile(e)
            //还要修改cache中的数据
            new Notice(`Task ${e.object_id} was updated.`)
            processedEvents.push(e)
        }
    
    
    
        // 将新事件合并到现有事件中并保存到 JSON
        //const allEvents = [...savedEvents, ...unSynchronizedEvents]
        await this.cacheOperation.appendEventsToCache(processedEvents)
        this.plugin.saveSettings()
        } catch (error) {
        console.error('Error syncing updated item', error)
        }
        
    }

    async syncUpdatedTaskContentToObsidian(e){
        this.fileOperation.syncUpdatedTaskContentToTheFile(e)
        const content = e.extra_data.content
        this.cacheOperation.modifyTaskToCacheByID(e.object_id,{content})

    }

    async syncUpdatedTaskDueDateToObsidian(e){
        this.fileOperation.syncUpdatedTaskDueDateToTheFile(e)
        //修改cache的日期，要使用todoist的格式
        const due = await this.todoistRestAPI.getTaskDueById(e.object_id)
        this.cacheOperation.modifyTaskToCacheByID(e.object_id,{due})

    }

    async  backupTodoistAllResources() {
        try {
        const resources = await this.todoistSyncAPI.getAllResources()
    
        const now: Date = new Date();
        const timeString: string = `${now.getFullYear()}${now.getMonth()+1}${now.getDate()}${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
    
        const name = "todoist-backup-"+timeString+".json"

        this.app.vault.create(name,JSON.stringify(resources))
        //console.log(`todoist 备份成功`)
        new Notice(`Todoist backup data is saved in the path ${name}`)
        } catch (error) {
        console.error("An error occurred while creating Todoist backup:", error);
        }

    }
    

}