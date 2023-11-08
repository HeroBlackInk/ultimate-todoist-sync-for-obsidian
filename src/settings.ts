import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";
import {appHasDailyNotesPluginLoaded} from "obsidian-daily-notes-interface";

interface MyProject {
	id: string;
	name: string;
  }

export enum pullTargetMode {
	DailyNote = "daily", Template = "template"
}

export enum pullTaskNotesMode {
    projectNote, taskNote
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
	debugMode: boolean;
	removeTagsWithText: boolean;
	removeHashTagsExceptions: string[];
	syncTagsFromTodoist: boolean;
	pullFromProject: string;
	pullFromProjectId: string;
	pullTargetMode: pullTargetMode;
	pullTemplateUseFolder: string;
	pullTemplateUsePath: string;
	pullDailyNoteAppendMode: boolean;
	pullDailyNoteInsertAfterText: string;
    pullTemplateUseForProjects: pullTaskNotesMode;
    pullTemplateTaskNotesFormat: string;
    pullDailyNoteAppendMode: boolean;
    pullDailyNoteInsertAfterText: string;
}


export const DEFAULT_SETTINGS: UltimateTodoistSyncSettings = {
    defaultProjectId: "",
    todoistAPIToken: "",
    initialized: false,
    apiInitialized: false,
    defaultProjectName: "Inbox",
    automaticSynchronizationInterval: 300, //default aync interval 300s
    todoistTasksData: {"projects": [], "tasks": [], "events": []},
    fileMetadata: {},
    enableFullVaultSync: false,
    statistics: {},
    debugMode: false,
    //mySetting: 'default',
    //todoistTasksFilePath: 'todoistTasks.json'
	removeTagsWithText: true,
	removeHashTagsExceptions: ["todoist"],
	syncTagsFromTodoist: false,
    pullFromProject: "Inbox",
    pullFromProjectId: "",
    pullTargetMode: pullTargetMode.Template,
    pullTemplateUseFolder: "",
    pullTemplateUsePath: "",
    pullTemplateUseForProjects: pullTaskNotesMode.taskNote,
    pullTemplateTaskNotesFormat: "{{date|YYYY-MM-DD}}_{{title}}",
    pullDailyNoteAppendMode: true,
    pullDailyNoteInsertAfterText: ""
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
                    .addOptions(myProjectsOptions)
                    .setValue(this.plugin.settings.defaultProjectId)
                    .onChange((value) => {
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
			.setName('Remove tags with text')
			.setDesc('If enabled, this opton will remove tags with text from the task description in todoist. Otherwise it only removes the hashtag sign. Very helpful, if you use tags in your text.')
			.addToggle(component =>
				component
					.setValue(this.plugin.settings.removeTagsWithText)
					.onChange((value) => {
						this.plugin.settings.removeTagsWithText = value
						this.plugin.saveSettings()
						this.display()
					})
			)

		if(!this.plugin.settings.removeTagsWithText) {
			new Setting(containerEl)
				.setName('Exceptions')
				.setDesc('Enter tags, which should always be removed, separated by comma. Leave the hashtag # sign. Default is, that todoist will be removed. If you remove this, it will not be removed anymore.')
				.addText((text) =>
					text
						.setValue(this.plugin.settings.removeHashTagsExceptions.join(','))
						.onChange(async (value) => {
							this.plugin.settings.removeHashTagsExceptions = value.split(',').map(v => v.trim());
							this.plugin.saveSettings()
						})
				)
		}

		new Setting(containerEl)
			.setName('Sync tags from Todoist')
			.setDesc('BETA: If enabled, this option will sync tags from todoist to obsidian. Otherwise it ignores them as before. Because this can lead to undefined behaviour when the same task was changed in todoist and obsidian, you should not use it if you want to use both tools at the same time.')
			.addToggle(component =>
				component
					.setValue(this.plugin.settings.syncTagsFromTodoist)
					.onChange((value) => {
						this.plugin.settings.syncTagsFromTodoist = value
						this.plugin.saveSettings()
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

        containerEl.createEl('h2', {text: 'Pull from Todoist Settings'});
        new Setting(containerEl)
            .setName("Pull from project")
            .setDesc("Pull tasks only from the given project.")
            .addDropdown(component => {
                component
					.addOption("-1","All projects")
                    .addOptions(myProjectsOptions)
                    .setValue(this.plugin.settings.pullFromProjectId)
                    .onChange((value) => {
                        this.plugin.settings.pullFromProjectId = value
                        this.plugin.settings.pullFromProject = this.plugin.cacheOperation.getProjectNameByIdFromCache(value)
                        this.plugin.saveSettings()
                        this.display()
                    })
            })

        const desc = document.createDocumentFragment();
		desc.append('If daily Note core plugin is enabled and is selected, all new tasks will be created in a daily note. This needs the ',
			desc.createEl("a", {
				href: "https://help.obsidian.md/Plugins/Daily+notes",
				text: "daily notes core plugin",
			}),
			desc.createEl("br"),
			'In template note, it uses a template to store the tasks.'
		)


		new Setting(containerEl)
            .setName('Select Mode')
            .setDesc(desc)
            .addDropdown(component => {
				if(appHasDailyNotesPluginLoaded()){
					component
						.addOption(pullTargetMode.DailyNote.valueOf(), "Daily note")
				}
                component
                    .addOption(pullTargetMode.Template.valueOf(), 'Template Note')
                    .setValue(this.plugin.settings.pullTargetMode.valueOf())
                    .onChange((value) => {
                        this.plugin.settings.pullTargetMode = value == 'daily' ? pullTargetMode.DailyNote : pullTargetMode.Template
                        this.plugin.saveSettings()
                        this.display()
                    })

            })

        if (this.plugin.settings.pullTargetMode == pullTargetMode.Template) {
            new Setting(containerEl)
                .setName('Path to folder')
                .setDesc('Create new note in the given folder.')
                .addText((text) =>
                    text
                        .setPlaceholder('Enter folder path')
                        .setValue(this.plugin.settings.pullTemplateUseFolder)
                        .onChange(async (value) => {
                            this.plugin.settings.pullTemplateUseFolder = value;
                            this.plugin.saveSettings()
                        })
                )

            new Setting(containerEl)
                .setName('Path to template')
                .setDesc('Use the given path as template to create new note.')
                .addText((text) => {
                    text
                        .setPlaceholder('Enter path')
                        .setValue(this.plugin.settings.pullTemplateUsePath)
                        .onChange(async (value) => {
                            this.plugin.settings.pullTemplateUsePath = value;
                            this.plugin.saveSettings()
                        })
                })

            new Setting(containerEl)
                .setName("Create one note for each project")
                .setDesc("So all tasks from the same project will be in the same note, when created in Todoist. The note will be named the same as the projectname. \nOtherwise each task gets its own note.\n(Disabled, because note per task is not yet implemented.)")
                .addToggle(component => {
                    component
                        .setValue(this.plugin.settings.pullTemplateUseForProjects == pullTaskNotesMode.projectNote)
                        .onChange((value) => {
                            this.plugin.settings.pullTemplateUseForProjects = value ? pullTaskNotesMode.projectNote : pullTaskNotesMode.taskNote
                            this.plugin.saveSettings()
                            this.display()
                        })
                })
            if (this.plugin.settings.pullTemplateUseForProjects != pullTaskNotesMode.projectNote) {
				const desc = document.createDocumentFragment();
				desc.append('Use the given format to create new notes for tasks. ',
					desc.createEl("a", {
						href: "https://momentjs.com/docs/#/displaying/format/",
						text: "moment.js",
					}),
					' is used to format the date. Available variables are: {{date}},{{date|format}},{{title}},{{TITLE}}'
				)
                new Setting(containerEl)
                    .setName('Task notes format')
					.setDesc(desc)
                    .addText((text) => {
                        text
                            .setPlaceholder(this.plugin.settings.pullTemplateTaskNotesFormat)
                            .setValue(this.plugin.settings.pullTemplateTaskNotesFormat)
                            .onChange(async (value) => {
                                this.plugin.settings.pullTemplateTaskNotesFormat = value;
                                this.plugin.saveSettings()
                            })
                    })
            }
        }
		new Setting(containerEl)
			.setName('Append Mode')
			.setDesc('Append tasks at the bottom of the note.')
			.addToggle(component => {
				component
					.setValue(this.plugin.settings.pullDailyNoteAppendMode)
					.onChange((value) => {
						this.plugin.settings.pullDailyNoteAppendMode = value
						this.plugin.saveSettings()
						this.display()
					})
			})
		if (!this.plugin.settings.pullDailyNoteAppendMode) {
			new Setting(containerEl)
				.setName('Insert After')
				.setDesc('Insert tasks after given text in note. If not text can be found, it falls back to append mode.')
				.addText((text) => {
					text
						.setPlaceholder('Enter text')
						.setValue(this.plugin.settings.pullDailyNoteInsertAfterText)
						.onChange(async (value) => {
							this.plugin.settings.pullDailyNoteInsertAfterText = value;
							this.plugin.saveSettings()
						})
				})
		}
    }
}

