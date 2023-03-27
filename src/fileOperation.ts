import MyPlugin from "main";
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting ,TFile} from 'obsidian';
import { MyPluginSettings } from 'src/settings';
import { TodoistRestAPI } from "./todoistRestAPI";

export class FileOperation   {
	app:App;
    settings:MyPluginSettings;
    todoistRestAPI:TodoistRestAPI;

	constructor(app:App, settings:MyPluginSettings,todoistRestAPI:TodoistRestAPI) {
		//super(app,settings);
		this.app = app;
        this.settings = settings;
        this.todoistRestAPI = todoistRestAPI;
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


}
