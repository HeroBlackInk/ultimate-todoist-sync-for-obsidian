import { App, Notice, Plugin, PluginSettingTab, Setting ,ExtraButtonComponent} from 'obsidian';


export interface MyPluginSettings {
    initialized:boolean;
	//mySetting: string;
	//todoistTasksFilePath: string;
	todoistAPIToken: string; // replace with correct type
	defaultProject: string;
	todoistTasksData:any;
}


export const DEFAULT_SETTINGS: MyPluginSettings = {
	initialized: false,
	defaultProject:"Inbox",
	todoistTasksData:{},
	//mySetting: 'default',
	//todoistTasksFilePath: 'todoistTasks.json'

}





export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: Plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Settings for Ultimate Todoist Sync for Obsidian.' });

		new Setting(containerEl)
			.setName('Todoist API')
			.setDesc('As mentioned in the title')
			.addText((text) =>
				text
					.setPlaceholder('Enter your API')
					.setValue(this.plugin.settings.todoistAPIToken)
					.onChange(async (value) => {
						this.plugin.settings.todoistAPIToken = value;
						this.plugin.modifyTodoistAPI(value)
					})

			);

		new Setting(containerEl)
			.setName('The default project for new tasks')
			.setDesc('New tasks are automatically synced to the Inbox. You can modify the project here.')
			.addText((text) =>
				text
					.setPlaceholder('Enter default project name:')
					.setValue(this.plugin.settings.defaultProject)
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
						this.plugin.settings.defaultProject = value;
						this.plugin.saveSettings()
						new Notice(`The default project has been modified successfully.`)

					})

		);




		new Setting(containerEl)
		.setName('Sync Projects')
		.setDesc('When there are changes in Todoist projects, please click this button to manually synchronize.')
		.addButton(button => button
			.setButtonText('Sync projects')
			.onClick(() => {
				// Add code here to handle exporting Todoist data
				try{
					this.plugin.cacheOperation.saveProjectsToCache()
					this.plugin.saveSettings()
					new Notice(`projects synchronization successful`)
				}catch(error){
					new Notice(`projects synchronization failed:${error}`)
				}

			})
		);

		new Setting(containerEl)
			.setName('Backup Todoist Data')
			.setDesc('Click to backup Todoist data, backup data is saved in the path ".obsidian/plugins/ultimate-todoist-sync-for-obsidian/userData"')
			.addButton(button => button
				.setButtonText('Backup')
				.onClick(() => {
					// Add code here to handle exporting Todoist data
					this.plugin.todoistSync.backupTodoistAllResources()
				})
			);
	}
}

