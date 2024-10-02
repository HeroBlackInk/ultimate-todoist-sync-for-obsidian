
import {pullTargetMode, pullTaskNotesMode} from "./settings";
import moment from "moment";
import {
    appHasDailyNotesPluginLoaded,
    createDailyNote,
    getAllDailyNotes,
    getDailyNote
} from "obsidian-daily-notes-interface";
import UltimateTodoistSyncForObsidian from "../main";
import {App, Notice, TAbstractFile, TFile} from "obsidian";
export class FileOperation   {
	app:App;
    plugin: UltimateTodoistSyncForObsidian;


	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
        this.plugin = plugin;

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
        console.log("taskid", taskId)
        let currentTask = await this.plugin.cacheOperation.loadTaskFromCacheByID(taskId)
        if (currentTask == undefined) {
            const filepath = await this.searchFilepathsByTaskidInVault(taskId)
            if (filepath == null) {
                console.log(`Task ${taskId} not found in vault`)
                return
            }
            const metadata = await this.plugin.cacheOperation.getFileMetadata(filepath)
            if(!metadata){
                await this.plugin.cacheOperation.newEmptyFileMetadata(filepath)
            }
            const taskObject = await this.plugin.todoistRestAPI.getTaskById(taskId);
            taskObject.path = filepath
            this.plugin.cacheOperation.appendTaskToCache(taskObject)
            currentTask = taskObject
        }
        const filepath = currentTask.path
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        if(file == null) {
            console.log("Error with filepath: " + filepath)
            return
        }
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
            lines[i] = line.replace('[ ]', '[x]')
            console.warn(`${taskId} has completed in file ${filepath}, at line ${line}`)
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
        let currentTask = await this.plugin.cacheOperation.loadTaskFromCacheByID(taskId)
        if (currentTask == undefined) {
            const filepath = await this.searchFilepathsByTaskidInVault(taskId)
            if (filepath == null) {
                console.log(`Task ${taskId} not found in vault`)
                return
            }
            const metadata = await this.plugin.cacheOperation.getFileMetadata(filepath)
            if(!metadata){
                await this.plugin.cacheOperation.newEmptyFileMetadata(filepath)
            }
            const taskObject = await this.plugin.todoistRestAPI.getTaskById(taskId);
            taskObject.path = filepath
            this.plugin.cacheOperation.appendTaskToCache(taskObject)
            currentTask = taskObject
        }
        const filepath = currentTask.path

        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
            lines[i] = line.replace(/- \[(x|X)\]/g, '- [ ]');
            console.warn(`${taskId} has unchecked in file ${filepath}, at line ${line}`)
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
            if(!this.plugin.taskParser.isMarkdownTask(line)){
                //console.log(line)
                //console.log("It is not a markdown task.")
                continue;
            }
            //if content is empty
            if(this.plugin.taskParser.getTaskContentFromLineText(line) == ""){
                //console.log("Line content is empty")
                continue;
            }
            if (!this.plugin.taskParser.hasTodoistId(line) && !this.plugin.taskParser.hasTodoistTag(line)) {
                //console.log(line)
                //console.log('prepare to add todoist tag')
                const newLine = this.plugin.taskParser.addTodoistTag(line);
                console.warn(`Todost tag has added to ${taskId} in file ${filepath}, at line ${line}`)
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
            const metadata = await this.plugin.cacheOperation.getFileMetadata(filepath)
            if(!metadata){
                await this.plugin.cacheOperation.newEmptyFileMetadata(filepath)
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
            if (this.plugin.taskParser.hasTodoistId(line) && this.plugin.taskParser.hasTodoistTag(line)) {
                if(this.plugin.taskParser.hasTodoistLink(line)){
                    continue
                }
                console.log(line)
                //console.log('prepare to add todoist link')
                const taskID = this.plugin.taskParser.getTodoistIdFromLineText(line)
                const taskObject = this.plugin.cacheOperation.loadTaskFromCacheByID(taskID)
                if(!taskObject){
                    let obsidianUrl = this.plugin.taskParser.getObsidianUrlFromFilepath(filepath)
                    console.error(`An error occurred while add task ${taskID}'s todoist link to the file ${filepath}. \n ${obsidianUrl}`);
                    continue
                }
                const todoistLink = taskObject.url
                const link = `[link](${todoistLink})`
                const newLine = this.plugin.taskParser.addTodoistLink(line,link)
                console.log(newLine)
                lines[i] = newLine
                console.warn(`Todoist link has added to task ${taskId} in file ${filepath}, at line ${line}`)
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
        if(!this.plugin.taskParser.isMarkdownTask(line)){
            //console.log(line)
            //console.log("It is not a markdown task.")
            return;
        }
        //if content is empty
        if(this.plugin.taskParser.getTaskContentFromLineText(line) == ""){
            //console.log("Line content is empty")
            return;
        }
        if (!this.plugin.taskParser.hasTodoistId(line) && !this.plugin.taskParser.hasTodoistTag(line)) {
            //console.log(line)
            //console.log('prepare to add todoist tag')
            const newLine = this.plugin.taskParser.addTodoistTag(line);
            //console.log(newLine)
            lines[lineNumber] = newLine
            console.warn(`Todoist tag has added to task ${taskId} in file ${filepath}, at line ${line}`)
            modified = true
        }
        
        
        if (modified) {
            console.log(`New task found in files ${filepath}`)
            const newContent = lines.join('\n')
            console.log(newContent)
            await this.app.vault.modify(file, newContent)

            //update filemetadate
            const metadata = await this.plugin.cacheOperation.getFileMetadata(filepath)
            if(!metadata){
                await this.plugin.cacheOperation.newEmptyFileMetadata(filepath)
            }

        }
    }

    // sync updated task content  to file
    // Returns the filepath of the updated file
    async updateTaskContentInFile(taskId, filepath, taskContent,tags): Promise<string> {


        let currentTask = await this.plugin.cacheOperation.loadTaskFromCacheByID(taskId)
		if (currentTask == undefined) {
            console.error(`Task ${taskId} was not found in cache`)
			
			if (filepath == null) {
				console.error(`Task ${taskId} was not found in the vault`)
				return ""
			}
			const metadata = await this.plugin.cacheOperation.getFileMetadata(filepath)
			if(!metadata){
				await this.plugin.cacheOperation.newEmptyFileMetadata(filepath)
			}
			const taskObject = await this.plugin.todoistRestAPI.getTaskById(taskId);
			taskObject.path = filepath
			this.plugin.cacheOperation.appendTaskToCache(taskObject)
			currentTask = taskObject
		}
		

        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        if (file == null) {
            console.log("Error with filepath: " + filepath)
            return filepath
        }
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
				const oldTaskContent = this.plugin.taskParser.getTaskContentFromLineText(line)
				const newTaskContent = taskContent

				let newline = line.replace(oldTaskContent, newTaskContent)
                console.warn(`Update task content in file ${filepath}, at line ${line}`)
                console.warn(`old content: ${oldTaskContent}, new content ${newTaskContent}`)

				if(this.plugin.settings.syncTagsFromTodoist){
					const oldTags = this.plugin.taskParser.getAllTagsFromLineText(line)
					const newTags = tags

					if(oldTags != undefined && newTags != undefined) {
						// remove tags if label missing
						const removedTags = oldTags.filter(x => !newTags.includes(x))
						removedTags.forEach(tag =>
							newline = newline.replace(` #${tag} `, ' ')
						)

						// append labels as tags
						const addTags = newTags.filter(x => !oldTags.includes(x))
						addTags.forEach(tag => {
							let position = newline.search(/\s#todoist\s/)
							if(position > -1) {
								newline = newline.slice(0, position) + ` #${tag}` + newline.slice(position)
							}
						})
                        console.warn(`Update task tags in file ${filepath}, at line ${line}`)
                        console.warn(`oldTags: ${oldTags}, newTags ${newTags}`)
					}
				}
				lines[i] = newline
				modified = true
				break
			}
		}

        if (modified) {
        const newContent = lines.join('\n')
        
        await this.app.vault.modify(file, newContent)
        }
        return filepath
        
    }

    // sync updated task due date  to the file
    async updateTaskDueDateInFile(taskId, filepath, dueDate) {
        // 获取任务文件路径
        const currentTask = await this.plugin.cacheOperation.loadTaskFromCacheByID(taskId)
        
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
            const oldTaskDueDate = this.plugin.taskParser.getDueDateFromLineText(line) || ""
            const newTaskDueDate = dueDate 
            
            //console.log(`${taskId} duedate is updated`)
            if(oldTaskDueDate === ""){
                //console.log(this.plugin.taskParser.insertDueDateBeforeTodoist(line,newTaskDueDate))
                lines[i] = this.plugin.taskParser.insertDueDateBeforeTodoist(line,newTaskDueDate)
                console.warn(`Update task due date in file ${filepath}, at line ${line}`)
                console.warn(`old duedate: ${oldTaskDueDate}, new duedate ${newTaskDueDate}`)
                modified = true

            }
            else if(newTaskDueDate === ""){
                //remove 日期from text
                const regexRemoveDate = /(🗓️|📅|📆|🗓)\s?\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/; //匹配日期🗓️2023-03-07T:08:00"
                lines[i] = line.replace(regexRemoveDate,"")
                console.warn(`Update task due date in file ${filepath}, at line ${line}`)
                console.warn(`old duedate: ${oldTaskDueDate}, new duedate ${newTaskDueDate}`)
                modified = true
            }
            else{

                lines[i] = line.replace(oldTaskDueDate, newTaskDueDate)
                console.warn(`Update task due date in file ${filepath}, at line ${line}`)
                console.warn(`old duedate: ${oldTaskDueDate}, new duedate ${newTaskDueDate}`)
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


    async syncNewTaskToTheFile(evt:Object) {
        console.log(`sync new task to the file`, evt)
        const taskId = evt.object_id
        const taskObject = await this.plugin.todoistRestAPI.getTaskById(taskId);

        const myProjectsOptions = this.plugin.settings.todoistTasksData?.projects?.reduce((obj, item) => {
            obj[(item.id).toString()] = item.name;
            return obj;
        }, {});

        const currentTask = await this.plugin.cacheOperation.loadTaskFromCacheByID(taskId)
        let filepath = ""
        if (currentTask != undefined) {
            filepath = currentTask.path
        } else if (this.plugin.settings.pullTargetMode == pullTargetMode.DailyNote) {
            if(!appHasDailyNotesPluginLoaded()){
                console.log("Daily notes core plugin is not loaded. So we cannot create daily note. Please install daily notes core plugin. Interrupt now.")
            }
            const date = moment();
            const dailies = getAllDailyNotes()
            let file = getDailyNote(date, dailies)
            if (file == null) {
                file = await createDailyNote(date)
            }
            filepath = file.path
            console.log(`Daily note used: ${filepath}`)
        } else if (this.plugin.settings.pullTargetMode == pullTargetMode.Template) {
            let templatePath = this.plugin.settings.pullTemplateUsePath
            if(templatePath.startsWith("/")){
                templatePath = templatePath.slice(1,templatePath.length)
            }
            if (!templatePath.endsWith(".md")) {
                templatePath += ".md"
            }
            const template = await this.app.vault.read(<TFile>this.app.vault.getAbstractFileByPath(templatePath))
            let useThisFolder = this.plugin.settings.pullTemplateUseFolder
            if(useThisFolder.startsWith("/")){
                useThisFolder = useThisFolder.slice(1,useThisFolder.length)
            }
            if(useThisFolder.endsWith("/")){
                useThisFolder = useThisFolder.slice(0,useThisFolder.length-1)
            }
            if(this.plugin.settings.pullTemplateUseForProjects == pullTaskNotesMode.projectNote) {
                // Create a file for project from template
                let projectTitle = myProjectsOptions[taskObject.projectId]
                if(projectTitle == undefined){
                    projectTitle = "Unknown"
                }
                let path =  projectTitle + ".md"
                if (useThisFolder != "") {
                    path = useThisFolder + "/" + path
                }
                try {
                    const file = await this.app.vault.create(path, template)
                    filepath = file.path
                } catch (e) {
                    console.log(`Error creating projects note: ${e}`)
                    filepath = path
                }
            } else {
                // Create a new file from template
                let taskTitle = taskObject.content.replace(/[\[\]/\\?%*:|"<>.]/g, '-')
                let tmpFile = this.plugin.settings.pullTemplateTaskNotesFormat
                    .replace("{{title}}", taskTitle)
                    .replace("{{TITLE}}",taskTitle.toUpperCase())
                const dateFormat = this.plugin.settings.pullTemplateTaskNotesFormat.match(/\{\{date\|([\[\]\s\w.:-]*)}}/)
                if (dateFormat != null && dateFormat.length > 0) {
                    // remove the date format from the given filename
                    tmpFile = tmpFile.replace("|" + dateFormat[1], "")
                    tmpFile = tmpFile.replace("{{date}}", moment().format(dateFormat[1].trim()))
                }
                if(!tmpFile.endsWith(".md")) {
                    tmpFile += ".md"
                }

                if (useThisFolder != "") {
                    tmpFile = useThisFolder + "/" + tmpFile
                }

                try {
                    const file = await this.app.vault.create(tmpFile, template)
                    filepath = file.path
                } catch (e) {
                    console.log(`Error creating new file from template: ${e}`)
                    await this.app.vault.read(<TFile>this.app.vault.getAbstractFileByPath(tmpFile))
                    filepath = tmpFile
                }
            }
        }

        taskObject.path = filepath
        new Notice(`new task ${taskObject.content} id is ${taskObject.id}`)
        this.plugin.cacheOperation.appendTaskToCache(taskObject)

        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)

        const lines = content.split('\n')
        let modified = false

        const fromTaskObjectToTask = (taskObject) => {
            let text_with_out_link = `- [ ] ${taskObject.content}`
            if (taskObject.due != undefined) {
                text_with_out_link += ` 📅${taskObject.due.date}`
            }
            text_with_out_link += " #todoist"
			for(let i = 0; i < taskObject.labels.length; i++){
				text_with_out_link += ` #${taskObject.labels[i]}`
			}

            const link = `[link](${taskObject.url})`
            let newLine = this.plugin.taskParser.addTodoistLink(text_with_out_link,link)
            newLine += ` %%[todoist_id:: ${taskId}]%%`;
            return newLine
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]

            // append the tasks after a given place
            if(!this.plugin.settings.pullDailyNoteAppendMode && line.includes(this.plugin.settings.pullDailyNoteInsertAfterText)){
                const newLine = fromTaskObjectToTask(taskObject)
                lines.splice(i + 1, 0, newLine);

                if(taskObject.description != undefined && taskObject.description != "") {
                    const newLineForDescription = "\t- " + taskObject.description
                    lines.splice(i + 2, 0, newLineForDescription);
                }

                modified = true
                break
            }
        }


        // append to the end of file
        // handles also the case, if the given text cannot be found and the task will not be thrown away
        if(this.plugin.settings.pullDailyNoteAppendMode || !modified){
            const newLine = fromTaskObjectToTask(taskObject)
            lines.push(newLine);
            if(taskObject.description != undefined && taskObject.description != "") {
                const newLineForDescription = "\t- " + taskObject.description
                lines.push(newLineForDescription);
            }
            modified = true
        }

        if (modified) {
            const newContent = lines.join('\n')
            //console.log(newContent)
            await this.app.vault.modify(file, newContent)
        }

        const metadata = await this.plugin.cacheOperation.getFileMetadata(filepath)
        if(!metadata){
            await this.plugin.cacheOperation.newEmptyFileMetadata(filepath)
        }

        return filepath
    }


    // sync new task note to file
    async syncTaskNoteToFile(taskId,filepath,note,eventDate) {



        // 获取任务文件路径
        const currentTask = await this.plugin.cacheOperation.loadTaskFromCacheByID(taskId)
       
    
        // 获取文件对象并更新内容
        const file = this.app.vault.getAbstractFileByPath(filepath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (line.includes(taskId) && this.plugin.taskParser.hasTodoistTag(line)) {
                const indent = '\t'.repeat(line.length - line.trimStart().length + 1);
                const noteLine = `${indent}- ${eventDate} ${note}`;
                lines.splice(i + 1, 0, noteLine);
                console.warn(`Task note of ${taskId }added in file ${filepath}, at line ${line}`)
                console.warn(`Task note: ${note}`)
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
  
    // Function to search for a Todoist task by id from a specified file path
    async searchTaskFromFilePath(filepath: string, searchTerm: string): Promise<string | null> {
        // 检查输入参数是否有效
        if (!filepath || !searchTerm) {
            console.error("Invalid filepath or searchTerm. Please provide valid arguments.");
            return null;
        }

        try {
            // 获取文件引用
            const file = this.app.vault.getAbstractFileByPath(filepath);
            
            if (!file) {
                console.error(`File not found at path: ${filepath}`);
                return null;
            }

            // 读取文件内容
            const fileContent = await this.app.vault.read(file);
            if (!fileContent) {
                console.error(`Failed to read content from file at path: ${filepath}`);
                return null;
            }

            // 分割文件内容为行
            const fileLines = fileContent.split('\n');
            let resultline: string | null = null;

            //todo use fileContent.contain()
            // 遍历每一行，查找包含 searchTerm 的行
            for (const line of fileLines) {
                // 如果当前行包含 searchTerm，则尝试提取 todoist_id
                if (line.includes(searchTerm)) {
                    // 使用正则表达式提取 [todoist_id:: value]
                    resultline = line
                    break; // 找到目标后停止循环
                }
            }

            // 返回找到的 todoist_id，如果没有找到则返回 null
            return resultline;

        } catch (error) {
            // 处理所有可能的异常
            console.error(`An error occurred while searching for Todoist ID in file at path: ${filepath}.`, error);
            return null;
        }
    }

    //get all files in the vault
    async getAllFilesInTheVault(){
        const files = this.app.vault.getFiles()
        return(files)
    }

    //search filepath by taskid in vault
    async searchFilepathsByTaskidInVault(taskId:string){
        console.log(`prepare to search task ${taskId}`)
        const files = await this.getAllFilesInTheVault()
        //console.log(files)
        const tasks = files.map(async (file) => {
            if (!this.isMarkdownFile(file.path)) {
                return;
            }
            const fileContent = await this.app.vault.cachedRead(file);
            if (fileContent.includes(taskId)) {
                return file.path;
            }
        });
    
        const results = await Promise.all(tasks);
        const filePaths = results.filter((filePath) => filePath !== undefined);
        return filePaths[0] || null;
        //return filePaths || null
    }


    isMarkdownFile(filename:string) {
        // 获取文件名的扩展名
        let extension = filename.split('.').pop();
      
        // 将扩展名转换为小写（Markdown文件的扩展名通常是.md）
        extension = extension.toLowerCase();
      
        // 判断扩展名是否为.md
        if (extension === 'md') {
          return true;
        } else {
          return false;
        }
      }





}
