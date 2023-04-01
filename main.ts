import { MarkdownView, Notice, Plugin } from 'obsidian';



//settings
import { UltimateTodoistSyncSettings,DEFAULT_SETTINGS,UltimateTodoistSyncSettingTab } from './src/settings';
//todoist  api
import { TodoistRestAPI } from './src/todoistRestAPI';
import { TodoistSyncAPI } from './src/todoistSyncAPI';
//task parser 
import { TaskParser } from './src/taskParser';
//cache task read and write
import { CacheOperation } from './src/cacheOperation';
//file operation
import { FileOperation } from './src/fileOperation';

//sync module
import { TodoistSync } from './src/syncModule';


export default class UltimateTodoistSyncForObsidian extends Plugin {
	settings: UltimateTodoistSyncSettings;
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
		this.addSettingTab(new UltimateTodoistSyncSettingTab(this.app, this));
		if (!this.settings.todoistAPIToken) {
			new Notice('Please enter your Todoist API.');
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
			const activeFile = this.app.workspace.getActiveFile()
			if(activeFile){
				if(!( this.checkModuleClass())){
					return
				}
				await this.todoistSync.syncCompletedTaskStatusToObsidian()
				await this.todoistSync.syncUncompletedTaskStatusToObsidian()
				await this.todoistSync.syncUpdatedTaskToObsidian()
				//await this.saveSettings()

				await this.todoistSync.fullTextNewTaskCheck()
				await this.todoistSync.deletedTaskCheck()
				await this.todoistSync.fullTextModifiedTaskCheck()
				this.saveSettings()

			}

		});






		//key 事件监听，判断换行和删除
		this.registerDomEvent(document, 'keyup', async (evt: KeyboardEvent) =>{
			if(!this.settings.apiInitialized){
				return
			}
			//console.log(`key pressed`)
			
			//判断点击事件发生的区域,如果不在编辑器中，return
			if (!(this.app.workspace.activeEditor?.editor?.hasFocus())) {
				(console.log(`editor is not focused`))
				return
			}
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = view?.app.workspace.activeEditor?.editor
	
			if (evt.key === 'ArrowUp' || evt.key === 'ArrowDown' || evt.key === 'ArrowLeft' || evt.key === 'ArrowRight' ||evt.key === 'PageUp' || evt.key === 'PageDown') {
				//console.log(`${evt.key} arrow key is released`);
				if(!( this.checkModuleClass())){
					return
				}
				this.lineNumberCheck()
			}
			if(evt.key === "Delete" || evt.key === "Backspace"){
				//console.log(`${evt.key} key is released`);
				if(!( this.checkModuleClass())){
					return
				}
				await this.todoistSync.deletedTaskCheck();
				this.saveSettings()		
			}
		});

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', async (evt: MouseEvent) => {
			if(!this.settings.apiInitialized){
				return
			}
			//console.log('click', evt);
			if (this.app.workspace.activeEditor?.editor?.hasFocus()) {
				//console.log('Click event: editor is focused');
				const view = this.app.workspace.getActiveViewOfType(MarkdownView)
				const editor = this.app.workspace.activeEditor?.editor
				this.lineNumberCheck()
			}
			else{
				//
			}

			const target = evt.target as HTMLInputElement;

			if (target.type === "checkbox") {
				if(!(this.checkModuleClass())){
					return
				}
				this.checkboxEventhandle(evt)
				//this.todoistSync.fullTextModifiedTaskCheck()

			}

		});



		//hook editor-change 事件，如果当前line包含 #todoist,说明有new task
		this.registerEvent(this.app.workspace.on('editor-change',async (editor,view:MarkdownView)=>{
			if(!this.settings.apiInitialized){
				return
			}

			this.lineNumberCheck()
			if(!(this.checkModuleClass())){
				return
			}		
			await this.todoistSync.lineContentNewTaskCheck(editor,view)
			this.saveSettings()
		}))

		//监听删除事件，当文件被删除后，读取frontMatter中的tasklist,批量删除
		this.registerEvent(this.app.metadataCache.on('deleted', async(file,prevCache) => {
			if(!this.settings.apiInitialized){
				return
			}
			//console.log('a new file has modified')
			console.log(`file deleted`)
			//读取frontMatter
			const frontMatter = await this.cacheOperation.getFileMetadata(file.path)
			if(frontMatter === null || frontMatter.todoistTasks === undefined){
				console.log('There is no task in the deleted files.')
				return
			}
			//判断todoistTasks是否为null
			console.log(frontMatter.todoistTasks)
			if(!( this.checkModuleClass())){
					return
				}
			await this.todoistSync.deleteTasksByIds(frontMatter.todoistTasks)
			this.saveSettings()
			
			
		}));

		//监听 rename 事件,更新 task data 中的 path
		this.registerEvent(this.app.vault.on('rename', async (file,oldpath) => {
			if(!this.settings.apiInitialized){
				return
			}
			console.log(`${oldpath} is renamed`)
			//读取frontMatter
			//const frontMatter = await this.fileOperation.getFrontMatter(file)
			const frontMatter =  await this.cacheOperation.getFileMetadata(oldpath)
			console.log(frontMatter)
			if(frontMatter === null || frontMatter.todoistTasks === undefined){
				//console.log('删除的文件中没有task')
				return
			}
			if(!(this.checkModuleClass())){
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
		await this.initializePlugin() 
	}

	// return true of false
	async initializePlugin(){
		
		//initialize todoist restapi 
		this.todoistRestAPI = new TodoistRestAPI(this.app,this.settings)

		//initialize data read and write object
		this.cacheOperation = new CacheOperation(this.app,this.settings,this.todoistRestAPI)
		const ini = await this.cacheOperation.saveProjectsToCache()

		if(!ini){
			this.todoistRestAPI === undefined
			this.todoistSyncAPI === undefined
			this.taskParser === undefined
			this.taskParser ===undefined
			this.cacheOperation ===undefined
			this.fileOperation ===undefined
			this.todoistSync === undefined
			new Notice(`Ultimita Todoist Sync plugin initialization failed, please check the todoist api`)
			return false		
		}

		if(!this.settings.initialized){

			//创建备份文件夹备份todoist 数据
			try{
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
				new Notice(`error creating user data folder`)
				return false
			}


			//初始化settings
			this.settings.todoistTasksData.tasks = []
			this.settings.todoistTasksData.events = []
			this.settings.initialized = true
			this.saveSettings()
			new Notice(`Ultimita Todoist Sync initialization successful. Todoist data has been backed up.`)

		}


		this.initializeModuleClass()

		//每次启动前备份所有数据
		//this.todoistSync.backupTodoistAllResources()
		this.settings.apiInitialized = true
		new Notice(`Ultimita Todoist Sync loaded successfully.`)
		return true
		


	}

	async initializeModuleClass(){

		//initialize todoist restapi 
		this.todoistRestAPI = new TodoistRestAPI(this.app,this.settings)

		//initialize data read and write object
		this.cacheOperation = new CacheOperation(this.app,this.settings,this.todoistRestAPI)
		this.taskParser = new TaskParser(this.app,this.settings,this.cacheOperation)

		//initialize file operation
		this.fileOperation = new FileOperation(this.app,this.settings,this.todoistRestAPI,this.taskParser,this.cacheOperation)

		//initialize todoisy sync api
		this.todoistSyncAPI = new TodoistSyncAPI(this.app,this.settings)

		//initialize todoist sync module
		this.todoistSync = new TodoistSync(this.app,this,this.settings,this.todoistRestAPI,this.todoistSyncAPI,this.taskParser,this.cacheOperation,this.fileOperation)


	}

	lineNumberCheck(){
		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if(view){
			const cursor = view.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getCursor()
			const line = cursor?.line
			//const lineText = view.editor.getLine(line)
			const fileContent = view.data

			//console.log(line)
			//const fileName = view.file?.name
			const fileName =  view.app.workspace.getActiveViewOfType(MarkdownView)?.app.workspace.activeEditor?.file?.name
			const filepath =  view.app.workspace.getActiveViewOfType(MarkdownView)?.app.workspace.activeEditor?.file?.path
			if (typeof this.lastLines === 'undefined' || typeof this.lastLines.get(fileName as string) === 'undefined'){
				this.lastLines.set(fileName as string, line as number);
				return
			}

					//console.log(`filename is ${fileName}`)
			if(this.lastLines.has(fileName as string) && line !== this.lastLines.get(fileName as string)){
				const lastLine = this.lastLines.get(fileName as string)
				//console.log('Line changed!', `current line is ${line}`, `last line is ${lastLine}`);

				// 执行你想要的操作
				const lastLineText = view.editor.getLine(lastLine as number)
				//console.log(lastLineText)
				if(!( this.checkModuleClass())){
					return
				}
				this.todoistSync.lineModifiedTaskCheck(filepath as string,lastLineText,lastLine as number,fileContent)

				this.lastLines.set(fileName as string, line as number);
			}
			else  {
				//console.log('Line not changed');				
			}

		}


		

	}

	checkboxEventhandle(evt:MouseEvent){
		if(!( this.checkModuleClass())){
			return
		}
		const target = evt.target as HTMLInputElement;

		const taskElement = target.closest("div");    //使用 evt.target.closest() 方法寻找特定的父元素，而不是直接访问事件路径中的特定索引
		//console.log(taskElement)
		if (!taskElement) return;
		const regex = /\[todoist_id:: (\d+)\]/; // 匹配 [todoist_id:: 数字] 格式的字符串
		const match = taskElement.textContent?.match(regex) || false;
		if (match) {
			const taskId = match[1];
			//console.log(taskId)
			//const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (target.checked) {
				this.todoistSync.closeTask(taskId);
			} else {
				this.todoistSync.repoenTask(taskId);
			}
		} else {
			//console.log('未找到 todoist_id');
			//开始全文搜索，检查status更新

			this.todoistSync.fullTextModifiedTaskCheck()
		}
	}



	//return true
	checkModuleClass(){
		if(this.settings.apiInitialized  === true){
			if(this.todoistRestAPI === undefined || this.todoistSyncAPI === undefined ||this.cacheOperation === undefined || this.fileOperation === undefined ||this.todoistSync === undefined ||this.taskParser === undefined){
				this.initializeModuleClass()
			}
			return true
		}
		else{
			new Notice(`Please enter the correct Todoist API token"`)
			return(false)
		}
		

	}


}




