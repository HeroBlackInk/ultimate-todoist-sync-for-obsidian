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
}


export const DEFAULT_SETTINGS: UltimateTodoistSyncSettings = {
	initialized: false,
	apiInitialized:false,
	defaultProjectName:"Inbox",
	automaticSynchronizationInterval: 300, //default aync interval 300s
	todoistTasksData:{"projects":[],"tasks":[],"events":[]},
	fileMetadata:{},
	enableFullVaultSync:false,
	statistics:{},
	debugMode:false,
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
							await this.plugin.checkTodoistAPI()
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
					throw new Error('Please set the todoist api'); // 抛出异常，中止后续代码执行
				}


				//backup settings and todoist data first
				try{
					await this.plugin.syncFromObsidianToTodoist?.backupTodoistAllResources()
					await this.plugin.syncFromObsidianToTodoist?.backupLocalSettings()
				}catch{
					new Notice('The database backup failed, and the database check task cannot be performed.')
   					throw new Error('Backup failed'); // 抛出异常，中止后续代码执行
				}


				//update todoist resources
				try{
					await this.plugin.todoistSyncAPI.syncAllResources()
				}catch(error){
					console.error(error);
					new Notice('Failed to fetch all resources due to network error.')
					throw new Error('Failed to fetch all resources due to network error');
				}

				if (!await this.plugin.checkAndHandleSyncLock()) return;

				//remove old settings
				this.plugin.settings.todoistTasksData.tasks = []
				this.plugin.settings.fileMetadata = {}
				this.plugin.saveSettings()

				//rebuild the data.json
				//if plugin reinstalled, task metadata in data.json may be empty
				// Search the entire directory.
                // rebuild local task cache
				console.log('Preparing to rebuild task cache')

				const allResources =  this.plugin.todoistSyncAPI?.getAllResources()
				console.log(allResources)


				// in the uncompletedItems, id is the task_id, however, in the completed items, task_id is the id
				const allUncompletedTasks = allResources.items
				const uniqueUncompletedItems = new Set(allUncompletedTasks.map(item => item.id));
				console.log("Number of unique uncompleted items:", uniqueUncompletedItems.size);

				//get all active tasks with restful api
				const allActiveTasks = await this.plugin.todoistRestAPI?.GetActiveTasks()
				console.log(allActiveTasks)
				console.log("Number of active tasks:", allActiveTasks.size);


				const allCompletedTasks2 = await this.plugin.todoistSyncAPI?.getAllCompletedTasks()
				console.log(allCompletedTasks2)
				let total_count_of_todoist_tasks = 0
				let unmatched_todoist_tasks = 0



				const files = this.app.vault.getFiles()
				for (const v of files) {
					if(v.extension == "md"){
						let count_of_todoist_tasks_in_the_file = 0
						try{
							//console.log(`Scanning file ${v.path}`)
							//find all the todoist id in current file
							let file = this.app.vault.getAbstractFileByPath(v.path)
							let filepath = v.path
							let currentFileValue = await this.app.vault.read(file)
							const content = currentFileValue
	

							//rebuild fileMetaData
							let newFrontMatter = {}
							//frontMatteer


							
							const lines = content.split('\n')

							for (let i = 0; i < lines.length; i++) {
								const line = lines[i]
								if (this.plugin.taskParser?.hasTodoistId(line) && this.plugin.taskParser?.hasTodoistLink(line)) {

									total_count_of_todoist_tasks  = total_count_of_todoist_tasks + 1
									count_of_todoist_tasks_in_the_file = count_of_todoist_tasks_in_the_file +1

									// get taskId from line
									let taskId = await this.plugin.taskParser.getTodoistIdFromLineText(line)
									console.log(`taskId: ${taskId}`)
									if(!taskId){
										continue
									}

									//get task from todoist resources
									let taskObject = allUncompletedTasks.find(task => task["id"] === taskId) 
													|| allCompletedTasks2.find(task => task["id"] === taskId) 
													|| allActiveTasks.find(task => task["id"] === taskId) 
													|| null;


									//我在测试的时候，因为混用了我的todoist测试帐户 api 和 日常使用的帐户 api，导致 obsidian vault 中出现了不同todoist帐户的 task 链接

									if(!taskObject){
										let obsidianUrl = this.plugin.taskParser.getObsidianUrlFromFilepath(filepath)
										console.error(`Task ${taskId} in the ${filepath}'s was not existed in current todoist account.\n ${line} \n ${obsidianUrl}`)
										unmatched_todoist_tasks += 1
										continue
									}
									//console.log(`tashObject ${taskObject}`)
									

									
									taskObject.path = filepath
									this.plugin.cacheOperation?.appendTaskToCache(taskObject)
									console.log(`Task ${taskId} in the ${filepath}'s metadata was rebuilded`)


									newFrontMatter.todoistCount = (newFrontMatter.todoistCount ?? 0) + 1;
									
									// 记录 taskID
									newFrontMatter.todoistTasks = [...(newFrontMatter.todoistTasks || []), taskId];
						
									

									await this.plugin.cacheOperation?.updateFileMetadata(filepath,newFrontMatter)
								}


									
									
							}
							//checnk if todoist_link existed in cache
							//if not save task to the cache
							if(count_of_todoist_tasks_in_the_file > 0){
								console.log(`There are ${count_of_todoist_tasks_in_the_file} todoist tasks in ${filepath}.`)
							}
							
							
						}catch(error){
							let obsidianUrl = this.plugin.taskParser.getObsidianUrlFromFilepath(v.path)
							console.error(`An error occurred while rebuild data.json file: ${v.path}, ${error.message}! \n ${obsidianUrl}`);
							
						}

					}
				}
				new Notice(`There are ${unmatched_todoist_tasks} unmatched todoist tasks in obsidian vaults.`)
				new Notice(`There are ${total_count_of_todoist_tasks} todoist tasks in obsidian vaults.`)


				console.log(`There are ${unmatched_todoist_tasks} unmatched todoist tasks in obsidian vaults.`)
				console.log(`There are ${total_count_of_todoist_tasks} todoist tasks in obsidian vaults.`)
				console.log(`There are ${this.plugin.settings.todoistTasksData.tasks.length} tasks in cache.`)

				this.plugin.saveSettings()


				//check file metadata
				
				console.log('checking file metadata')
				await this.plugin.cacheOperation.checkFileMetadata()
				this.plugin.saveSettings()
				const metadatas = await this.plugin.cacheOperation.getFileMetadatas()


				// check default project task amounts
				/*
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
				*/

				
				

				/*
				console.log('checking deleted tasks')
				//check empty task				
				for (const key in metadatas) {
					const value = metadatas[key];
					//console.log(value)
					for(const taskId of value.todoistTasks) {
						
						//console.log(`${taskId}`)
						let taskObject

						try{
							taskObject = await this.plugin.cacheOperation.loadTaskFromCacheByID(taskId)
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
				*/

				
				console.log('checking renamed files')
				try{

					/*
					//check renamed files
					for (const key in metadatas) {
						const value = metadatas[key];
						//console.log(value)
						const newDescription = this.plugin.taskParser.getObsidianUrlFromFilepath(key)
						for(const taskId of value.todoistTasks) {
							
							//console.log(`${taskId}`)
							let taskObject
							try{
								taskObject = await this.plugin.cacheOperation.loadTaskFromCacheByID(taskId)
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
								await this.plugin.fileOperation?.addTodoistLinkToFile(v.path)
								if(this.plugin.settings.enableFullVaultSync){
									await this.plugin.fileOperation?.addTodoistTagToFile(v.path)
								}

								
							}catch(error){
								console.error(`An error occurred while check new tasks in the file: ${v.path}, ${error.message}`);
								
							}

						}
					});

					*/



					this.plugin.syncLock = false
					new Notice(`All files have been scanned.`)
				}catch(error){
					console.error(`An error occurred while scanning the vault.:${error}`);
					this.plugin.syncLock = false;
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
			.setName('Backup local settings and todoist Data')
			.setDesc('Backup local settings and create a  todoist backup(all your active projects, tasks, and comments), The backed-up files will be stored in the root directory of the Obsidian vault.')
			.addButton(button => button
				.setButtonText('Backup')
				.onClick(() => {
					// Add code here to handle exporting Todoist data
					if(!this.plugin.settings.apiInitialized){
						new Notice(`Please set the todoist api first`)
						return
					}
					this.plugin.syncFromObsidianToTodoist?.backupTodoistAllResources()
					this.plugin.syncFromObsidianToTodoist?.backupLocalSettings()
				})
			);

    }
}

