import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Remember to rename these classes and interfaces!

//settings
import { MyPluginSettings,DEFAULT_SETTINGS,SampleSettingTab } from 'src/settings';
//todoist  api
import { TodoistRestAPI } from 'src/todoistRestAPI';
import { TodoistSyncAPI } from 'src/todoistSyncAPI';
//task parser 
import { TaskParser } from 'src/taskParser';
//task read and write
import { DataRW } from 'src/DataReadAndWrite';
//sync module
import { TodoistSync } from 'src/syncModule';

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	todoistRestAPI:TodoistRestAPI;
	todoistSyncAPI:TodoistSyncAPI;
	taskParser:TaskParser;
	dataRw:DataRW;
	todoistSync:TodoistSync;

	async onload() {

		await this.loadSettings();
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
		if (!this.settings.todoistAPIToken) {
			new Notice('请配置Todoist API');
			return	   
		}else{
			await this.initializePlugin();
		}




		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('list-checks', 'Sync with todoist', async (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			//new Notice('This is a notice!');
			const activeFile = evt.view.app.workspace.getActiveFile()
			if(activeFile){
				await this.todoistSync.fullTextNewTaskCheck()
				await this.todoistSync.deletedTaskCheck()

			}

		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		//key 事件监听，判断换行和删除
		this.registerDomEvent(document, 'keyup', async (evt: KeyboardEvent) =>{
			//console.log(`key pressed`)
	
			//判断点击事件发生的区域,如果不在编辑器中，return
			if (!(evt.view.app.workspace.activeEditor?.editor?.hasFocus)) {
				(console.log(`editor is not focused`))
				return
			}
			const view = evt.view.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = view.app.workspace.activeEditor?.editor
	
			if (evt.key === 'ArrowUp' || evt.key === 'ArrowDown' || evt.key === 'ArrowLeft' || evt.key === 'ArrowRight' ||evt.key === 'PageUp' || evt.key === 'PageDown') {
				console.log(`${evt.key} arrow key is released`);
				//lineNumberCheck(editor,view)
			}
			if(evt.key === "Delete" || evt.key === "Backspace"){
				console.log(`${evt.key} key is released`);
				await this.todoistSync.deletedTaskCheck();		
			}
		});
		


		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		//hook editor-change 事件，如果当前line包含 #todoist,说明有new task
		this.registerEvent(this.app.workspace.on('editor-change',async (editor,view)=>{			
			await this.todoistSync.lineContentNewTaskCheck(editor,view)
			await this.saveSettings()
		}))
	}

	async onunload() {
		await this.saveSettings()

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async modifyTodoistAPI(api:string){
		this.settings.todoistAPIToken = api
		await this.saveSettings()
		await this.initializePlugin() 
	}

	async initializePlugin(){
		
		//initialize todoist restapi 
		this.todoistRestAPI = new TodoistRestAPI(this.app,this.settings)

		//initialize data read and write object
		this.dataRw = new DataRW(this.app,this.settings,this.todoistRestAPI)
		const ini = await this.dataRw.saveProjectsToCache()
		//console.log(ini)
		if(ini){
	
			if(!this.settings.initialized){
				//初始化settings
				this.settings.todoistTasksData.tasks = []
				this.settings.todoistTasksData.events = []
				this.settings.initialized = true
				await this.saveSettings()
			}
			new Notice(`插件初始化成功`)
		}else{
			new Notice(`初始化失败,请检查todoist api`)
			return
		}

		//initialize todoisy sync api
		this.todoistSyncAPI = new TodoistSyncAPI(this.app,this.settings)



		//initialize task parser
		this.taskParser = new TaskParser(this.app,this.settings,this.dataRw)

		//initialize todoist sync module
		 this.todoistSync = new TodoistSync(this.app,this.settings,this.todoistRestAPI,this.todoistSyncAPI,this.taskParser,this.dataRw)

		


	}


}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}


