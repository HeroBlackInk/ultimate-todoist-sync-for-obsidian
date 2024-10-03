import { error } from "console";
import UltimateTodoistSyncForObsidian from "../main";
import { App, Editor, MarkdownView, Notice} from 'obsidian';


type FrontMatter = {
    todoistTasks: string[];
    todoistCount: number;
  };

export class SyncFromTodoistToObsidian  {
	app:App;
    plugin: UltimateTodoistSyncForObsidian;


	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings,todoistRestAPI,todoistSyncAPI,taskParser,cacheOperation);
		this.app = app;
        this.plugin = plugin;

	}



    // 同步已完成的任务状态到 Obsidian file
    async  syncCompletedTaskStatusToObsidian(unSynchronizedEvents) {
        // 获取未同步的事件
        //console.log(unSynchronizedEvents)    
        try {
        
        // 处理未同步的事件并等待所有处理完成
        const processedEvents = []
        for (const e of unSynchronizedEvents) {   //如果要修改代码，让completeTaskInTheFile(e.object_id)按照顺序依次执行，可以将Promise.allSettled()方法改为使用for...of循环来处理未同步的事件。具体步骤如下：
            //console.log(`正在 complete ${e.object_id}`)
            await this.plugin.fileOperation.completeTaskInTheFile(e.object_id)
            await this.plugin.cacheOperation.closeTaskToCacheByID(e.object_id)
            new Notice(`Task ${e.object_id} is closed.`)
            processedEvents.push(e)
        }

        // Save events to the local database."
        //const allEvents = [...savedEvents, ...unSynchronizedEvents]
        await this.plugin.cacheOperation.appendEventsToCache(processedEvents)
        this.plugin.saveSettings()





        } catch (error) {
        console.error('同步任务状态时出错：', error)
        }
    }


    // 同步uncheck的任务状态到 Obsidian file
    async  syncUncompletedTaskStatusToObsidian(unSynchronizedEvents) {

        //console.log(unSynchronizedEvents)
    
        try {
        
        // 处理未同步的事件并等待所有处理完成
        const processedEvents = []
        for (const e of unSynchronizedEvents) {   //如果要修改代码，让uncompleteTaskInTheFile(e.object_id)按照顺序依次执行，可以将Promise.allSettled()方法改为使用for...of循环来处理未同步的事件。具体步骤如下：
            //console.log(`正在 uncheck task: ${e.object_id}`)
            await this.plugin.fileOperation.uncompleteTaskInTheFile(e.object_id)
            await this.plugin.cacheOperation.reopenTaskToCacheByID(e.object_id)
            new Notice(`Task ${e.object_id} is reopend.`)
            processedEvents.push(e)
        }
    
    
    
        // 将新事件合并到现有事件中并保存到 JSON
        //const allEvents = [...savedEvents, ...unSynchronizedEvents]
        await this.plugin.cacheOperation.appendEventsToCache(processedEvents)
        this.plugin.saveSettings()
        } catch (error) {
        console.error('同步任务状态时出错：', error)
        }
    }



    // 同步updated item状态到 Obsidian 中
    async  syncUpdatedTaskToObsidian(unSynchronizedEvents) {
        //console.log(unSynchronizedEvents)
        try {

        // 处理未同步的事件并等待所有处理完成
        const processedEvents = []
        for (const e of unSynchronizedEvents) {   //如果要修改代码，让completeTaskInTheFile(e.object_id)按照顺序依次执行，可以将Promise.allSettled()方法改为使用for...of循环来处理未同步的事件。具体步骤如下：
            //console.log(`正在 sync ${e.object_id} 的变化到本地`)
            console.log(e)
            if(!(typeof e.extra_data.last_due_date === 'undefined')){
                //console.log(`prepare update dueDate`)
                
                try{
                    await this.syncUpdatedTaskDueDateToObsidian(e)
                }catch(error){
                    console.error(error)
                    continue
                }

            }

            if(!(e.extra_data.last_content === undefined)){
                //console.log(`prepare update content`)
                try{
                    await this.syncUpdatedTaskContentToObsidian(e)
                }catch(error){
                    console.error(error)
                    continue
                }
                
            }

            //await this.plugin.fileOperation.syncUpdatedTaskToTheFile(e)
            //还要修改cache中的数据
            //new Notice(`Task ${e.object_id} is updated.`)
            processedEvents.push(e)
        }
    
    
    
        // 将新事件合并到现有事件中并保存到 JSON
        //const allEvents = [...savedEvents, ...unSynchronizedEvents]
        await this.plugin.cacheOperation.appendEventsToCache(processedEvents)
        this.plugin.saveSettings()
        } catch (error) {
        console.error('Error syncing updated item', error)
        }

    }



    async isTaskPresentInCacheAndFile(taskId) {
        try {
            const taskInCache = this.plugin.cacheOperation?.loadTaskFromCacheByID(taskId);
            if (taskInCache) {
                const filepath = taskInCache.path;
    
                if (!filepath) {
                    const errorMsg = `Database error: Task ${taskId} in cache doesn't have a valid filepath.`;
                    console.error(errorMsg);
                    //throw new Error(errorMsg);
                    return null
                }
    
                const taskInfile = this.plugin.fileOperation?.searchTaskFromFilePath(filepath, taskId);
                if (!taskInfile) {
                    const errorMsg = `Database error: Task ${taskId} in cache doesn't match content in file: ${filepath}.`;
                    console.error(errorMsg);
                    //throw new Error(errorMsg);
                    return null
                }
    
                return taskInfile;
            } else {
                console.warn(`Task not found: ${taskId} in cache and vault.`);
                return null;
            }
        } catch (error) {
            console.error(`Error in isTaskPresentInCacheAndFile for Task ID ${taskId}: ${error.message}`);
            throw error;  // Re-throw the error after logging it for further handling
        }
    }


    async syncUpdatedTaskContentToObsidian(e){
        console.log(e)
        const taskId =  e.object_id

        try{
            const taskPresent = await this.isTaskPresentInCacheAndFile(taskId) 
            if(!taskPresent){
                throw new Error(`Task not found in cache and vault while sync task content from todoist to obsidian`)
            }
        }catch(error){
            throw error
        }



        const filepath = this.plugin.cacheOperation?.getTaskFilepathFromCache(taskId) || this.plugin.fileOperation.searchFilepathsByTaskidInVault(taskId) || null

        const content = e.extra_data.content
        await this.plugin.fileOperation.updateTaskContentInFile(taskId,filepath,content)
        
        this.plugin.cacheOperation.modifyTaskToCacheByID(taskId,{content})



        console.log(`The content of Task ${e.parent_item_id} has been modified.`)
        new Notice(`The content of Task ${e.parent_item_id} has been modified.`)

    }

    async syncUpdatedTaskDueDateToObsidian(e){
        const taskId = e.object_id
        try{
            const taskPresent = await this.isTaskPresentInCacheAndFile(taskId) 
            if(!taskPresent){
                throw new Error(`Task  ${taskId}not found in cache and vault while sync task content from todoist to obsidian`)
            }
        }catch(error){
            throw error
        }

        const dueDate = e.extra_data.due_date
        const filepath = this.plugin.cacheOperation?.getTaskFilepathFromCache(taskId) || this.plugin.fileOperation.searchFilepathsByTaskidInVault(taskId) || null

        
        try{
            this.plugin.fileOperation.updateTaskDueDateInFile(taskId,filepath,dueDate)
        }catch(error){
            console.error(error)
        }
        
        //修改cache的日期，要使用todoist的格式
        const due = await this.plugin.todoistRestAPI.getTaskDueById(e.object_id)
        this.plugin.cacheOperation.modifyTaskToCacheByID(e.object_id,{due})
        
        new Notice(`The due date of Task ${e.parent_item_id} has been modified.`)

    }


    // sync added task note to obsidian
    async  syncTaskNoteToObsidian(unSynchronizedEvents) {
        // 获取未同步的事件
        //console.log(unSynchronizedEvents)    
        try {
        
        // 处理未同步的事件并等待所有处理完成
        const processedEvents = []
        for (const e of unSynchronizedEvents) {   //如果要修改代码，让completeTaskInTheFile(e.object_id)按照顺序依次执行，可以将Promise.allSettled()方法改为使用for...of循环来处理未同步的事件。具体步骤如下：
            console.log(e)



            //const taskid = e.parent_item_id
            //const note = e.extra_data.content
            const taskId = evt.parent_item_id
            const note = evt.extra_data.content
            const eventDate = this.plugin.taskParser.ISOStringToLocalDatetimeString(evt.event_date)
            await this.plugin.fileOperation.syncTaskNoteToFile(taskId,filepath,note,eventDate)
            //await this.plugin.cacheOperation.closeTaskToCacheByID(e.object_id)
            new Notice(`Task ${e.parent_item_id} note is added.`)
            processedEvents.push(e)
        }

        // 将新事件合并到现有事件中并保存到 JSON

        await this.plugin.cacheOperation.appendEventsToCache(processedEvents)
        this.plugin.saveSettings()
        } catch (error) {
        console.error('同步任务状态时出错：', error)
        }
    }






    async syncTodoistToObsidian(){
        try{
            const all_activity_events = await this.plugin.todoistSyncAPI.getNonObsidianAllActivityEvents()
            
            console.log(all_activity_events)
            // remove synchonized events
            const savedEvents = await this.plugin.cacheOperation.loadEventsFromCache()
            console.log(savedEvents)
            const result1 = all_activity_events.filter(
            (objA) => !savedEvents.some((objB) => objB.id === objA.id)
            )
    
           
            const savedTasks = await this.plugin.cacheOperation.loadTasksFromCache()
            // 找出 task id 存在于 Obsidian 中的 task activity
            const result2 = result1.filter(
            (objA) => savedTasks.some((objB) => objB.id === objA.object_id)
            )
            // 找出 task id 存在于 Obsidian 中的 note activity
            const result3 = result1.filter(
                (objA) => savedTasks.some((objB) => objB.id === objA.parent_item_id)
                )
        
    
    
    
            const unsynchronized_item_completed_events = this.plugin.todoistSyncAPI.filterActivityEvents(result2, { event_type: 'completed', object_type: 'item' })
            const unsynchronized_item_uncompleted_events = this.plugin.todoistSyncAPI.filterActivityEvents(result2, { event_type: 'uncompleted', object_type: 'item' })

            //Items updated (only changes to content, description, due_date and responsible_uid)
            const unsynchronized_item_updated_events = this.plugin.todoistSyncAPI.filterActivityEvents(result2, { event_type: 'updated', object_type: 'item' })

            const unsynchronized_notes_added_events = this.plugin.todoistSyncAPI.filterActivityEvents(result3, { event_type: 'added', object_type: 'note' })
            const unsynchronized_project_events = this.plugin.todoistSyncAPI.filterActivityEvents(result1, { object_type: 'project' })
            console.log(unsynchronized_item_completed_events)
            console.log(unsynchronized_item_uncompleted_events)
            console.log(unsynchronized_item_updated_events)
            console.log(unsynchronized_project_events) 
            console.log(unsynchronized_notes_added_events)
    
            await this.syncCompletedTaskStatusToObsidian(unsynchronized_item_completed_events)
            await this.syncUncompletedTaskStatusToObsidian(unsynchronized_item_uncompleted_events)
            await this.syncUpdatedTaskToObsidian(unsynchronized_item_updated_events)
            await this.syncTaskNoteToObsidian(unsynchronized_notes_added_events)
            if(unsynchronized_project_events.length){
                console.log('New project event')
                await this.plugin.cacheOperation.saveProjectsToCache()
                await this.plugin.cacheOperation.appendEventsToCache(unsynchronized_project_events)
            }
    

        }catch (err){
            console.error('An error occurred while synchronizing:', err);
        }

    }




}
