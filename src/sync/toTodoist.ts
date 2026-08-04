import UltimateTodoistSyncForObsidian from "../../main";
import { App, Editor, MarkdownView, Notice, TFile } from 'obsidian';
import { resolveVanishedTask } from './vanishedTaskAction';

export class ObsidianToTodoistSync {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;

    /**
     * A task created moments ago may legitimately be absent from the file text we
     * read — the write-back is still in flight, or the editor buffer holding it has
     * not been flushed yet. Deleting a Todoist task is irreversible, so never do it
     * inside this window; a genuinely deleted line is picked up on the next pass.
     */
    private static readonly DELETE_GRACE_MS = 60 * 1000;

    /**
     * A task's own creation triggers follow-up writes of our own (close,
     * description). A revision that moved this recently is far more likely to be
     * one of those than a competing edit by a person.
     */
    private static readonly CONFLICT_GRACE_MS = 60 * 1000;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    private requireServices() {
        const {
            taskParser,
            cacheOperation,
            todoistSyncAPI,
            fileOperation,
            backupOperation,
        } = this.plugin;

        if (!taskParser || !cacheOperation || !todoistSyncAPI || !fileOperation) {
            throw new Error('Todoist sync services are not initialized');
        }

        return {
            taskParser,
            cacheOperation,
            todoistSyncAPI,
            fileOperation,
            backupOperation,
        };
    }

    private requireTFile(file: unknown, context: string): TFile {
        if (!(file instanceof TFile)) {
            throw new Error(`${context}: target file not found`);
        }

        return file;
    }

    /**
     * Decide whether a Todoist revision that moved since we last recorded it should
     * stop an Obsidian-side push.
     *
     * A moved revision on its own says very little: only that the task changed at
     * some point since we last looked. It does not say a person changed it, nor
     * that the change collides with what Obsidian wants to write. Treating every
     * mismatch as a conflict flagged tasks on a bare cursor move — lineNumberCheck
     * fires on every arrow key, and fullTextModifiedTaskCheck walks every task line
     * in the file — and left them disabled forever once any single revision refresh
     * had been missed.
     *
     * `announce` marks outcomes the user chose via conflictResolutionStrategy, so
     * the quiet automatic cases do not spam notices.
     */
    private decideConflict(
        taskId: string,
        taskMapping: { updated_at?: string; createdAt?: number },
        savedTask: { updated_at?: string },
        hasLocalChanges: boolean
    ): { action: 'no-conflict' | 'push' | 'pull' | 'block'; announce: boolean } {
        const quiet = (action: 'no-conflict' | 'push' | 'pull' | 'block') => ({ action, announce: false });

        // No recorded revision means no basis for comparison.
        if (!taskMapping.updated_at || !savedTask.updated_at) return quiet('no-conflict');
        if (savedTask.updated_at === taskMapping.updated_at) return quiet('no-conflict');

        // An unchanged line has nothing to overwrite, so there is nothing to
        // conflict with. Leave the recorded revision stale on purpose: that is
        // exactly what makes the pull direction pick the change up.
        if (!hasLocalChanges) {
            this.plugin.debugLog(`[decideConflict] Task ${taskId}: Todoist moved but Obsidian has no changes to push`);
            return quiet('no-conflict');
        }

        const createdAt = taskMapping.createdAt;
        if (createdAt && Date.now() - createdAt < ObsidianToTodoistSync.CONFLICT_GRACE_MS) {
            this.plugin.debugLog(`[decideConflict] Task ${taskId}: revision moved inside its creation window, treating as our own write`);
            return quiet('push');
        }

        // With the pull direction off the user has declared Obsidian the source of
        // truth. Blocking on a Todoist change that will never be applied would
        // disable the task permanently.
        if (!this.plugin.settings.todoistToObsidianEnabled) {
            this.plugin.debugLog(`[decideConflict] Task ${taskId}: Todoist→Obsidian disabled, pushing Obsidian's version`);
            return quiet('push');
        }

        const strategy = this.plugin.settings.conflictResolutionStrategy;
        if (strategy === 'todoist-wins') return { action: 'pull', announce: true };
        if (strategy === 'obsidian-wins') return { action: 'push', announce: true };
        return { action: 'block', announce: true };
    }

    async deletedTaskCheck(file_path: string): Promise<number> {
        if (!this.plugin.isPrimaryDevice()) {
            this.plugin.debugLog('[toTodoist] Push blocked: not primary device');
            return 0;
        }
        const { cacheOperation, todoistSyncAPI, fileOperation } = this.requireServices();
        let currentFileValue: string;
        let view;
        let filepath: string;
        if (file_path) {
            filepath = file_path;
            // Live content, not vault.read: the on-disk copy lags the editor by a
            // couple of seconds and a just-written todoist_id would look deleted.
            currentFileValue = await fileOperation.readLiveFileContent(file_path);
        } else {
            view = this.app.workspace.getActiveViewOfType(MarkdownView);
            const file = this.requireTFile(this.app.workspace.getActiveFile(), 'deletedTaskCheck');
            filepath = file.path;
            currentFileValue = view?.data ?? '';
        }
        const taskIds = cacheOperation.getTasksInFile(filepath);
        if (taskIds.length === 0) {
            this.plugin.debugLog('No tasks in this file');
            return 0;
        }

        const currentFileValueWithOutFrontMatter = (currentFileValue ?? '').replace(/^---[\s\S]*?---\n/, '');

        const now = Date.now();
        const tasksToDelete = taskIds.filter((taskId: string) => {
            if (currentFileValueWithOutFrontMatter.includes(taskId)) return false;
            if (!cacheOperation.isTaskSyncEnabled(taskId)) return false;

            const createdAt = cacheOperation.getTaskFileMapping(taskId)?.createdAt;
            if (createdAt && now - createdAt < ObsidianToTodoistSync.DELETE_GRACE_MS) {
                this.plugin.debugLog(`[deletedTaskCheck] Task ${taskId} created ${now - createdAt}ms ago, within delete grace window — skipping`);
                return false;
            }
            return true;
        });

        // In the limited scope a task that leaves the vault is forgotten here, not
        // deleted there: the line may have been tidied away while the task is still
        // being worked on in Todoist.
        if (this.plugin.settings.obsidianToTodoistScope !== 'full' && tasksToDelete.length > 0) {
            for (const taskId of tasksToDelete) {
                await cacheOperation.deleteTaskFileMapping(taskId);
                this.plugin.logOperation?.log('OBSIDIAN_TASK_DELETED', `Task line removed from vault; kept in Todoist and unlinked: ${taskId}`, filepath, taskId);
            }
            new Notice(`${tasksToDelete.length} task(s) removed from this note. They were kept in Todoist.`);
            const savedUnlink = await this.plugin.saveSettings();
            if (!savedUnlink) {
                console.warn('[deletedTaskCheck] saveSettings skipped or failed');
            }
            return 0;
        }

        let deletedCount = 0;
        for (const taskId of tasksToDelete) {
            try {
                const api = todoistSyncAPI.initializeAPI();
                const response = await api.deleteTask(taskId);
                if (response) {
                    new Notice(`task ${taskId} is deleted`);
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_DELETED', `Deleted task: ${taskId}`, undefined, taskId);
                    await cacheOperation.deleteTaskFileMapping(taskId);
                    deletedCount++;
                }
            } catch (error) {
                console.error(`Failed to delete task ${taskId}: ${error}`);
                new Notice(`Failed to delete task ${taskId}. Check console for details.`);
            }
        }

		if (deletedCount > 0) {
			const saved = await this.plugin.saveSettings();
			if (!saved) {
				console.warn('[deletedTaskCheck] saveSettings skipped or failed');
			}
			try {
                await todoistSyncAPI.incrementalSync();
			} catch (syncErr) {
				console.error('[deletedTaskCheck] Post-push incremental sync failed:', syncErr);
            }
        }

        return deletedCount;
    }

    async lineContentNewTaskCheck(editor: Editor, view: MarkdownView): Promise<void> {
        if (!this.plugin.isPrimaryDevice()) {
            this.plugin.debugLog('[toTodoist] Push blocked: not primary device');
            return;
        }
        const { taskParser, cacheOperation, todoistSyncAPI } = this.requireServices();
        const filepath = view.file?.path;
        const fileContent = view?.data;
        const cursor = editor.getCursor();
        const line = cursor.line;
        const linetxt = editor.getLine(line);

        const hasId = taskParser.hasTodoistId(linetxt);
        const hasTag = taskParser.hasTodoistTag(linetxt);
        const isNewTask = !hasId && hasTag;

        if (isNewTask) {
            const processedLine = hasTag ? linetxt : taskParser.addTodoistTag(linetxt);
            this.plugin.debugLog('this is a new task');
            this.plugin.debugLog(processedLine);
            const currentTask = await taskParser.convertTextToTodoistTaskObject(processedLine, filepath, line, fileContent);

            try {
                const newTask = await todoistSyncAPI.AddTask(currentTask);
                const { id: todoist_id } = newTask;
                newTask.path = filepath;
                new Notice(`new task ${newTask.content} id is ${newTask.id}`);

                this.plugin.logOperation?.log('OBSIDIAN_TASK_CREATED', `Created task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian→todoist');
                this.plugin.logOperation?.log('TODOIST_TASK_CREATED', `Created task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian→todoist');

                await cacheOperation.setTaskFileMapping(todoist_id, filepath || '');

                // Close before snapshotting updated_at below — closing bumps the
                // Todoist revision, and a snapshot taken before it would leave the
                // mapping permanently one revision behind, which reads as a conflict
                // on the next edit of this line.
                if (currentTask.isCompleted === true) {
                    await todoistSyncAPI.CloseTask(newTask.id);
                    // taskFileMapping already set above
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian→todoist');
                    this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian→todoist');
                }

                // Immediately sync so syncData contains the new task before any
                // subsequent lineModifiedTaskCheck fires on the same line. The
                // revision must come from syncData, never from the SDK's return
                // value: the mapping stores the sync endpoint's updated_at string,
                // while the SDK hands back a Date, and the two do not compare equal.
                try {
                    await todoistSyncAPI.incrementalSync();
                    const updatedTask = await todoistSyncAPI.GetTaskById(todoist_id);
                    if (updatedTask?.updated_at) {
                        await cacheOperation.updateTaskMappingSyncMeta(todoist_id, { updated_at: updatedTask.updated_at });
                    }
                } catch (syncErr) {
                    console.error('[lineContentNewTaskCheck] Post-create incremental sync failed:', syncErr);
                }

                const text_with_out_link = `${processedLine} %%[todoist_id:: ${todoist_id}]%%`;
                const link = this.plugin.settings.useAppURI ? `[link](todoist://task?id=${newTask.id})` : `[link](https://app.todoist.com/app/task/${newTask.id})`;
                const text = taskParser.addTodoistLink(text_with_out_link, link);
                const from = { line: cursor.line, ch: 0 };
                const to = { line: cursor.line, ch: linetxt.length };
                try {
                    view.app.workspace.activeEditor?.editor?.replaceRange(text, from, to);
                } catch (replaceError) {
                    // replaceRange failed — roll back Todoist task to avoid duplicate on next trigger
                    console.error('[lineContentNewTaskCheck] replaceRange failed, rolling back Todoist task:', replaceError);
                    try {
                        const api = todoistSyncAPI.initializeAPI();
                        await api.deleteTask(todoist_id);
                    } catch (deleteError) {
                        console.error('[lineContentNewTaskCheck] Rollback failed:', deleteError);
                    }
                    await cacheOperation.deleteTaskFileMapping(todoist_id);
                    new Notice(`Failed to write task ID to file. Todoist task rolled back. Please try again.`);
                    return;
                }

				try {
					const saved = await this.plugin.saveSettings();
					if (!saved) {
						console.warn('[lineContentNewTaskCheck] saveSettings skipped or failed');
					}
				} catch (error) {
					console.error(error);
				}

            } catch (error) {
                console.error('Error adding task:', error);
                this.plugin.debugLog(`The error occurred in the file: ${filepath}`);
                new Notice(`Failed to create task. Check console for details.`);
                return;
            }
        }
    }

    /**
     * Detect new tasks when the user leaves a line (Full Vault Sync only).
     * Unlike lineContentNewTaskCheck (which fires on every keystroke for #todoist),
     * this fires once when the cursor moves away, so the user can finish typing.
     */
    async lastLineNewTaskCheck(filepath: string, lineText: string, lineNumber: number, fileContent: string): Promise<void> {
        if (!this.plugin.isPrimaryDevice()) {
            this.plugin.debugLog('[lastLineNewTaskCheck] Push blocked: not primary device');
            return;
        }
        const { taskParser, cacheOperation, todoistSyncAPI, fileOperation } = this.requireServices();
        if (!this.plugin.settings.enableFullVaultSync) return;

        const isTask = taskParser.isMarkdownTask(lineText);
        if (!isTask) return;

        const contentNotEmpty = taskParser.getTaskContentFromLineText(lineText) !== '';
        if (!contentNotEmpty) return;

        const hasId = taskParser.hasTodoistId(lineText);
        if (hasId) return;

        const hasTag = taskParser.hasTodoistTag(lineText);
        if (hasTag) return; // Already has #todoist — lineContentNewTaskCheck will handle it

        // Add #todoist tag
        const processedLine = taskParser.addTodoistTag(lineText);
        this.plugin.debugLog('[lastLineNewTaskCheck] New task detected on line leave:', processedLine);

        const currentTask = await taskParser.convertTextToTodoistTaskObject(processedLine, filepath, lineNumber, fileContent);
        if (typeof currentTask === 'undefined') {
            console.warn(`[lastLineNewTaskCheck] Task parser returned undefined for line: ${processedLine}`);
            this.plugin.debugLog(`[lastLineNewTaskCheck] Task parser returned undefined for line ${lineNumber} in ${filepath}`);
            this.plugin.logOperation?.log('TASK_PARSE_FAILED', `Task parser failed for line ${lineNumber}`, filepath);
            return;
        }

        try {
            const newTask = await todoistSyncAPI.AddTask(currentTask);
            const { id: todoist_id } = newTask;
            newTask.path = filepath;
            new Notice(`new task ${newTask.content} id is ${newTask.id}`);

            this.plugin.logOperation?.log('OBSIDIAN_TASK_CREATED', `Created task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
            this.plugin.logOperation?.log('TODOIST_TASK_CREATED', `Created task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');

            await cacheOperation.setTaskFileMapping(todoist_id, filepath || '');

            // Close before snapshotting updated_at below \u2014 see lineContentNewTaskCheck.
            if (currentTask.isCompleted === true) {
                await todoistSyncAPI.CloseTask(newTask.id);
                this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
                this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
            }

            // Immediately sync so syncData contains the new task
            try {
                await todoistSyncAPI.incrementalSync();
                const updatedTask = await todoistSyncAPI.GetTaskById(todoist_id);
                if (updatedTask?.updated_at) {
                    await cacheOperation.updateTaskMappingSyncMeta(todoist_id, { updated_at: updatedTask.updated_at });
                }
            } catch (syncErr) {
                console.error('[lastLineNewTaskCheck] Post-create incremental sync failed:', syncErr);
            }

            // Write tag + id + link back to the file
            const text_with_out_link = `${processedLine} %%[todoist_id:: ${todoist_id}]%%`;
            const link = this.plugin.settings.useAppURI ? `[link](todoist://task?id=${newTask.id})` : `[link](https://app.todoist.com/app/task/${newTask.id})`;
            const text = taskParser.addTodoistLink(text_with_out_link, link);

            // Read/write through the editor when one is open: the cursor has left
            // this line, but the buffer is still the authoritative copy and a plain
            // vault.modify would be undone by the next autosave.
            const currentContent = await fileOperation.readLiveFileContent(filepath);
            const lines = currentContent.split('\n');
            if (lineNumber < lines.length) {
                lines[lineNumber] = text;
                await fileOperation.writeLiveFileContent(filepath, lines.join('\n'));
            }

            const saved = await this.plugin.saveSettings();
            if (!saved) {
                console.warn('[lastLineNewTaskCheck] saveSettings skipped or failed');
            }
        } catch (error) {
            console.error('[lastLineNewTaskCheck] Error adding task:', error);
            this.plugin.debugLog(`The error occurred in the file: ${filepath}`);
            new Notice(`Failed to create task. Check console for details.`);
        }
    }

    async fullTextNewTaskCheck(file_path: string): Promise<void> {
        if (!this.plugin.isPrimaryDevice()) {
            this.plugin.debugLog('[toTodoist] Push blocked: not primary device');
            return;
        }
        const { taskParser, cacheOperation, todoistSyncAPI, backupOperation, fileOperation } = this.requireServices();
        let file;
        let currentFileValue: string;
        let view;
        let filepath: string;
        if (file_path) {
            file = this.app.vault.getAbstractFileByPath(file_path);
            file = this.requireTFile(file, 'fullTextNewTaskCheck');
            filepath = file_path;
            // Live content: acting on the stale on-disk copy would create a second
            // Todoist task for a line whose id is still only in the editor buffer.
            currentFileValue = await fileOperation.readLiveFileContent(file_path);
        } else {
            view = this.app.workspace.getActiveViewOfType(MarkdownView);
            file = this.app.workspace.getActiveFile();
            file = this.requireTFile(file, 'fullTextNewTaskCheck');
            filepath = file.path;
            currentFileValue = view?.data ?? '';
        }
        // Prevent per-task vault.modify from triggering modify event storm
        this.plugin.isProcessingModify = true;
        try {
        if (this.plugin.settings.enableFullVaultSync) {
            await fileOperation.addTodoistTagToFile(filepath);
            // Live content again: if nothing was tagged, vault.read would hand back
            // the stale on-disk copy and we would re-create ids already in the editor.
            currentFileValue = await fileOperation.readLiveFileContent(filepath);
        }

            let lines = currentFileValue.split('\n');
        for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!taskParser.hasTodoistId(line) && taskParser.hasTodoistTag(line)) {
                    this.plugin.debugLog(filepath);
                    const currentTask = await taskParser.convertTextToTodoistTaskObject(line, filepath, i, lines.join('\n'));
                    if (typeof currentTask === 'undefined') {
                        console.warn(`[fullTextNewTaskCheck] Task parser returned undefined for line ${i} in ${filepath}`);
                        this.plugin.debugLog(`[fullTextNewTaskCheck] Task parser returned undefined for line ${i} in ${filepath}`);
                        this.plugin.logOperation?.log('TASK_PARSE_FAILED', `Task parser failed for line ${i}`, filepath);
                        continue;
                    }
                this.plugin.debugLog(currentTask);
                    let todoist_id: string | undefined;
                    try {
                        const newTask = await todoistSyncAPI.AddTask(currentTask);
                        todoist_id = newTask.id;
                        newTask.path = filepath;
                        this.plugin.debugLog(newTask);
                        new Notice(`new task ${newTask.content} id is ${newTask.id}`);
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_CREATED', `Created task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
                        this.plugin.logOperation?.log('TODOIST_TASK_CREATED', `Created task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');

					await cacheOperation.setTaskFileMapping(todoist_id!, filepath || '');
                    if (currentTask.isCompleted === true) {
                            await todoistSyncAPI.CloseTask(newTask.id);
                            this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task in Obsidian: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
                            this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${newTask.content}`, filepath, todoist_id, 'obsidian\u2192todoist');
                        }
                    const text_with_out_link = `${line} %%[todoist_id:: ${todoist_id}]%%`;
                        const link = this.plugin.settings.useAppURI ? `[link](todoist://task?id=${newTask.id})` : `[link](https://app.todoist.com/app/task/${newTask.id})`;
                        const text = taskParser.addTodoistLink(text_with_out_link, link);
                    lines[i] = text;
                        // Atomic: write file immediately after each task
                        const newContent = lines.join('\n');
                        await backupOperation?.backupFile(filepath);
                        await fileOperation.writeLiveFileContent(filepath, newContent);
					const saved = await this.plugin.saveSettings();
					if (!saved) {
						console.warn('[fullTextNewTaskCheck] saveSettings skipped or failed');
					}
                        try {
                            await todoistSyncAPI.incrementalSync();
                            const updatedTask = await todoistSyncAPI.GetTaskById(todoist_id!);
                            if (updatedTask?.updated_at) {
                                await cacheOperation.updateTaskMappingSyncMeta(todoist_id!, { updated_at: updatedTask.updated_at });
                            }
                        } catch (syncErr) {
                            console.error('[fullTextNewTaskCheck] Post-push incremental sync failed:', syncErr);
                        }
                        // Re-read so subsequent iterations use the latest content —
                        // live, since the write above may have gone to the editor.
                        const refreshed = await fileOperation.readLiveFileContent(filepath);
                        lines = refreshed.split('\n');

                    } catch (error) {
                        console.error('Error adding task:', error);
                        new Notice(`Failed to create task. Check console for details.`);
                        // Rollback: delete Todoist task + clean mapping if we got an id
                        if (todoist_id) {
                            try {
                                await todoistSyncAPI.deleteTask(todoist_id);
                            } catch (deleteError) {
                                console.error('[fullTextNewTaskCheck] Rollback deleteTask failed:', deleteError);
                            }
                            await cacheOperation.deleteTaskFileMapping(todoist_id);
                        }
                        continue;
                    }
                }
            }
        } finally {
            this.plugin.isProcessingModify = false;
        }
    }

    async lineModifiedTaskCheck(filepath: string, lineText: string, lineNumber: number, fileContent: string): Promise<void> {
        if (!this.plugin.isPrimaryDevice()) {
            this.plugin.debugLog('[toTodoist] Push blocked: not primary device');
            return;
        }
        const { taskParser, cacheOperation, todoistSyncAPI } = this.requireServices();
        if (taskParser.hasTodoistId(lineText) && taskParser.hasTodoistTag(lineText)) {
            const lineTask = await taskParser.convertTextToTodoistTaskObject(lineText, filepath, lineNumber, fileContent);
            if (!lineTask || !lineTask.todoist_id) {
                return;
            }
            const lineTask_todoist_id = lineTask.todoist_id.toString();

            const taskMapping = cacheOperation.getTaskFileMapping(lineTask_todoist_id);
            if (!taskMapping) {
                this.plugin.debugLog(`Local cache has no task ${lineTask.todoist_id}`);
                const url = taskParser.getObsidianUrlFromFilepath(filepath);
                this.plugin.debugLog(url);
                return;
            }

            if (!cacheOperation.isTaskSyncEnabled(lineTask_todoist_id)) {
                this.plugin.debugLog(`[lineModifiedTaskCheck] Sync disabled for task ${lineTask_todoist_id}, skipping modification`);
                // Only worth an operation-log entry while the task still needs the
                // user's attention. A settled ('nonActive') task is skipped on every
                // scheduler pass forever, and logging that buries the whole log —
                // 4696 of 4698 entries in one real vault were exactly this.
                if (cacheOperation.getTaskFileMapping(lineTask_todoist_id)?.status !== 'nonActive') {
                    this.plugin.logOperation?.log('SYNC_DISABLED_SKIP', `User edit ignored: sync disabled for task ${lineTask_todoist_id}`, filepath, lineTask_todoist_id);
                }
                return;
            }

            const savedTask = await todoistSyncAPI.GetTaskById(lineTask_todoist_id);

            // Not in the sync data. That does not mean deleted: a task completed in
            // Todoist drops out of /api/v1/sync entirely rather than coming back
            // with checked=true, so ask Todoist which it was before concluding.
            if (!savedTask) {
                const action = resolveVanishedTask({
                    completionState: await todoistSyncAPI.GetTaskCompletionState(lineTask_todoist_id),
                    vaultCompleted: lineTask.isCompleted === true,
                    mappingAgeMs: taskMapping.createdAt === undefined
                        ? undefined
                        : Date.now() - taskMapping.createdAt,
                    creationGraceMs: ObsidianToTodoistSync.CONFLICT_GRACE_MS,
                });

                if (action === 'complete-in-vault' || action === 'settle') {
                    // Done in Todoist. Settle it rather than reporting a problem —
                    // the pull direction ticks the checkbox when it is enabled.
                    await cacheOperation.setTaskFileMapping(lineTask_todoist_id, taskMapping.filePath, 'nonActive', false);
                    this.plugin.debugLog(`[lineModifiedTaskCheck] Task ${lineTask_todoist_id} is completed in Todoist, marking nonActive`);
                    this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Task completed in Todoist: ${lineTask_todoist_id}`, filepath, lineTask_todoist_id, 'todoist→obsidian');
                    return;
                }

                if (action !== 'flag-missing') {
                    this.plugin.debugLog(`[lineModifiedTaskCheck] Task ${lineTask_todoist_id} not in syncData and nothing concluded (${action}), skipping`);
                    return;
                }

                console.warn(`[lineModifiedTaskCheck] Task ${lineTask_todoist_id} confirmed deleted in Todoist, marking as issue`);
                await cacheOperation.setTaskFileMapping(lineTask_todoist_id, taskMapping.filePath, 'issue', false);
				await cacheOperation.upsertTaskIssue(lineTask_todoist_id, 'todoist_task_missing', {
                    state: 'open',
                    severity: 'high',
                    source: 'runtime',
                    details: 'Task no longer exists in Todoist.',
                    manualAction: 'Resolve in Manage Problem Tasks',
                }, false);
                new Notice(`Task ${lineTask_todoist_id} no longer exists in Todoist. Sync disabled.`);
                this.plugin.logOperation?.log('CONFLICT_DETECTED', `Task ${lineTask_todoist_id} missing in Todoist`, filepath, lineTask_todoist_id);
                return;
            }

            // In the limited scope Obsidian creates tasks and reflects completion;
            // everything after that belongs to Todoist. Not comparing those fields
            // at all is what keeps a vault line that has drifted from being pushed
            // over work done in Todoist.
            const pushesFieldEdits = this.plugin.settings.obsidianToTodoistScope === 'full';

            const lineTaskContent = lineTask.content;
            const contentModified = pushesFieldEdits && !taskParser.taskContentCompare(lineTask, savedTask);
            const tagsModified = pushesFieldEdits && !taskParser.taskTagCompare(lineTask, savedTask);
            const statusModified = !taskParser.taskStatusCompare(lineTask, savedTask);
            const dueDateModified = pushesFieldEdits && !taskParser.compareTaskDueDate(lineTask, savedTask);
            const priorityModified = pushesFieldEdits && !taskParser.taskPriorityCompare(lineTask, savedTask);
            const hasLocalChanges = contentModified || tagsModified || statusModified || dueDateModified || priorityModified;

            // Conflict detection: Todoist moved on since we last recorded it *and*
            // Obsidian has something it wants to overwrite.
            const conflict = this.decideConflict(lineTask_todoist_id, taskMapping, savedTask, hasLocalChanges);
            if (conflict.action !== 'no-conflict' && conflict.announce) {
                const strategy = this.plugin.settings.conflictResolutionStrategy;
                console.warn(`[lineModifiedTaskCheck] Conflict on task ${lineTask_todoist_id}: strategy=${strategy}`);
                this.plugin.logOperation?.log('CONFLICT_DETECTED', `Conflict on task ${lineTask_todoist_id} (strategy: ${strategy})`, filepath, lineTask_todoist_id);
            }

            if (conflict.action === 'pull') {
                // Leaving the recorded revision stale is what makes the pull re-apply
                // Todoist's version, so there is nothing to write here.
                new Notice(`Conflict on task ${lineTask_todoist_id}: Todoist wins — Obsidian will be updated on next sync.`);
                return;
            }
            if (conflict.action === 'block') {
                await cacheOperation.setTaskFileMapping(lineTask_todoist_id, taskMapping.filePath, 'conflicted', false);
                new Notice(`Task ${lineTask_todoist_id} has a conflict: modified in both Obsidian and Todoist. Sync disabled until resolved.`);
                return;
            }
            if (conflict.action === 'push') {
                // Record what we observed so the pull direction will not undo the push.
                await cacheOperation.updateTaskMappingSyncMeta(lineTask_todoist_id, { updated_at: savedTask.updated_at });
                if (conflict.announce) {
                    new Notice(`Conflict on task ${lineTask_todoist_id}: Obsidian wins — pushing to Todoist.`);
                }
            }

            try {
                let contentChanged = false;
                let tagsChanged = false;
                let statusChanged = false;
                let dueDateChanged = false;
                let priorityChanged = false;

                const updatedContent: Record<string, unknown> = {};
                if (contentModified) {
                    this.plugin.debugLog(`Content modified for task ${lineTask_todoist_id}`);
                    updatedContent.content = lineTaskContent;
                    contentChanged = true;
                }

                if (tagsModified) {
                    this.plugin.debugLog(`Tags modified for task ${lineTask_todoist_id}`);
                    updatedContent.labels = lineTask.labels;
                    tagsChanged = true;
                }

                if (dueDateModified) {
                    this.plugin.debugLog(`Due date modified for task ${lineTask_todoist_id}`);
                    this.plugin.debugLog(lineTask.dueDate);
                    if (lineTask.dueDate === "") {
                        updatedContent.dueString = "no date";
                    } else {
                        updatedContent.dueDate = lineTask.dueDate;
                    }
                    dueDateChanged = true;
                }

                if (priorityModified) {
                    updatedContent.priority = lineTask.priority;
                    priorityChanged = true;
                }

                if (contentChanged || tagsChanged || dueDateChanged || priorityChanged) {
                    const updatedTask = await todoistSyncAPI.UpdateTask(lineTask_todoist_id, updatedContent);
                    // taskFileMapping already set, no need to update
                    this.plugin.logOperation?.log('OBSIDIAN_TASK_MODIFIED', `Updated task: ${updatedTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task in Todoist: ${updatedTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                }

                if (statusModified) {
                    this.plugin.debugLog(`Status modified for task ${lineTask_todoist_id}`);
                    if (lineTask.isCompleted === true) {
                        this.plugin.debugLog(`task completed`);
                        await todoistSyncAPI.CloseTask(lineTask_todoist_id);
                        // taskFileMapping already set, no need to update
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_COMPLETED', `Completed task: ${lineTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                        this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Completed task in Todoist: ${lineTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                    } else {
                        this.plugin.debugLog(`task uncompleted`);
                        await todoistSyncAPI.OpenTask(lineTask_todoist_id);
                        // taskFileMapping already set, no need to update
                        this.plugin.logOperation?.log('OBSIDIAN_TASK_REOPENED', `Reopened task: ${lineTask.content}`, filepath, lineTask_todoist_id);
                        this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Reopened task in Todoist: ${lineTask.content}`, filepath, lineTask_todoist_id, 'obsidian→todoist');
                    }
                    statusChanged = true;
                }

                if (contentChanged || statusChanged || dueDateChanged || tagsChanged || priorityChanged) {
                    this.plugin.debugLog(lineTask);
                    this.plugin.debugLog(savedTask);
					const saved = await this.plugin.saveSettings();
					if (!saved) {
						console.warn('[lineModifiedTaskCheck] saveSettings skipped or failed');
					}
                    try {
                        await todoistSyncAPI.incrementalSync();
                        const refreshedTask = await todoistSyncAPI.GetTaskById(lineTask_todoist_id);
                        if (refreshedTask?.updated_at) {
                            await cacheOperation.updateTaskMappingSyncMeta(lineTask_todoist_id, { updated_at: refreshedTask.updated_at });
                        }
                    } catch (syncErr) {
                        console.error('[lineModifiedTaskCheck] Post-push incremental sync failed:', syncErr);
                    }
                    let message = `Task ${lineTask_todoist_id} is updated.`;

                    if (contentChanged) {
                        message += " Content was changed.";
                    }
                    if (statusChanged) {
                        message += " Status was changed.";
                    }
                    if (dueDateChanged) {
                        message += " Due date was changed.";
                    }
                    if (tagsChanged) {
                        message += " Tags were changed.";
                    }
                    if (priorityChanged) {
                        message += " Priority was changed.";
                    }

                    new Notice(message);
                }

            } catch (error) {
                console.error('Error updating task:', error);
                new Notice(`Failed to update task ${lineTask_todoist_id}. Check console for details.`);
            }
        }
    }

    async fullTextModifiedTaskCheck(file_path: string): Promise<void> {
        const { taskParser, fileOperation } = this.requireServices();
        let file;
        let currentFileValue;
        let view;
        let filepath;

        try {
            if (file_path) {
                filepath = file_path;
                currentFileValue = await fileOperation.readLiveFileContent(file_path);
            } else {
                view = this.app.workspace.getActiveViewOfType(MarkdownView);
                file = this.app.workspace.getActiveFile();
                file = this.requireTFile(file, 'fullTextModifiedTaskCheck');
                filepath = file?.path;
                currentFileValue = view?.data;
            }

            const content = currentFileValue ?? '';
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (taskParser.hasTodoistId(line) && taskParser.hasTodoistTag(line)) {
                    try {
                        await this.lineModifiedTaskCheck(filepath, line, i, content);
                    } catch (error) {
                        console.error('Error modifying task:', error);
                        continue;
                    }
                }
            }
        } catch (error) {
            console.error('Error:', error);
        }
    }

    async closeTask(taskId: string): Promise<void> {
        if (!this.plugin.isPrimaryDevice()) {
            this.plugin.debugLog('[toTodoist] Push blocked: not primary device');
            return;
        }
        const { cacheOperation, todoistSyncAPI, fileOperation } = this.requireServices();
        if (!cacheOperation.isTaskSyncEnabled(taskId)) {
            this.plugin.debugLog(`[closeTask] Sync disabled for task ${taskId}, skipping close`);
            this.plugin.logOperation?.log('SYNC_DISABLED_SKIP', `Checkbox close ignored: sync disabled for task ${taskId}`, undefined, taskId);
            return;
        }
        try {
            const taskMapping = cacheOperation.getTaskFileMapping(taskId);
            const savedTask = await todoistSyncAPI.GetTaskById(taskId);

            if (!savedTask) {
                // Absent from the sync data may mean completed rather than deleted.
                const action = resolveVanishedTask({
                    completionState: await todoistSyncAPI.GetTaskCompletionState(taskId),
                    vaultCompleted: true,
                    mappingAgeMs: taskMapping?.createdAt === undefined
                        ? undefined
                        : Date.now() - taskMapping.createdAt,
                    creationGraceMs: ObsidianToTodoistSync.CONFLICT_GRACE_MS,
                });

                if (action === 'complete-in-vault' || action === 'settle') {
                    await cacheOperation.setTaskFileMapping(taskId, taskMapping?.filePath || '', 'nonActive', false);
                    this.plugin.debugLog(`[closeTask] Task ${taskId} is already completed in Todoist, marking nonActive`);
                    return;
                }

                if (action !== 'flag-missing') {
                    this.plugin.debugLog(`[closeTask] Task ${taskId} not in syncData and nothing concluded (${action}), skipping`);
                    return;
                }

                await cacheOperation.setTaskFileMapping(taskId, taskMapping?.filePath || '', 'issue', false);
				await cacheOperation.upsertTaskIssue(taskId, 'todoist_task_missing', {
                    state: 'open',
                    severity: 'high',
                    source: 'runtime',
                    details: 'Task no longer exists in Todoist.',
                    manualAction: 'Resolve in Manage Problem Tasks',
                }, false);
                new Notice(`Task ${taskId} no longer exists in Todoist. Sync disabled.`);
                return;
            }

            if (taskMapping) {
                // Todoist already being in the requested state means the checkbox
                // click has nothing to push, so nothing can collide with it.
                const conflict = this.decideConflict(taskId, taskMapping, savedTask, !savedTask.checked);
                if (conflict.announce) {
                    const strategy = this.plugin.settings.conflictResolutionStrategy;
                    this.plugin.logOperation?.log('CONFLICT_DETECTED', `Conflict on closeTask ${taskId} (strategy: ${strategy})`, undefined, taskId);
                }
                if (conflict.action === 'pull') {
                    new Notice(`Conflict on task ${taskId}: Todoist wins — Obsidian will be updated on next sync.`);
                    return;
                }
                if (conflict.action === 'block') {
                    await cacheOperation.setTaskFileMapping(taskId, taskMapping.filePath, 'conflicted', false);
                    new Notice(`Task ${taskId} has a conflict. Sync disabled until resolved.`);
                    return;
                }
                // no-conflict / push: close it
            }

            await todoistSyncAPI.CloseTask(taskId);
			await fileOperation.completeTaskInTheFile(taskId);
			const saved = await this.plugin.saveSettings();
			if (!saved) {
				console.warn('[closeTask] saveSettings skipped or failed');
			}
            try {
                await todoistSyncAPI.incrementalSync();
                const refreshedTask = await todoistSyncAPI.GetTaskById(taskId);
                if (refreshedTask?.updated_at) {
                    await cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: refreshedTask.updated_at });
                }
            } catch (syncErr) {
                console.error('[closeTask] Post-push incremental sync failed:', syncErr);
            }
            new Notice(`Task ${taskId} is closed.`);
            this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Closed task via checkbox: ${taskId}`, undefined, taskId, 'obsidian→todoist');
        } catch (error) {
            console.error('Error closing task:', error);
            throw error;
        }
    }

    async repoenTask(taskId: string): Promise<void> {
        if (!this.plugin.isPrimaryDevice()) {
            this.plugin.debugLog('[toTodoist] Push blocked: not primary device');
            return;
        }
        const { cacheOperation, todoistSyncAPI, fileOperation } = this.requireServices();
        if (!cacheOperation.isTaskSyncEnabled(taskId)) {
            this.plugin.debugLog(`[repoenTask] Sync disabled for task ${taskId}, skipping reopen`);
            this.plugin.logOperation?.log('SYNC_DISABLED_SKIP', `Checkbox reopen ignored: sync disabled for task ${taskId}`, undefined, taskId);
            return;
        }
        try {
            const taskMapping = cacheOperation.getTaskFileMapping(taskId);
            const savedTask = await todoistSyncAPI.GetTaskById(taskId);

            if (!savedTask) {
                // Absent from the sync data may mean completed rather than deleted.
                const action = resolveVanishedTask({
                    completionState: await todoistSyncAPI.GetTaskCompletionState(taskId),
                    vaultCompleted: false,
                    mappingAgeMs: taskMapping?.createdAt === undefined
                        ? undefined
                        : Date.now() - taskMapping.createdAt,
                    creationGraceMs: ObsidianToTodoistSync.CONFLICT_GRACE_MS,
                });

                if (action === 'complete-in-vault' || action === 'settle') {
                    await cacheOperation.setTaskFileMapping(taskId, taskMapping?.filePath || '', 'nonActive', false);
                    this.plugin.debugLog(`[repoenTask] Task ${taskId} is already completed in Todoist, marking nonActive`);
                    return;
                }

                if (action !== 'flag-missing') {
                    this.plugin.debugLog(`[repoenTask] Task ${taskId} not in syncData and nothing concluded (${action}), skipping`);
                    return;
                }

                await cacheOperation.setTaskFileMapping(taskId, taskMapping?.filePath || '', 'issue', false);
				await cacheOperation.upsertTaskIssue(taskId, 'todoist_task_missing', {
                    state: 'open',
                    severity: 'high',
                    source: 'runtime',
                    details: 'Task no longer exists in Todoist.',
                    manualAction: 'Resolve in Manage Problem Tasks',
                }, false);
                new Notice(`Task ${taskId} no longer exists in Todoist. Sync disabled.`);
                return;
            }

            if (taskMapping) {
                // Todoist already being in the requested state means the checkbox
                // click has nothing to push, so nothing can collide with it.
                const conflict = this.decideConflict(taskId, taskMapping, savedTask, !!savedTask.checked);
                if (conflict.announce) {
                    const strategy = this.plugin.settings.conflictResolutionStrategy;
                    this.plugin.logOperation?.log('CONFLICT_DETECTED', `Conflict on repoenTask ${taskId} (strategy: ${strategy})`, undefined, taskId);
                }
                if (conflict.action === 'pull') {
                    new Notice(`Conflict on task ${taskId}: Todoist wins — Obsidian will be updated on next sync.`);
                    return;
                }
                if (conflict.action === 'block') {
                    await cacheOperation.setTaskFileMapping(taskId, taskMapping.filePath, 'conflicted', false);
                    new Notice(`Task ${taskId} has a conflict. Sync disabled until resolved.`);
                    return;
                }
                // no-conflict / push: reopen it
            }

            await todoistSyncAPI.OpenTask(taskId);
			await fileOperation.uncompleteTaskInTheFile(taskId);
			const saved = await this.plugin.saveSettings();
			if (!saved) {
				console.warn('[repoenTask] saveSettings skipped or failed');
			}
            try {
                await todoistSyncAPI.incrementalSync();
                const refreshedTask = await todoistSyncAPI.GetTaskById(taskId);
                if (refreshedTask?.updated_at) {
                    await cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: refreshedTask.updated_at });
                }
            } catch (syncErr) {
                console.error('[repoenTask] Post-push incremental sync failed:', syncErr);
            }
            new Notice(`Task ${taskId} is reopened.`);
            this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Reopened task via checkbox: ${taskId}`, undefined, taskId, 'obsidian→todoist');
        } catch (error) {
            console.error('Error opening task:', error);
            throw error;
        }
    }



    async updateTaskDescription(filepath: string): Promise<void> {
        const { cacheOperation, taskParser, todoistSyncAPI } = this.requireServices();
        const taskIds = cacheOperation.getTasksInFile(filepath);

        if (taskIds.length === 0) {
            return;
        }

        const updatedTaskIds: string[] = [];

        for (const taskId of taskIds) {
            try {
                const taskMapping = cacheOperation.getTaskFileMapping(taskId);
                if (taskMapping) {
                    if (!cacheOperation.isTaskSyncEnabled(taskId)) continue;
                    const description = taskParser.getObsidianUrlFromFilepath(filepath);
                    const todoistTask = await todoistSyncAPI.GetTaskById(taskId);
                    if (todoistTask?.description === description) {
                        continue;
                    }

                    await todoistSyncAPI.UpdateTask(taskId, { description });
                    updatedTaskIds.push(taskId);
                    this.plugin.logOperation?.log('TODOIST_TASK_UPDATED', `Updated task description: ${taskId}`, filepath, taskId, 'obsidian→todoist');
                }
            } catch (error) {
                console.error(`Error updating task description for ${taskId}:`, error);
            }
        }

        // Each description push bumps the Todoist revision. Without recording the
        // new value the mapping goes stale and every one of these tasks reports a
        // phantom conflict on its next edit.
        if (updatedTaskIds.length > 0) {
            try {
                await todoistSyncAPI.incrementalSync();
                for (const taskId of updatedTaskIds) {
                    const refreshedTask = todoistSyncAPI.getTaskByIdLocal(taskId);
                    if (refreshedTask?.updated_at) {
                        await cacheOperation.updateTaskMappingSyncMeta(taskId, { updated_at: refreshedTask.updated_at });
                    }
                }
            } catch (syncErr) {
                console.error('[updateTaskDescription] Post-push incremental sync failed:', syncErr);
            }
        }
    }
}
