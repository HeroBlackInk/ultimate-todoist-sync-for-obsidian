# Ultimate Todoist Sync for Obsidian

It should be the best Obsidian plugin for synchronizing Todoist tasks so far.

## Demonstration

### Demo Usage
![Alt Text](/attachment/demo.gif)

### Settings page
<img src="/attachment/settings.png" width="500">



## Features 

### 
|                         | Sync from Obsidian to Todoist | Sync from Todoist to Obsidian | Description |
|-------------------------|-------------------------------|-------------------------------|-------------|
| Add task                | ✅                            | 🔜                           |             |
| Delete task             | ✅                            | 🔜                           |             |
| Modify task content     | ✅                            | ✅                           |             |
| Modify task due date    | ✅                            | ✅                           |             |
| Modify task description | 🔜                            | 🔜                           |             |
| Modify task labels/tags | ✅                            | 🔜                           |             |
| Mark task as completed  | ✅                            | ✅                           |             |
| Mark task as uncompleted| ✅                            | ✅                           |             |
| Modify project          | 🔜                            | 🔜                           |             |
| Modify section          | 🔜                            | 🔜                           |             |
| Modify priority         | ✅                            | 🔜                           |  Currently, task priority only support one-way synchronization from Todoist to Obsidian.           |
| Add reminder            | 🔜                            | 🔜                           |             |
| Move tasks between files| 🔜                            | 🔜                           |             |
| Added-at date           | 🔜                            | 🔜                           |             |
| Completed-at date       | 🔜                            | 🔜                           |             |
| Task notes              | 🔜                            | ✅                           |   Currently, task notes/comments only support one-way synchronization from Todoist to Obsidian.          |






## Installation

1. Download the latest release of the plugin from the [Releases](https://github.com/HeroBlackInk/ultimate-todoist-sync-for-obsidian/releases) page.
2. Extract the downloaded zip file and copy the entire folder to your Obsidian plugins directory.
3. Enable the plugin in the Obsidian settings.

## Configuration

1. In the Obsidian settings, click on the "Plugins" tab and then click the gear icon next to the "Ultimate Todoist Sync for Obsidian" plugin.
2. Enter the Todoist API..


## Settings
1. Automatic synchronization interval time
The time interval for automatic synchronization is set to 300 seconds by default, which means it runs every 5 minutes. You can modify it yourself.
2. Default project
New tasks will be added to the default project, and you can change the default project in the settings. 
3. Full vault sync
By enabling this option, the plugin will automatically add `#todoist` to all tasks, which will modify all files in the vault.

## Usage


### Task format


| Syntax | Description | Example |
| --- | --- | --- |
|#todoist|Tasks marked with #todoist will be added to Todoist, while tasks without the **#todoist** tag will not be processed.If you have enabled Full vault sync in the settings, `#todoist` will be added automatically.| `- [ ] task #todoist`|
| 📅YYYY-MM-DD | The date format is 📅YYYY-MM-DD, indicating the due date of a task. | `- [ ] task content 📅2025-02-05 #todoist`   <br>Supports the following calendar emojis.📅📆🗓🗓️|
| #projectTag | New tasks will be added to the default project(For example,  inbox .), and you can change the default project in the settings or use a tag with the same name to specify a particular project. | `- [ ] taskA #todoist` will be added to inbox.<br>`- [ ]taskB #tag #testProject #todoist` will be added to testProject.|
| #tag | Note that all tags without a project of the same name are treated as normal tags | `- [ ] task #tagA #tagB #tagC #todoist` |
|   `!!<number>` | The priority of the task (a number between 1 and 4, 4 for very urgent and 1 for natural).<br>**Note**: Keep in mind that very urgent is the priority 1 on clients. So, the priority 1 in the client corresponds to the number 4 here (Because that's how the official API of Todoist is designed.). | `- [ ] task !!4 #todoist` |

###  Set a default project for each file separately

The default project in the setting applies to all files. You can set a separate default project for each file using command. 

<img src="/attachment/command-set-default-project-for-file.png" width="500">
<img src="/attachment/default-project-for-file-modal.png" width="500">

You can see the current file's default project in the status bar at the bottom right corner.
<img src="/attachment/statusBar.png" width="500">


### Syncing Tasks

For the automatic synchronization function that has been completed, the plugin will automatically detect it in edit mode. However, some plugins, such as Kanban, may modify the view and cause automatic synchronization to fail, requiring manual clicking of the Sync Button.
 


## Disclaimer

This plugin is for learning purposes only. The author makes no representations or warranties of any kind, express or implied, about the accuracy, completeness, or usefulness of this plugin and shall not be liable for any losses or damages resulting from the use of this plugin.

The author shall not be responsible for any loss or damage, including but not limited to data loss, system crashes, computer damage, or any other form of loss arising from software problems or errors. Users assume all risks and are solely responsible for any consequences resulting from the use of this product.

By using this plugin, you agree to be bound by all the terms of this disclaimer. If you have any questions, please contact the author.

## Contributing

Contributions are welcome! If you'd like to contribute to the plugin, please read our [contributing guidelines](CONTRIBUTING.md) and submit a pull request.

## License

This plugin is released under the [GNU GPLv3 License](/LICENSE.md).

