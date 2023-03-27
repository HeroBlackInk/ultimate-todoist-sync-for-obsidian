import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';


export interface MyPluginSettings {
    initialized:boolean;
	//mySetting: string;
	//todoistTasksFilePath: string;
	todoistAPIToken: string; // replace with correct type
	todoistTasksData:any;
}


export const DEFAULT_SETTINGS: MyPluginSettings = {
	initialized: false,
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

