import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';


export interface MyPluginSettings {
    private initialized:boolean;
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
						await this.plugin.saveSettings()
					})
			);
	}
}

