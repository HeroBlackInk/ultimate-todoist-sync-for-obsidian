import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";

interface MyProject {
	id: string;
	name: string;
  }


export interface UltimateTodoistSyncSettings {
    initialized:boolean;
	//mySetting: string;
	//todoistTasksFilePath: string;
	todoistAPIToken: string; // replace with correct type
	apiInitialized:boolean;
	defaultProjectName: string;
	defaultProjectId:string;
	automaticSynchronizationInterval:Number;
	todoistTasksData:any;
	fileMetadata:any;
	enableFullVaultSync: boolean;
	statistics: any;
	debugMode:boolean;
	sectionPrefix:string;
}


export const DEFAULT_SETTINGS: UltimateTodoistSyncSettings = {
	initialized: false,
	apiInitialized:false,
	defaultProjectName:"Inbox",
	automaticSynchronizationInterval: 300, //default aync interval 300s
	todoistTasksData:{"projects":[],"sections":[],"tasks":[],"events":[]},
	fileMetadata:{},
	enableFullVaultSync:false,
	statistics:{},
	debugMode:false,
	sectionPrefix:"",
	//mySetting: 'default',
	//todoistTasksFilePath: 'todoistTasks.json'

}





export class UltimateTodoistSyncSettingTab extends PluginSettingTab {
	plugin: UltimateTodoistSyncForObsidian;

	constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for Ultimate Todoist Sync for Obsidian.' });

		const myProjectsOptions: MyProject | undefined = this.plugin.settings.todoistTasksData?.projects?.reduce((obj, item) => {
			obj[(item.id).toString()] = item.name;
			return obj;
		  }, {});	  

		new Setting(containerEl)
			.setName('Todoist API')
			.setDesc('Please enter todoist api token and click the paper airplane button to submit.')
			.addText((text) =>
				text
					.setPlaceholder('Enter your API')
					.setValue(this.plugin.settings.todoistAPIToken)
					.onChange(async (value) => {
						this.plugin.settings.todoistAPIToken = value;
						this.plugin.settings.apiInitialized = false;
						//
					})
	
			)
			.addExtraButton((button) => {
				button.setIcon('send')
					.onClick(async () => {
							await this.plugin.modifyTodoistAPI(this.plugin.settings.todoistAPIToken)
							this.display()
							
						})
					
					
			})

			


		new Setting(containerEl)
		.setName('Automatic Sync Interval Time')
		.setDesc('Please specify the desired interval time, with seconds as the default unit. The default setting is 300 seconds, which corresponds to syncing once every 5 minutes. You can customize it, but it cannot be lower than 20 seconds.')
		.addText((text) =>
			text
				.setPlaceholder('Sync interval')
				.setValue(this.plugin.settings.automaticSynchronizationInterval.toString())
				.onChange(async (value) => {
					const intervalNum = Number(value)
					if(isNaN(intervalNum)){
						new Notice(`Wrong type,please enter a number.`)
						return
					}
					if(intervalNum < 20 ){
						new Notice(`The synchronization interval time cannot be less than 20 seconds.`)
						return
					}
					if (!Number.isInteger(intervalNum)) {
						new Notice('The synchronization interval must be an integer.');
						return;
					}
					this.plugin.settings.automaticSynchronizationInterval = intervalNum;
					this.plugin.saveSettings()
					new Notice('Settings have been updated.');
					//
				})

		)


		/*
		new Setting(containerEl)
			.setName('The default project for new tasks')
			.setDesc('New tasks are automatically synced to the Inbox. You can modify the project here.')
			.addText((text) =>
				text
					.setPlaceholder('Enter default project name:')
					.setValue(this.plugin.settings.defaultProjectName)
					.onChange(async (value) => {
						try{
							//this.plugin.cacheOperation.saveProjectsToCache()
							const newProjectId = this.plugin.cacheOperation.getProjectIdByNameFromCache(value)
							if(!newProjectId){
								new Notice(`This project seems to not exist.`)
								return
							}
						}catch(error){
							new Notice(`Invalid project name `)
							return
						}
						this.plugin.settings.defaultProjectName = value;
						this.plugin.saveSettings()
						new Notice(`The default project has been modified successfully.`)

					})

		);
		*/

		new Setting(containerEl)
			.setName('Default Project')
			.setDesc('New tasks are automatically synced to the default project. You can modify the project here.')
			.addDropdown(component => 
				component
						.addOption(this.plugin.settings.defaultProjectId,this.plugin.settings.defaultProjectName)
						.addOptions(myProjectsOptions)
						.onChange((value)=>{
							this.plugin.settings.defaultProjectId = value
							this.plugin.settings.defaultProjectName = this.plugin.cacheOperation.getProjectNameByIdFromCache(value)
							this.plugin.saveSettings()
							
							
						})
						
				)

		new Setting(containerEl)
			.setName('Section Tag Prefix')
			.setDesc('Provides the option to set a prefix for identifying tags that should move a task to a project section (e.g. "sec-"). Can be empty.')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.sectionPrefix)
					.onChange(async (value) => {
						this.plugin.settings.sectionPrefix = value;
						this.plugin.settings.apiInitialized = false;
					//
				})

		)
		
		new Setting(containerEl)
			.setName('Full Vault Sync')
			.setDesc('By default, only tasks marked with #todoist are synchronized. If this option is turned on, all tasks in the vault will be synchronized.')
			.addToggle(component => 
				component
						.setValue(this.plugin.settings.enableFullVaultSync)
						.onChange((value)=>{
							this.plugin.settings.enableFullVaultSync = value
							this.plugin.saveSettings()
							new Notice("Full vault sync is enabled.")							
						})
						
				)						



		new Setting(containerEl)
		.setName('Manual Sync')
		.setDesc('Manually perform a synchronization task.')
		.addButton(button => button
			.setButtonText('Sync')
			.onClick(async () => {
				// Add code here to handle exporting Todoist data
				if(!this.plugin.settings.apiInitialized){
					new Notice(`Please set the todoist api first`)
					return
				}
				try{
					await this.plugin.scheduledSynchronization()
					this.plugin.syncLock = false
					new Notice(`Sync completed..`)
				}catch(error){
					new Notice(`An error occurred while syncing.:${error}`)
					this.plugin.syncLock = false
				}

			})
		);				



		new Setting(containerEl)
		.setName('Check Database')
		.setDesc('Check for possible issues: sync error, file renaming not updated, or missed tasks not synchronized.')
		.addButton(button => button
			.setButtonText('Check Database')
			.onClick(async () => {
				// Add code here to handle exporting Todoist data
				if(!this.plugin.settings.apiInitialized){
					new Notice(`Please set the todoist api first`)
					return
				}

				//reinstall plugin



				//check file metadata
				console.log('checking file metadata')
				await this.plugin.cacheOperation.checkFileMetadata()
				this.plugin.saveSettings()
				const metadatas = await this.plugin.cacheOperation.getFileMetadatas()
				// check default project task amounts
				try{
					const projectId = this.plugin.settings.defaultProjectId
					let options = {}
					options.projectId = projectId
					const tasks = await this.plugin.todoistRestAPI.GetActiveTasks(options)
					let length = tasks.length
					if(length >= 300){
						new Notice(`The number of tasks in the default project exceeds 300, reaching the upper limit. It is not possible to add more tasks. Please modify the default project.`)
					}
					//console.log(tasks)

				}catch(error){
					console.error(`An error occurred while get tasks from todoist: ${error.message}`);
				}

				if (!await this.plugin.checkAndHandleSyncLock()) return;



				console.log('checking deleted tasks')
				//check empty task				
				for (const key in metadatas) {
					const value = metadatas[key];
					//console.log(value)
					for(const taskId of value.todoistTasks) {
						
						//console.log(`${taskId}`)
						let taskObject

						try{
							taskObject = await this.plugin.cacheOperation.loadTaskFromCacheyID(taskId)
						}catch(error){
							console.error(`An error occurred while loading task cache: ${error.message}`);
						}

						if(!taskObject){
							console.log(`The task data of the ${taskId} is empty.`)
							//get from todoist 
							try {
								taskObject = await this.plugin.todoistRestAPI.getTaskById(taskId);
							  } catch (error) {
								if (error.message.includes('404')) {
								  // 处理404错误
								  console.log(`Task ${taskId} seems to not exist.`);
								  await this.plugin.cacheOperation.deleteTaskIdFromMetadata(key,taskId)
								  continue
								} else {
								  // 处理其他错误
								  console.error(error);
								  continue
								}
							  }

						}									
					};

				  }
				  this.plugin.saveSettings()


				console.log('checking renamed files')
				try{
					//check renamed files
					for (const key in metadatas) {
						const value = metadatas[key];
						//console.log(value)
						const newDescription = this.plugin.taskParser.getObsidianUrlFromFilepath(key)
						for(const taskId of value.todoistTasks) {
							
							//console.log(`${taskId}`)
							let taskObject
							try{
								taskObject = await this.plugin.cacheOperation.loadTaskFromCacheyID(taskId)
							}catch(error){
								console.error(`An error occurred while loading task ${taskId} from cache: ${error.message}`);
								console.log(taskObject)
							}
							if(!taskObject){
								console.log(`Task ${taskId} seems to not exist.`)
								continue
							}
							if(!taskObject?.description){
								console.log(`The description of the task ${taskId} is empty.`)
							}							
							const oldDescription = taskObject?.description ?? '';
							if(newDescription != oldDescription){
								console.log('Preparing to update description.')
								console.log(oldDescription)
								console.log(newDescription)
								try{
									//await this.plugin.todoistSync.updateTaskDescription(key)
								}catch(error){
									console.error(`An error occurred while updating task discription: ${error.message}`);
								}

							}
			
						};

					  }

					//check empty file metadata
					
					//check calendar format


					
					//check omitted tasks
					console.log('checking unsynced tasks')
					const files = this.app.vault.getFiles()
					files.forEach(async (v, i) => {
						if(v.extension == "md"){
							try{
								//console.log(`Scanning file ${v.path}`)
								await this.plugin.fileOperation.addTodoistLinkToFile(v.path)
								if(this.plugin.settings.enableFullVaultSync){
									await this.plugin.fileOperation.addTodoistTagToFile(v.path)
								}

								
							}catch(error){
								console.error(`An error occurred while check new tasks in the file: ${v.path}, ${error.message}`);
								
							}

						}
					});
					this.plugin.syncLock = false
					new Notice(`All files have been scanned.`)
				}catch(error){
					console.error(`An error occurred while scanning the vault.:${error}`)
					this.plugin.syncLock = false
				}

			})
		);

		new Setting(containerEl)
			.setName('Debug Mode')
			.setDesc('After enabling this option, all log information will be output to the console, which can help check for errors.')
			.addToggle(component => 
				component
						.setValue(this.plugin.settings.debugMode)
						.onChange((value)=>{
							this.plugin.settings.debugMode = value
							this.plugin.saveSettings()						
						})
						
				)

		new Setting(containerEl)
			.setName('Backup Todoist Data')
			.setDesc('Click to backup Todoist data, The backed-up files will be stored in the root directory of the Obsidian vault.')
			.addButton(button => button
				.setButtonText('Backup')
				.onClick(() => {
					// Add code here to handle exporting Todoist data
					if(!this.plugin.settings.apiInitialized){
						new Notice(`Please set the todoist api first`)
						return
					}
					this.plugin.todoistSync.backupTodoistAllResources()
				})
			);
	}
}

