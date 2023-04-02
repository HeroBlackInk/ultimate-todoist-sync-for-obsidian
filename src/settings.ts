import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';


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
	todoistTasksData:any;
	fileMetadata:any;
}


export const DEFAULT_SETTINGS: UltimateTodoistSyncSettings = {
	initialized: false,
	apiInitialized:false,
	defaultProjectName:"Inbox",
	todoistTasksData:{},
	fileMetadata:{},
	//mySetting: 'default',
	//todoistTasksFilePath: 'todoistTasks.json'

}





export class UltimateTodoistSyncSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: Plugin) {
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
			.setName('Default project')
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
		.setName('Sync Projects')
		.setDesc('When there are changes in Todoist projects, please click this button to manually synchronize.')
		.addButton(button => button
			.setButtonText('Sync projects')
			.onClick(() => {
				// Add code here to handle exporting Todoist data
				if(!this.plugin.settings.apiInitialized){
					new Notice(`Please set the todoist api first`)
					return
				}
				try{
					this.plugin.cacheOperation.saveProjectsToCache()
					this.plugin.saveSettings()
					this.display()
					new Notice(`projects synchronization successful`)
				}catch(error){
					new Notice(`projects synchronization failed:${error}`)
				}

			})
		);

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

