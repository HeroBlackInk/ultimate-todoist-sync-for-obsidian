import MyPlugin from "main";
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting ,TFile} from 'obsidian';
import { MyPluginSettings } from 'src/settings';
import { TodoistRestAPI } from "./todoistRestAPI";
import { CacheOperation } from "./cacheOperation";
export class FileOperation   {
	app:App;
    settings:MyPluginSettings;
    todoistRestAPI:TodoistRestAPI;
    cacheOperation:CacheOperation;


	constructor(app:App, settings:MyPluginSettings,todoistRestAPI:TodoistRestAPI,cacheOperation:CacheOperation) {
		//super(app,settings);
		this.app = app;
        this.settings = settings;
        this.todoistRestAPI = todoistRestAPI;
        this.cacheOperation = cacheOperation;
	}

    async getFrontMatter(file:TFile): Promise<FrontMatter | null> {
        return new Promise((resolve) => {
          this.app.fileManager.processFrontMatter(file, (frontMatter) => {
            resolve(frontMatter);
          });
        });
    }


    async updateFrontMatter(
    file:TFile,
    updater: (frontMatter: FrontMatter) => void
    ): Promise<void> {
        console.log(`prepare to update front matter`)
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

          

     // 完成一个任务，将其标记为已完成
    async  completeTaskInTheFile(taskId: string) {
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
        if (line.includes(taskId) && line.includes('#todoist')) {
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
        if (line.includes(taskId) && line.includes('#todoist')) {
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
    async  getLineTextFromFilePath(filePath:string,lineNumber:string) {

        const file = this.app.vault.getAbstractFileByPath(filePath)
        const content = await this.app.vault.read(file)
    
        const lines = content.split('\n')
        return(lines[lineNumber])
    }
  
    //search todoist_id by content
    async  searchTodoistIdFromFilePath(filepath: string, searchTerm: string): string | null {
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


}
