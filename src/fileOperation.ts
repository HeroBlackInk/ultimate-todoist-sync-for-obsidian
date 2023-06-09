import { App} from 'obsidian';
import { UltimateTodoistSyncSettings } from './settings';
import { TodoistRestAPI } from "./todoistRestAPI";
import { CacheOperation } from "./cacheOperation";
import { TaskParser } from "./taskParser";
export class FileOperation   {
	app:App;
    settings:UltimateTodoistSyncSettings;
    todoistRestAPI:TodoistRestAPI;
    taskParser:TaskParser;
    cacheOperation:CacheOperation;


	constructor(app:App, settings:UltimateTodoistSyncSettings,todoistRestAPI:TodoistRestAPI,taskParser:TaskParser,cacheOperation:CacheOperation) {
		//super(app,settings);
		this.app = app;
        this.settings = settings;
        this.todoistRestAPI = todoistRestAPI;
        this.taskParser = taskParser;
        this.cacheOperation = cacheOperation;
	}
    /*
    async getFrontMatter(file:TFile): Promise<FrontMatter | null> {
        return new Promise((resolve) => {
          this.app.fileManager.processFrontMatter(file, (frontMatter) => {
            resolve(frontMatter);
          });
        });
    }
    */
    



    /*
    async updateFrontMatter(
    file:TFile,
    updater: (frontMatter: FrontMatter) => void
    ): Promise<void> {
        //console.log(`prepare to update front matter`)
        this.app.fileManager.processFrontMatter(file, (frontMatter) => {
        if (frontMatter !== null) {
        const updatedFrontMatter = { ...frontMatter } as FrontMatter;
        updater(updatedFrontMatter);
        this.app.fileManager.processFrontMatter(file, (newFrontMatter) => {
            if (newFrontMatter !== null) {
            newFrontMatter.todoistTasks = updatedFrontMatter.todoistTasks;
            newFrontMatter.todoistCount = updatedFrontMatter.todoistCount;
            }
        });
        }
    });
    }
    */


    
          

     // 完成一个任务，将其标记为已完成
    async completeTaskInTheFile(taskId: string) {
        // 获取任务文件路径
        const currentTask = await this.cacheOperation.loadTaskFromCacheyID(taskId)
        const filepath = currentTask.path
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.taskParser.hasTodoistTag(line)) {
            lines[i] = line.replace('[ ]', '[x]')
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        await this.app.vault.modify(file, newContent)
        }
    }
  
    // uncheck 已完成的任务，
    async uncompleteTaskInTheFile(taskId: string) {
        // 获取任务文件路径
        const currentTask = await this.cacheOperation.loadTaskFromCacheyID(taskId)
        const filepath = currentTask.path
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.taskParser.hasTodoistTag(line)) {
            lines[i] = line.replace(/- \[(x|X)\]/g, '- [ ]');
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        await this.app.vault.modify(file, newContent)
        }
    }

    //add #todoist at the end of task line, if full vault sync enabled
    async addTodoistTagToFile(filepath: string) {    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if(!this.taskParser.isMarkdownTask(line)){
                //console.log(line)
                //console.log("It is not a markdown task.")
                continue;
            }
            //if content is empty
            if(this.taskParser.getTaskContentFromLineText(line) == ""){
                //console.log("Line content is empty")
                continue;
            }
            if (!this.taskParser.hasTodoistId(line) && !this.taskParser.hasTodoistTag(line)) {
                //console.log(line)
                //console.log('prepare to add todoist tag')
                const newLine = this.taskParser.addTodoistTag(line);
                //console.log(newLine)
                lines[i] = newLine
                modified = true
            }
        }
        
        if (modified) {
            console.log(`New task found in files ${filepath}`)
            const newContent = lines.join('\n')
            //console.log(newContent)
            await this.app.vault.modify(file, newContent)

            //update filemetadate
            const metadata = await this.cacheOperation.getFileMetadata(filepath)
            if(!metadata){
                await this.cacheOperation.newEmptyFileMetadata(filepath)
            }

        }
    }



    //add todoist at the line
    async addTodoistLinkToFile(filepath: string) {    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (this.taskParser.hasTodoistId(line) && this.taskParser.hasTodoistTag(line)) {
                if(this.taskParser.hasTodoistLink(line)){
                    return
                }
                console.log(line)
                //console.log('prepare to add todoist link')
                const taskID = this.taskParser.getTodoistIdFromLineText(line)
                const taskObject = this.cacheOperation.loadTaskFromCacheyID(taskID)
                const todoistLink = taskObject.url
                const link = `[link](${todoistLink})`
                const newLine = this.taskParser.addTodoistLink(line,link)
                console.log(newLine)
                lines[i] = newLine
                modified = true
            }else{
                continue
            }
        }
        
        if (modified) {
            const newContent = lines.join('\n')
            //console.log(newContent)
            await this.app.vault.modify(file, newContent)



        }
    }


        //add #todoist at the end of task line, if full vault sync enabled
    async addTodoistTagToLine(filepath:string,lineText:string,lineNumber:number,fileContent:string) {    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = fileContent
    
        const lines = content.split('\n')
        let modified = false
    
        
        const line = lineText
        if(!this.taskParser.isMarkdownTask(line)){
            //console.log(line)
            //console.log("It is not a markdown task.")
            return;
        }
        //if content is empty
        if(this.taskParser.getTaskContentFromLineText(line) == ""){
            //console.log("Line content is empty")
            return;
        }
        if (!this.taskParser.hasTodoistId(line) && !this.taskParser.hasTodoistTag(line)) {
            //console.log(line)
            //console.log('prepare to add todoist tag')
            const newLine = this.taskParser.addTodoistTag(line);
            //console.log(newLine)
            lines[lineNumber] = newLine
            modified = true
        }
        
        
        if (modified) {
            console.log(`New task found in files ${filepath}`)
            const newContent = lines.join('\n')
            console.log(newContent)
            await this.app.vault.modify(file, newContent)

            //update filemetadate
            const metadata = await this.cacheOperation.getFileMetadata(filepath)
            if(!metadata){
                await this.cacheOperation.newEmptyFileMetadata(filepath)
            }

        }
    }

    // sync updated task content  to file
    async syncUpdatedTaskContentToTheFile(evt:Object) {
        const taskId = evt.object_id
        // 获取任务文件路径
        const currentTask = await this.cacheOperation.loadTaskFromCacheyID(taskId)
        const filepath = currentTask.path
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (line.includes(taskId) && this.taskParser.hasTodoistTag(line)) {
                const oldTaskContent = this.taskParser.getTaskContentFromLineText(line)
                const newTaskContent = evt.extra_data.content

                lines[i] = line.replace(oldTaskContent, newTaskContent)
                modified = true
                break
            }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //console.log(newContent)
        await this.app.vault.modify(file, newContent)
        }
        
    }

    // sync updated task due date  to the file
    async syncUpdatedTaskDueDateToTheFile(evt:Object) {
        const taskId = evt.object_id
        // 获取任务文件路径
        const currentTask = await this.cacheOperation.loadTaskFromCacheyID(taskId)
        const filepath = currentTask.path
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.taskParser.hasTodoistTag(line)) {
            const oldTaskDueDate = this.taskParser.getDueDateFromLineText(line) || ""
            const newTaskDueDate = this.taskParser.ISOStringToLocalDateString(evt.extra_data.due_date) || ""
            
            //console.log(`${taskId} duedate is updated`)
            console.log(oldTaskDueDate)
            console.log(newTaskDueDate)
            if(oldTaskDueDate === ""){
                //console.log(this.taskParser.insertDueDateBeforeTodoist(line,newTaskDueDate))
                lines[i] = this.taskParser.insertDueDateBeforeTodoist(line,newTaskDueDate)
                modified = true

            }
            else if(newTaskDueDate === ""){
                //remove 日期from text
                const regexRemoveDate = /(🗓️|📅|📆|🗓)\s?\d{4}-\d{2}-\d{2}/; //匹配日期🗓️2023-03-07"
                lines[i] = line.replace(regexRemoveDate,"")
                modified = true
            }
            else{

                lines[i] = line.replace(oldTaskDueDate, newTaskDueDate)
                modified = true
            }
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //console.log(newContent)
        await this.app.vault.modify(file, newContent)
        }
        
    }


    // sync new task note to file
    async syncAddedTaskNoteToTheFile(evt:Object) {


        const taskId = evt.parent_item_id
        const note = evt.extra_data.content
        const datetime = this.taskParser.ISOStringToLocalDatetimeString(evt.event_date)
        // 获取任务文件路径
        const currentTask = await this.cacheOperation.loadTaskFromCacheyID(taskId)
        const filepath = currentTask.path
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (line.includes(taskId) && this.taskParser.hasTodoistTag(line)) {
                const indent = '\t'.repeat(line.length - line.trimStart().length + 1);
                const noteLine = `${indent}- ${datetime} ${note}`;
                lines.splice(i + 1, 0, noteLine);
                modified = true
                break
            }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //console.log(newContent)
        await this.app.vault.modify(file, newContent)
        }
        
    }


    //避免使用该方式，通过view可以获得实时更新的value
    async readContentFromFilePath(filepath:string){
        try {
            const file = this.app.vault.getAbstractFileByPath(filepath);
            const content = await this.app.vault.read(file);
            return content
        } catch (error) {
            console.error(`Error loading content from ${filepath}: ${error}`);
            return false;
        }
    }

    //get line text from file path
    //请使用 view.editor.getLine，read 方法有延迟
    async getLineTextFromFilePath(filepath:string,lineNumber:string) {

        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        return(lines[lineNumber])
    }
  
    //search todoist_id by content
    async searchTodoistIdFromFilePath(filepath: string, searchTerm: string): string | null {
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const fileContent = await this.app.vault.read(file)
        const fileLines = fileContent.split('\n');
        let todoistId: string | null = null;
    
        for (let i = 0; i < fileLines.length; i++) {
        const line = fileLines[i];
    
        if (line.includes(searchTerm)) {
            const regexResult = /\[todoist_id::\s*(\w+)\]/.exec(line);
    
            if (regexResult) {
            todoistId = regexResult[1];
            }
    
            break;
        }
        }
    
        return todoistId;
    }

    //get all files in the vault
    async getAllFilesInTheVault(){
        const files = this.app.vault.getFiles()
        return(files)
    }





}
