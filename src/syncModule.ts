import MyPlugin from "main";
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting ,TFile} from 'obsidian';
import { MyPluginSettings } from 'src/settings';


type FrontMatter = {
    todoistTasks: string[];
    todoistCount: number;
  };

export class TodoistSync extends MyPlugin {
	app:App;
    settings:MyPluginSettings;

	constructor(app:App, settings:MyPluginSettings) {
		super(app,settings);
		this.app = app;
        this.settings = settings;
	}


    async getFrontMatter(file:TFile): Promise<FrontMatter | null> {
        return new Promise((resolve) => {
          this.app.fileManager.processFrontMatter(file, (frontMatter) => {
            resolve(frontMatter);
          });
        });
    }


    async  updateFrontMatter(
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

      
    async deletedTaskCheck(): Promise<void> {


        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        //const editor = this.app.workspace.activeEditor?.editor
        const file = this.app.workspace.getActiveFile()
        const filepath = file.path
        console.log(filepath)
      
      
        const frontMatter = await this.getFrontMatter(file);
        if (!frontMatter || !frontMatter.todoistTasks) {
          console.log('frontmatter没有task')
          return;
        }
      
        //const currentFileValue  = await this.app.vault.read(file)
        const currentFileValue = await	this.app.vault.cachedRead(file)
        console.log(currentFileValue)
        const currentFileValueWithOutFrontMatter = currentFileValue.replace(/^---[\s\S]*?---\n/, '');
        const frontMatter_todoistTasks = frontMatter.todoistTasks;
        const frontMatter_todoistCount = frontMatter.todoistCount;
      
        const deleteTasksPromises = frontMatter_todoistTasks
          .filter((taskId) => !currentFileValueWithOutFrontMatter.includes(taskId))
          .map(async (taskId) => {
            try {
              console.log(`initialize todoist api`)
              const api = await initializeTodoistRestAPI()
              const response = await api.deleteTask(taskId);
              console.log(`response is ${response}`);
      
              if (response) {
                console.log(`task ${taskId} 删除成功`);
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
        deleteTaskFromJSONByIDs(deletedTaskIds)
        console.log(`删除了${deletedTaskAmount} 条 task`)
        // 更新 newFrontMatter_todoistTasks 数组
        
        // Disable automatic merging
       
        const newFrontMatter_todoistTasks = frontMatter_todoistTasks.filter(
          (taskId) => !deletedTaskIds.includes(taskId)
        );
      
      
      
        await updateFrontMatter(file, (frontMatter) => {
          frontMatter.todoistTasks = newFrontMatter_todoistTasks;
          frontMatter.todoistCount = frontMatter_todoistCount - deletedTaskAmount;
        });
      }


}