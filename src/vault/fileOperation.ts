import { App, Editor, MarkdownView, TFile } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";
import { computeLineRangeEdit } from './editorContentDiff';

export interface VaultTask {
    taskId: string;
    content: string;
    isCompleted: boolean;
    filePath: string;
    lineNumber: number;
    labels: string[];
    dueDate?: string;
    priority?: number;
}

export interface VaultTaskWithoutId {
    content: string;
    isCompleted: boolean;
    filePath: string;
    lineNumber: number;
    labels: string[];
}

export interface TodoistTask {
    taskId: string;
    content: string;
    description?: string;
    checked: boolean;
    dueDate?: string;
    priority: number;
    projectId: string;
    labels: string[];
}

export class FileOperation   {
	app:App;
    plugin: UltimateTodoistSyncForObsidian;


	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
        this.plugin = plugin;

	}

    private requireFile(filepath: string): TFile {
        const file = this.app.vault.getAbstractFileByPath(filepath);
        if (!(file instanceof TFile)) {
            throw new Error(`File not found: ${filepath}`);
        }

        return file;
    }

    /**
     * The markdown view currently showing this file, if any.
     */
    getOpenMarkdownView(filepath: string): MarkdownView | null {
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file?.path === filepath) {
                return view;
            }
        }

        return null;
    }

    /**
     * Read the *current* content of a file, preferring an open editor's buffer
     * over the on-disk copy.
     *
     * Obsidian flushes the editor to disk only after a couple of seconds of idle,
     * so vault.read() returns stale text while the user is typing. Acting on that
     * stale text is destructive: a todoist_id written back into the editor moments
     * ago looks missing, which makes deletedTaskCheck delete the brand-new Todoist
     * task and makes fullTextNewTaskCheck create a duplicate for the same line.
     */
    async readLiveFileContent(filepath: string): Promise<string> {
        const view = this.getOpenMarkdownView(filepath);
        if (view) {
            return view.editor?.getValue() ?? view.data;
        }

        return await this.app.vault.read(this.requireFile(filepath));
    }

    /**
     * Write new content for a file, going through an open editor when there is one.
     *
     * vault.modify() writes to disk behind the editor's back. When the file is open
     * with unsaved changes, Obsidian's next autosave writes the editor buffer over
     * that write — silently dropping a todoist_id we just wrote, which orphans the
     * Todoist task and makes the line look unsynced again on the next scan.
     */
    async writeLiveFileContent(filepath: string, newContent: string): Promise<void> {
        const editor = this.getOpenMarkdownView(filepath)?.editor;
        if (editor) {
            this.applyContentToEditor(editor, newContent);
            return;
        }

        await this.app.vault.modify(this.requireFile(filepath), newContent);
    }

    /**
     * Apply new content to an open editor as a minimal line-range replacement, so
     * the user's cursor, selection and undo history survive a sync write. Sync
     * writes touch one line at a time, so the replaced range is normally one line.
     *
     * The diff itself lives in editorContentDiff.ts and is unit-tested there.
     */
    private applyContentToEditor(editor: Editor, newContent: string): void {
        const edit = computeLineRangeEdit(editor.getValue(), newContent);
        if (!edit) return;

        if (edit.to) {
            editor.replaceRange(edit.text, edit.from, edit.to);
        } else {
            editor.replaceRange(edit.text, edit.from);
        }
    }

	/**
	 * Check if a file path should be excluded from Full Vault Sync.
	 * Excluded: dot-prefix dirs, plugin storage dir, Obsidian templates folder, *.excalidraw.md
	 */
	isFileExcludedFromSync(filepath: string): boolean {
		// Dot-prefix directories (.obsidian/, .trash/, .git/, .stfolder/, etc.)
		if (filepath.startsWith('.')) return true;

		// Plugin storage directory
		const storagePath = this.plugin.storagePathManager?.getBasePath() || 'ultimate-todoist-sync';
		if (filepath.startsWith(storagePath + '/')) return true;

		// Obsidian core templates folder
		try {
			const templatesConfig = (this.app as any).internalPlugins?.getPluginById?.('templates')?.instance?.options?.folder;
			if (templatesConfig && filepath.startsWith(templatesConfig + '/')) return true;
		} catch { /* ignore */ }

		// Templater plugin folder
		try {
			const templaterFolder = (this.app as any).plugins?.getPlugin?.('templater-obsidian')?.settings?.templates_folder;
			if (templaterFolder && filepath.startsWith(templaterFolder + '/')) return true;
		} catch { /* ignore */ }

		// Excalidraw files
		if (filepath.endsWith('.excalidraw.md')) return true;


		// User-configured excluded folders
		for (const folder of this.plugin.settings.excludedFolders) {
			if (filepath.startsWith(folder + '/') || filepath === folder) return true;
		}

		return false;
	}
    /*
    async getFrontMatter(file:TFile): Promise<FrontMatter | null> {
        return new Promise((resolve) => {
          this.app.fileManager.processFrontMatter(file, (frontMatter) => {
            resolve(frontMatter);
          });
        });
    }
    */
    



    /*
    async updateFrontMatter(
    file:TFile,
    updater: (frontMatter: FrontMatter) => void
    ): Promise<void> {
        //this.plugin.debugLog(`prepare to update front matter`)
        this.app.fileManager.processFrontMatter(file, (frontMatter) => {
        if (frontMatter !== null) {
        const updatedFrontMatter = { ...frontMatter } as FrontMatter;
        updater(updatedFrontMatter);
        this.app.fileManager.processFrontMatter(file, (newFrontMatter) => {
            if (newFrontMatter !== null) {
            newFrontMatter.todoistTasks = updatedFrontMatter.todoistTasks;
            newFrontMatter.todoistCount = updatedFrontMatter.todoistCount;
            }
        });
        }
    });
    }
    */


    
          

     // 完成一个任务，将其标记为已完成
    async completeTaskInTheFile(taskId: string) {
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const content = await this.readLiveFileContent(filepath)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
            lines[i] = line.replace('[ ]', '[x]')
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.writeLiveFileContent(filepath, newContent)
        this.plugin.logOperation?.log('FILE_TASK_COMPLETED', `Completed task in file: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }
    }
  
    // uncheck 已完成的任务，
    async uncompleteTaskInTheFile(taskId: string) {
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const content = await this.readLiveFileContent(filepath)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
            lines[i] = line.replace(/- \[(x|X)\]/g, '- [ ]');
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.writeLiveFileContent(filepath, newContent)
        this.plugin.logOperation?.log('FILE_TASK_UNCOMPLETED', `Reopened task in file: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }
    }

    /**
     * Unbind a task from its vault line by removing todoist_id, todoist link, and #todoist tag.
     * The task line remains in the file but is no longer associated with Todoist.
     */
    async unbindTaskInFile(taskId: string): Promise<void> {
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId);
        if (!taskMapping) {
            console.error(`[FileOperation] unbindTaskInFile: Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath;
        const content = await this.readLiveFileContent(filepath);
        const lines = content.split('\n');
        let modified = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes(taskId)) continue;
            let newLine = line;
            // Remove %%[todoist_id:: xxx]%%
            newLine = newLine.replace(/%%\[todoist_id::\s*\S+\]%%/g, '');
            // Remove todoist links: [link](https://todoist.com/...) or [link](https://app.todoist.com/...) or [link](todoist://...)
            newLine = newLine.replace(/\[([^\]]*)\]\(https?:\/\/(?:app\.)?todoist\.com\/[^)]*\)/g, '');
            newLine = newLine.replace(/\[([^\]]*)\]\(todoist:\/\/[^)]*\)/g, '');
            // Remove #todoist tag
            newLine = newLine.replace(/#todoist/g, '');
            // Clean up multiple spaces left behind
            newLine = newLine.replace(/  +/g, ' ');
            // Trim trailing whitespace but preserve leading indentation
            newLine = newLine.replace(/\s+$/, '');
            if (newLine !== line) {
                lines[i] = newLine;
                modified = true;
            }
            break;
        }
        if (modified) {
            const newContent = lines.join('\n');
            await this.writeLiveFileContent(filepath, newContent);
            this.plugin.logOperation?.log('FILE_TASK_UNBOUND', `Unbound task from file: ${taskId}`, filepath, taskId, 'obsidian→todoist');
        }
    }
    //add #todoist at the end of task line, if full vault sync enabled
    async addTodoistTagToFile(filepath: string) {    
        if (this.isFileExcludedFromSync(filepath)) return;
        const content = await this.readLiveFileContent(filepath)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if(!this.plugin.taskParser!.isMarkdownTask(line)){
                //this.plugin.debugLog(line)
                //this.plugin.debugLog("It is not a markdown task.")
                continue;
            }
            //if content is empty
            if(this.plugin.taskParser!.getTaskContentFromLineText(line) == ""){
                //this.plugin.debugLog("Line content is empty")
                continue;
            }
            if (!this.plugin.taskParser!.hasTodoistId(line) && !this.plugin.taskParser!.hasTodoistTag(line)) {
                //this.plugin.debugLog(line)
                //this.plugin.debugLog('prepare to add todoist tag')
                const newLine = this.plugin.taskParser!.addTodoistTag(line);
                //this.plugin.debugLog(newLine)
                lines[i] = newLine
                modified = true
            }
        }
        
        if (modified) {
            this.plugin.debugLog(`New task found in files ${filepath}`)
            const newContent = lines.join('\n')
            //this.plugin.debugLog(newContent)
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.writeLiveFileContent(filepath, newContent)
            this.plugin.logOperation?.log('FILE_TODOIST_TAG_ADDED', `Added todoist tag to file: ${filepath}`, filepath);

        }
    }



    //add todoist at the line
    async addTodoistLinkToFile(filepath: string) {    
        // 获取文件对象并更新内容
        const content = await this.readLiveFileContent(filepath)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (this.plugin.taskParser!.hasTodoistId(line) && this.plugin.taskParser!.hasTodoistTag(line)) {
                if(this.plugin.taskParser!.hasTodoistLink(line)){
                    return
                }
                this.plugin.debugLog(line)
                //this.plugin.debugLog('prepare to add todoist link')
                const taskID = this.plugin.taskParser!.getTodoistIdFromLineText(line)
                const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskID ?? '')
                if (!taskMapping) {
                    console.error(`Task ${taskID} not found in taskFileMapping`);
                    continue;
                }
                await this.plugin.todoistSyncAPI!.GetTaskById(taskID ?? '')
                const todoistLink = this.plugin.settings.useAppURI
                    ? `todoist://task?id=${taskID}`
                    : `https://app.todoist.com/app/task/${taskID}`
                const link = `[link](${todoistLink})`
                const newLine = this.plugin.taskParser!.addTodoistLink(line,link)
                this.plugin.debugLog(newLine)
                lines[i] = newLine
                modified = true
            }else{
                continue
            }
        }
        
        if (modified) {
            const newContent = lines.join('\n')
            //this.plugin.debugLog(newContent)
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.writeLiveFileContent(filepath, newContent)



        }
    }


    // sync updated task content  to file
    async syncUpdatedTaskContentToTheFile(evt:any) {
        const taskId = evt.object_id
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const content = await this.readLiveFileContent(filepath)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
            const oldTaskContent = this.plugin.taskParser!.getTaskContentFromLineText(line)
            const newTaskContent = evt.extra_data.content

            lines[i] = line.replace(oldTaskContent, newTaskContent)
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //this.plugin.debugLog(newContent)
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.writeLiveFileContent(filepath, newContent)
        this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced task content from Todoist: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }
        
    }

    // sync updated task due date  to the file
    async syncUpdatedTaskDueDateToTheFile(evt:any) {
        const taskId = evt.object_id
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const content = await this.readLiveFileContent(filepath)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
            const oldTaskDueDate = this.plugin.taskParser!.getDueDateFromLineText(line) || ""
            const newTaskDueDate = this.plugin.taskParser!.ISOStringToLocalDateString(evt.extra_data.due_date) || ""
            
            //this.plugin.debugLog(`${taskId} duedate is updated`)
            this.plugin.debugLog(oldTaskDueDate)
            this.plugin.debugLog(newTaskDueDate)
            if(oldTaskDueDate === ""){
                //this.plugin.debugLog(this.plugin.taskParser!.insertDueDateBeforeTodoist(line,newTaskDueDate))
                lines[i] = this.plugin.taskParser!.insertDueDateBeforeTodoist(line,newTaskDueDate)
                modified = true

            }
            else if(newTaskDueDate === ""){
                //remove 日期from text
                const regexRemoveDate = /(🗓️|📅|📆|🗓)\s?\d{4}-\d{2}-\d{2}/; //匹配日期🗓️2023-03-07"
                lines[i] = line.replace(regexRemoveDate,"")
                modified = true
            }
            else{

                lines[i] = line.replace(oldTaskDueDate, newTaskDueDate)
                modified = true
            }
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //this.plugin.debugLog(newContent)
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.writeLiveFileContent(filepath, newContent)
        this.plugin.logOperation?.log('FILE_TASK_DUEDATE_SYNCED', `Synced task due date from Todoist: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }
        
    }


    // sync new task note to file
    async syncAddedTaskNoteToTheFile(evt:any) {


        const taskId = evt.parent_item_id
        const note = evt.extra_data.content
        const datetime = this.plugin.taskParser!.ISOStringToLocalDatetimeString(evt.event_date)
        // 获取任务文件路径
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId)
        if (!taskMapping) {
            console.error(`Task ${taskId} not found in taskFileMapping`);
            return;
        }
        const filepath = taskMapping.filePath
    
        // 获取文件对象并更新内容
        const content = await this.readLiveFileContent(filepath)
    
        const lines = content.split('\n')
        let modified = false
    
        for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
            const indent = '\t'.repeat(line.length - line.trimStart().length + 1);
            const noteLine = `${indent}- ${datetime} ${note}`;
            lines.splice(i + 1, 0, noteLine);
            modified = true
            break
        }
        }
    
        if (modified) {
        const newContent = lines.join('\n')
        //this.plugin.debugLog(newContent)
        await this.plugin.backupOperation?.backupFile(filepath);
        await this.writeLiveFileContent(filepath, newContent)
        this.plugin.logOperation?.log('FILE_TASK_NOTE_ADDED', `Synced task note from Todoist: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }
        
    }


    async syncTaskContentToFile(taskId: string, newContent: string): Promise<boolean> {
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId);
        if (!taskMapping) return false;
        const filepath = taskMapping.filePath;

        const fileContent = await this.readLiveFileContent(filepath);
        const lines = fileContent.split('\n');
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
                const oldContent = this.plugin.taskParser!.getTaskContentFromLineText(line);
                if (oldContent && oldContent !== newContent) {
                    lines[i] = line.replace(oldContent, newContent);
                    modified = true;
                }
                break;
            }
        }

        if (modified) {
            const newFileContent = lines.join('\n');
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.writeLiveFileContent(filepath, newFileContent);
            this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced content from Todoist: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }
        return modified;
    }

    async syncTaskDueDateToFile(taskId: string, newDueDate: string): Promise<boolean> {
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId);
        if (!taskMapping) return false;
        const filepath = taskMapping.filePath;

        const fileContent = await this.readLiveFileContent(filepath);
        const lines = fileContent.split('\n');
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
                const oldDueDate = this.plugin.taskParser!.getDueDateFromLineText(line) || "";
                const localDueDate = this.plugin.taskParser!.ISOStringToLocalDateString(newDueDate) || "";

                if (oldDueDate === localDueDate) break;

                if (oldDueDate === "" && localDueDate !== "") {
                    lines[i] = this.plugin.taskParser!.insertDueDateBeforeTodoist(line, localDueDate);
                    modified = true;
                } else if (localDueDate === "") {
                    const regexRemoveDate = /(🗓️|📅|📆|🗓)\s?\d{4}-\d{2}-\d{2}/;
                    lines[i] = line.replace(regexRemoveDate, "");
                    modified = true;
                } else {
                    lines[i] = line.replace(oldDueDate, localDueDate);
                    modified = true;
                }
                break;
            }
        }

        if (modified) {
            const newFileContent = lines.join('\n');
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.writeLiveFileContent(filepath, newFileContent);
            this.plugin.logOperation?.log('FILE_TASK_DUEDATE_SYNCED', `Synced due date from Todoist: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }
        return modified;
    }

    private normalizeLabelsForSync(labels: string[] | undefined): string[] {
        if (!labels || labels.length === 0) return [];
        const normalized = labels
            .map(label => (label || '').trim().replace(/^#/, ''))
            .filter(label => label.length > 0);
        return Array.from(new Set(normalized));
    }

    async syncTaskPriorityToFile(taskId: string, newPriority: number): Promise<boolean> {
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId);
        if (!taskMapping) return false;
        const filepath = taskMapping.filePath;

        const fileContent = await this.readLiveFileContent(filepath);
        const lines = fileContent.split('\n');
        let modified = false;

        const numericPriority = Number(newPriority);
        const targetPriority = Number.isFinite(numericPriority) && numericPriority >= 1 && numericPriority <= 4
            ? Math.floor(numericPriority)
            : 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes(taskId) || !this.plugin.taskParser!.hasTodoistTag(line)) continue;

            const currentPriority = this.plugin.taskParser!.getTaskPriority(line);
            if (currentPriority === targetPriority) break;

            const metadataIndex = line.indexOf('%%[todoist_id::');
            const prefix = (metadataIndex >= 0 ? line.slice(0, metadataIndex) : line)
                .replace(/\s!!([1-4])(?=\s|$)/g, '')
                .replace(/ {2,}/g, ' ')
                .trimEnd();
            const suffix = metadataIndex >= 0 ? line.slice(metadataIndex).trimStart() : '';

            const nextPrefix = targetPriority > 1 ? `${prefix} !!${targetPriority}` : prefix;
            lines[i] = suffix ? `${nextPrefix} ${suffix}` : nextPrefix;
            modified = true;
            break;
        }

        if (modified) {
            const newFileContent = lines.join('\n');
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.writeLiveFileContent(filepath, newFileContent);
            this.plugin.logOperation?.log('FILE_TASK_PRIORITY_SYNCED', `Synced priority from Todoist: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }

        return modified;
    }

    async syncTaskLabelsToFile(taskId: string, newLabels: string[]): Promise<boolean> {
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId);
        if (!taskMapping) return false;
        const filepath = taskMapping.filePath;

        const fileContent = await this.readLiveFileContent(filepath);
        const lines = fileContent.split('\n');
        let modified = false;

        const todoistLabels = this.normalizeLabelsForSync(newLabels);
        const desiredLabels = this.plugin.taskParser!.normalizeLabelsForCompare([...todoistLabels, 'todoist']);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.includes(taskId) || !this.plugin.taskParser!.hasTodoistTag(line)) continue;

            const currentLabels = this.plugin.taskParser!.normalizeLabelsForCompare(
                this.plugin.taskParser!.getAllTagsFromLineText(line)
            );
            const isSame = currentLabels.length === desiredLabels.length
                && currentLabels.every((label, idx) => label === desiredLabels[idx]);
            if (isSame) break;

            const metadataIndex = line.indexOf('%%[todoist_id::');
            const prefix = metadataIndex >= 0 ? line.slice(0, metadataIndex) : line;
            const suffix = metadataIndex >= 0 ? line.slice(metadataIndex).trimStart() : '';

            const prefixWithoutTags = prefix
                .replace(/#[\w\u4e00-\u9fa5-]+/g, '')
                .replace(/ {2,}/g, ' ')
                .trimEnd();
            const tagText = desiredLabels.map(label => `#${label}`).join(' ');
            const nextPrefix = tagText ? `${prefixWithoutTags} ${tagText}` : prefixWithoutTags;

            lines[i] = suffix ? `${nextPrefix} ${suffix}` : nextPrefix;
            modified = true;
            break;
        }

        if (modified) {
            const newFileContent = lines.join('\n');
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.writeLiveFileContent(filepath, newFileContent);
            this.plugin.logOperation?.log('FILE_TASK_LABELS_SYNCED', `Synced labels from Todoist: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }

        return modified;
    }

    async syncTaskNoteToFile(taskId: string, noteContent: string, noteDate: string): Promise<boolean> {
        const taskMapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId);
        if (!taskMapping) return false;
        const filepath = taskMapping.filePath;

        const fileContent = await this.readLiveFileContent(filepath);
        const lines = fileContent.split('\n');
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
                const indent = '\t'.repeat(line.length - line.trimStart().length + 1);
                const noteLine = `${indent}- ${noteDate} ${noteContent}`;
                // skip if note already exists in next lines
                if (i + 1 < lines.length && lines[i + 1].includes(noteContent)) break;
                lines.splice(i + 1, 0, noteLine);
                modified = true;
                break;
            }
        }

        if (modified) {
            const newFileContent = lines.join('\n');
            await this.plugin.backupOperation?.backupFile(filepath);
            await this.writeLiveFileContent(filepath, newFileContent);
            this.plugin.logOperation?.log('FILE_TASK_NOTE_ADDED', `Synced note from Todoist: ${taskId}`, filepath, taskId, this.plugin.isSyncingFromTodoist ? 'todoist→obsidian' : 'obsidian→todoist');
        }
        return modified;
    }

    //避免使用该方式，通过view可以获得实时更新的value
    async readContentFromFilePath(filepath:string){
        try {
            const file = this.requireFile(filepath);
            const content = await this.app.vault.read(file);
            return content
        } catch (error) {
            console.error(`Error loading content from ${filepath}: ${error}`);
            return false;
        }
    }


    //search todoist_id by content
    async searchTodoistIdFromFilePath(filepath: string, searchTerm: string): Promise<string | null> {
        const fileContent = await this.readLiveFileContent(filepath)
        const fileLines = fileContent.split('\n');
        let todoistId: string | null = null;
    
        for (let i = 0; i < fileLines.length; i++) {
        const line = fileLines[i];
    
        if (line.includes(searchTerm)) {
            const regexResult = /\[todoist_id::\s*(\w+)\]/.exec(line);
    
            if (regexResult) {
            todoistId = regexResult[1];
            }
    
            break;
        }
        }
    
        return todoistId;
    }

    //get all files in the vault
    async getAllFilesInTheVault(){
        const files = this.app.vault.getFiles()
        return(files)
    }

    //search filepath by taskid in vault
    async searchFilepathsByTaskidInVault(taskId:string){
        this.plugin.debugLog(`preprare to search task ${taskId}`)
        const files = await this.getAllFilesInTheVault()
        //this.plugin.debugLog(files)
        const tasks = files.map(async (file) => {
            if (!this.isMarkdownFile(file.path)) {
                return;
            }
            const fileContent = await this.app.vault.cachedRead(file);
            if (fileContent.includes(taskId)) {
                return file.path;
            }
        });
    
        const results = await Promise.all(tasks);
        const filePaths = results.filter((filePath) => filePath !== undefined);
        return filePaths[0] || null;
        //return filePaths || null
    }


    isMarkdownFile(filename:string) {
        const extension = filename.split('.').pop();
        return extension?.toLowerCase() === 'md';
      }

    /**
     * Update task ID in vault file (for legacy ID conversion)
     */
    async updateTaskIdInVault(
        filePath: string, 
        oldId: string, 
        newId: string
    ): Promise<boolean> {
        try {
            console.log(`[updateTaskIdInVault] start file=${filePath} oldId=${oldId} newId=${newId}`);

            const content = await this.readLiveFileContent(filePath);
            const lines = content.split('\n');
            console.log(`[updateTaskIdInVault] file-loaded lines=${lines.length} file=${filePath}`);
            
            // Scan for the line containing the old task ID
            let targetLineIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(`todoist_id:: ${oldId}`)) {
                    targetLineIndex = i;
                    break;
                }
            }
            
            if (targetLineIndex === -1) {
                console.warn(`[updateTaskIdInVault] Old ID ${oldId} not found in ${filePath}`);
                console.log(`[updateTaskIdInVault] fail old-id-not-found oldId=${oldId} file=${filePath}`);
                return false;
            }

            console.log(`[updateTaskIdInVault] target-line index=${targetLineIndex} file=${filePath}`);

            let line = lines[targetLineIndex];
            let hasChanges = false;
            
            // 1. Replace todoist_id metadata: %%[todoist_id:: oldId]%% -> %%[todoist_id:: newId]%%
            const oldIdPattern = new RegExp(`%%\\[todoist_id::\\s*${oldId}\\]%%`, 'g');
            if (oldIdPattern.test(line)) {
                line = line.replace(oldIdPattern, `%%[todoist_id:: ${newId}]%%`);
                hasChanges = true;
                console.log('[updateTaskIdInVault] replaced todoist_id metadata');
            }
            
            // 2. Replace App URI: todoist://task?id=oldId -> todoist://task?id=newId
            const oldAppUriPattern = new RegExp(`todoist://task\\?id=${oldId}`, 'g');
            if (oldAppUriPattern.test(line)) {
                line = line.replace(oldAppUriPattern, `todoist://task?id=${newId}`);
                hasChanges = true;
                console.log('[updateTaskIdInVault] replaced app uri');
            }
            
            const oldWebUrlPatternLegacy = new RegExp(`https://todoist\\.com/app/task/${oldId}`, 'g');
            if (oldWebUrlPatternLegacy.test(line)) {
                line = line.replace(oldWebUrlPatternLegacy, `https://todoist.com/app/task/${newId}`);
                hasChanges = true;
                console.log('[updateTaskIdInVault] replaced legacy web url');
            }

            const oldWebUrlPatternNew = new RegExp(`https://app\\.todoist\\.com/app/task/${oldId}`, 'g');
            if (oldWebUrlPatternNew.test(line)) {
                line = line.replace(oldWebUrlPatternNew, `https://app.todoist.com/app/task/${newId}`);
                hasChanges = true;
                console.log('[updateTaskIdInVault] replaced new web url');
            }

            // Todoist's pre-migration URL, camel-cased as showTask. The shape itself
            // is retired — following one now gets "this link will stop working" —
            // so swap the whole URL rather than just the id inside it.
            const legacyShowTaskPattern = new RegExp(`https?://todoist\\.com/showTask\\?id=${oldId}\\b`, 'gi');
            if (legacyShowTaskPattern.test(line)) {
                line = line.replace(legacyShowTaskPattern, `https://app.todoist.com/app/task/${newId}`);
                hasChanges = true;
                console.log('[updateTaskIdInVault] replaced legacy showTask url');
            }
            
            if (!hasChanges) {
                console.warn(`[updateTaskIdInVault] No ID patterns found for ${oldId} in ${filePath}`);
                console.log(`[updateTaskIdInVault] fail no-patterns-matched oldId=${oldId} file=${filePath}`);
                return false;
            }
            
            lines[targetLineIndex] = line;

            if (!this.plugin.backupOperation) {
                console.error(`[updateTaskIdInVault] Backup module not initialized, skipping ID update ${oldId} -> ${newId}`);
                console.log('[updateTaskIdInVault] fail backup-module-missing');
                return false;
            }

            console.log(`[updateTaskIdInVault] backup-start file=${filePath}`);
            const backupPath = await this.plugin.backupOperation.backupFile(filePath);
            if (!backupPath) {
                console.error(`[updateTaskIdInVault] Backup failed, skipping ID update ${oldId} -> ${newId}`);
                console.log('[updateTaskIdInVault] fail backup-failed');
                return false;
            }
            console.log(`[updateTaskIdInVault] backup-success path=${backupPath}`);

            await this.writeLiveFileContent(filePath, lines.join('\n'));
            console.log(`[updateTaskIdInVault] vault-modify-success oldId=${oldId} newId=${newId} file=${filePath}`);
            
            this.plugin.logOperation?.log(
                'FILE_TASK_ID_UPDATED', 
                `Updated task ID ${oldId} -> ${newId}`, 
                filePath, 
                newId
            );
            this.plugin.debugLog(`[updateTaskIdInVault] Updated task ID ${oldId} -> ${newId} in ${filePath}`);
            console.log(`[updateTaskIdInVault] done success oldId=${oldId} newId=${newId}`);
            return true;
        } catch (error) {
            console.error(`[updateTaskIdInVault] Failed to update task ID in vault:`, error);
            console.log('[updateTaskIdInVault] fail exception thrown');
            return false;
        }
    }

    /**
     * 扫描 Vault 中的所有 Todoist 任务
     * 
     * 扫描逻辑：
     * 1. 获取所有 .md 文件
     * 2. 遍历每个文件的每一行
     * 3. 查找包含 #todoist 标签的行
     * 4. 提取 todoist_id 元数据作为任务 ID
     * 5. 使用 taskParser 提取任务内容
     * 
     * @returns {
     *   tasksWithId: Map<string, VaultTask>,      // 有 todoist_id 的任务
     *   tasksWithoutId: VaultTaskWithoutId[]      // 无 todoist_id 的任务（新任务未同步）
     * }
     */
    async scanVaultTasks(): Promise<{
        tasksWithId: Map<string, VaultTask>;
        tasksWithoutId: VaultTaskWithoutId[];
    }> {
        const tasksWithId = new Map<string, VaultTask>();
        const tasksWithoutId: VaultTaskWithoutId[] = [];
        
        const storageDir = this.plugin.settings?.storageDirectory || 'ultimate-todoist-sync';
        const files = this.app.vault.getFiles().filter(f => f.extension === 'md' && !f.path.startsWith(storageDir + '/') && !f.path.startsWith('.'));

        for (const file of files) {
            try {
                const content = await this.readLiveFileContent(file.path);
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    
                    if (!line.includes('#todoist')) {
                        continue;
                    }
                    
                    const match = line.match(/%%\[todoist_id::\s*([\w-]+)\]%%/);
                        const taskContent = this.plugin.taskParser!.getTaskContentFromLineText(line);
                        const isCompleted = /\[x\]/i.test(line);
                        const labels = this.extractLabelsFromLine(line);
                        const dueDate = this.plugin.taskParser!.getDueDateFromLineText(line) || undefined;
                        const priority = this.plugin.taskParser!.getTaskPriority(line);
                    
                    if (match && match[1]) {
                        const taskId = match[1];
                        
                        if (tasksWithId.has(taskId)) {
                            console.warn(`[scanVaultTasks] Duplicate taskId ${taskId} found in ${file.path} (line ${i}), already mapped — skipping`);
                            continue;
                        }

                        tasksWithId.set(taskId, {
                            taskId,
                            content: taskContent,
                            isCompleted,
                            filePath: file.path,
                            lineNumber: i,
                            labels,
                            dueDate,
                            priority,
                        });
                    } else {
                        tasksWithoutId.push({
                            content: taskContent,
                            isCompleted,
                            filePath: file.path,
                            lineNumber: i,
                            labels
                        });
                    }
                }
            } catch (error) {
                console.error(`Error reading file ${file.path}:`, error);
            }
        }

        return { tasksWithId, tasksWithoutId };
    }

    /**
     * 从 syncData 中获取 Todoist 任务
     * 
     * @param syncData - Todoist Sync API 返回的数据
     * @returns Map<taskId, TodoistTask>
     */
    getTodoistTasksFromSyncData(syncData: Record<string, any> | null): Map<string, TodoistTask> {
        const todoistTasksMap = new Map<string, TodoistTask>();
        
        if (!syncData || !syncData.items) {
            return todoistTasksMap;
        }
        
        for (const task of syncData.items) {
            if (!task) continue;
            const taskAny = task as any;
            
            todoistTasksMap.set(task.id, {
                taskId: task.id,
                content: task.content || '',
                description: taskAny.description || '',
                checked: !!taskAny.checked,
                dueDate: task.due?.date,
                priority: task.priority || 1,
                projectId: taskAny.project_id || '',
                labels: task.labels || []
            });
        }

        return todoistTasksMap;
    }

    /**
     * 从行文本中提取标签
     * 
     * @param line - 行文本
     * @returns 标签数组（不带 # 前缀）
     */
    private extractLabelsFromLine(line: string): string[] {
        return this.plugin.taskParser!.getAllTagsFromLineText(line);
    }


}
