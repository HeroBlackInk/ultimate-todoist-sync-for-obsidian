import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import * as path from 'path';
// Remember to rename these classes and interfaces!

//settings
import { MyPluginSettings,DEFAULT_SETTINGS,SampleSettingTab } from 'src/settings';
//todoist  api
import { TodoistRestAPI } from 'src/todoistRestAPI';
import { TodoistSyncAPI } from 'src/todoistSyncAPI';
//task parser 
import { TaskParser } from 'src/taskParser';
//cache task read and write
import { CacheOperation } from 'src/cacheOperation';
//file operation
import { FileOperation } from 'src/fileOperation';

//sync module
import { TodoistSync } from 'src/syncModule';


export default class UltimateTodoistSyncForObsidian extends Plugin {
	settings: MyPluginSettings;
	todoistRestAPI:TodoistRestAPI;
	todoistSyncAPI:TodoistSyncAPI;
	taskParser:TaskParser;
	cacheOperation:CacheOperation;
	fileOperation:FileOperation;
	todoistSync:TodoistSync;
	lastLines: Map<string,number>;

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

		//lastLine 对象 {path:line}保存在lastLines map中
		this.lastLines = new Map();


		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('list-checks', 'Sync with todoist', async (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			//new Notice('This is a notice!');
			const activeFile = evt.view.app.workspace.getActiveFile()
			if(activeFile){

				await this.todoistSync.syncCompletedTaskStatusToObsidian()
				await this.todoistSync.syncUncompletedTaskStatusToObsidian()
				await this.todoistSync.syncUpdatedTaskToObsidian()
				//await this.saveSettings()

				await this.todoistSync.fullTextNewTaskCheck()
				await this.todoistSync.deletedTaskCheck()
				await this.todoistSync.fullTextModifiedTaskCheck()

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
				//console.log(`${evt.key} arrow key is released`);
				this.lineNumberCheck()
			}
			if(evt.key === "Delete" || evt.key === "Backspace"){
				//console.log(`${evt.key} key is released`);
				this.todoistSync.deletedTaskCheck();		
			}
		});

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			//console.log('click', evt);
			if (evt.view.app.workspace.activeEditor?.editor.hasFocus) {
				//console.log('Click event: editor is focused');
				const view = evt.view.app.workspace.getActiveViewOfType(MarkdownView)
				const editor = view.app.workspace.activeEditor?.editor
				this.lineNumberCheck()
			}
			else(console.log(`editor is not focused`))

			const target = evt.target as HTMLInputElement;

			if (target.type === "checkbox") {

				this.checkboxEventhandle(evt)

			}

		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		//hook editor-change 事件，如果当前line包含 #todoist,说明有new task
		this.registerEvent(this.app.workspace.on('editor-change',async (editor,view)=>{
			this.lineNumberCheck()			
			this.todoistSync.lineContentNewTaskCheck(editor,view)
			//this.saveSettings()
		}))

		//监听删除事件，当文件被删除后，读取frontMatter中的tasklist,批量删除
		this.registerEvent(this.app.metadataCache.on('deleted', (file,prevCache) => {
			//console.log('a new file has modified')
			console.log(`file deleted`)
			//读取frontMatter
			if(prevCache?.frontmatter === undefined || prevCache.frontmatter.todoistTasks === undefined){
				console.log('删除的文件中没有task')
				return
			}
			//判断todoistTasks是否为null
			console.log(prevCache?.frontmatter.todoistTasks)
			this.todoistSync.deleteTasksByIds(prevCache.frontmatter.todoistTasks)
			
			
		}));

		//监听 rename 事件,更新 task data 中的 path
		this.registerEvent(this.app.vault.on('rename', async (file,oldpath) => {
			console.log(`${oldpath} is renamed`)
			//读取frontMatter
			const frontMatter = await this.fileOperation.getFrontMatter(file)
			console.log(frontMatter)
			if(frontMatter === undefined || frontMatter.todoistTasks === undefined){
				//console.log('删除的文件中没有task')
				return
			}
			await this.cacheOperation.updateRenamedFilePath(oldpath,file.path)
			this.saveSettings()		
		}));
	}


	async onunload() {
		console.log(`Ultimate Todoist Sync for Obsidian id unloaded!`)
		await this.saveSettings()

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		this.saveData(this.settings);
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
		this.cacheOperation = new CacheOperation(this.app,this.settings,this.todoistRestAPI)
		const ini = await this.cacheOperation.saveProjectsToCache()
		//console.log(ini)
		if(ini){
	
			if(!this.settings.initialized){

				//创建备份文件夹备份todoist 数据
				try{
					const userdataPath = path.join(this.app.vault.configDir, 'plugins', 'ultimate-todoist-sync-for-obsidian','userData');
					this.app.vault.createFolder(userdataPath)
					//第一次启动插件，备份todoist 数据
					this.taskParser = new TaskParser(this.app,this.settings,this.cacheOperation)

					//initialize file operation
					this.fileOperation = new FileOperation(this.app,this.settings,this.todoistRestAPI,this.taskParser,this.cacheOperation)
			
					//initialize todoisy sync api
					this.todoistSyncAPI = new TodoistSyncAPI(this.app,this.settings)
			
					//initialize todoist sync module
					this.todoistSync = new TodoistSync(this.app,this,this.settings,this.todoistRestAPI,this.todoistSyncAPI,this.taskParser,this.cacheOperation,this.fileOperation)
			
					//每次启动前备份所有数据
					this.todoistSync.backupTodoistAllResources()
				}catch(error){
					console.log(`error creating user data folder: ${error}`)
					new Notice(`初始化失败`)
					return
				}


				//初始化settings
				this.settings.todoistTasksData.tasks = []
				this.settings.todoistTasksData.events = []
				this.settings.initialized = true
				this.saveSettings()
				new Notice(`第一次启动插件，todoist数据备份成功， 初始化完成`)

			}
			//new Notice(`插件初始化成功`)
			
		}else{
			new Notice(`初始化失败,请检查todoist api`)
			return
		}
		//initialize task parser
		this.taskParser = new TaskParser(this.app,this.settings,this.cacheOperation)

		//initialize file operation
		this.fileOperation = new FileOperation(this.app,this.settings,this.todoistRestAPI,this.taskParser,this.cacheOperation)

		//initialize todoisy sync api
		this.todoistSyncAPI = new TodoistSyncAPI(this.app,this.settings)

		//initialize todoist sync module
		this.todoistSync = new TodoistSync(this.app,this,this.settings,this.todoistRestAPI,this.todoistSyncAPI,this.taskParser,this.cacheOperation,this.fileOperation)

		//每次启动前备份所有数据
		//this.todoistSync.backupTodoistAllResources()
		


	}

	lineNumberCheck(){
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if(view){
			const cursor = view.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getCursor()
			const line = cursor.line
			const lineText = view.editor.getLine(line)
			const fileContent = view.data

			//console.log(line)
			//const fileName = view.file?.name
			const fileName =  view.app.workspace.getActiveViewOfType(MarkdownView)?.app.workspace.activeEditor?.file?.name
			const filePath =  view.app.workspace.getActiveViewOfType(MarkdownView)?.app.workspace.activeEditor?.file?.path
			if (typeof this.lastLines === 'undefined' || typeof this.lastLines.get(fileName) === 'undefined'){
				this.lastLines.set(fileName, line);
				return
			}

					//console.log(`filename is ${fileName}`)
			if(this.lastLines.has(fileName) && line !== this.lastLines.get(fileName)){
				const lastLine = this.lastLines.get(fileName)
				//console.log('Line changed!', `current line is ${line}`, `last line is ${lastLine}`);

				// 执行你想要的操作
				const lastLineText = view.editor.getLine(lastLine)
				//console.log(lastLineText)
				this.todoistSync.lineModifiedTaskCheck(filePath,lastLineText,lastLine,fileContent)

				this.lastLines.set(fileName, line);
			}
			else  {
				//console.log('Line not changed');				
			}

		}


		

	}

	checkboxEventhandle(evt:MouseEvent){
		const target = evt.target as HTMLInputElement;
		let element = target.parentElement;
		//console.log(target.closest("div"))
		const regex = /\[todoist_id:: (\d+)\]/; // 匹配 [todoist_id:: 数字] 格式的字符串
		while (element && !regex.test(element.textContent)) {
		element = element.parentElement;
		}
		if (!element) {
			console.log("未找到 todoist_id");
			//开始全文搜索，检查status更新
			this.todoistSync.fullTextModifiedTaskCheck()
		} else {
			//console.log(`找到了 todoist_id`)

			//console.log(element.textContent)
			//const todoist_id = await searchTodoistIdFromFilePath()		
			const match = element.textContent.match(/\[todoist_id:: (\d+)\]/);
			if (match) {
				const taskId = match[1];
				if (target.checked) {
					this.todoistSync.closeTask(taskId);
				} else {
					this.todoistSync.repoenTask(taskId);
				}
				// ...
			} else {
				console.log("无效的 todoist_id");
			}
		


		}
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


