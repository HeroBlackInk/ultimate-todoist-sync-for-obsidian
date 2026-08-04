import UltimateTodoistSyncForObsidian from "../../main";
import { App, Notice } from 'obsidian';
import { StoragePathManager } from '../storage/pathManager';
import { resolveVanishedTask } from './vanishedTaskAction';

export class TodoistToObsidianSync {
    app: App;
    plugin: UltimateTodoistSyncForObsidian;

    /**
     * A task created moments ago may not be in the sync data yet, so nothing is
     * concluded about its absence inside this window.
     */
    private static readonly VANISHED_GRACE_MS = 60 * 1000;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    /** @returns how many tasks were written to the vault. */
    async syncTodoistToObsidian(): Promise<number> {
        try {
            this.plugin.logOperation?.log('SYNC_START', 'Starting sync from Todoist to Obsidian', undefined, undefined, 'todoist→obsidian');

            await this.plugin.todoistSyncAPI!.incrementalSync();

            const syncData = this.plugin.todoistSyncAPI!.getSyncData();
            if (!syncData?.items) {
                this.plugin.debugLog('[Todoist→Obsidian] No sync data available');
                return 0;
            }

            const itemMap = new Map<string, any>();
            for (const item of syncData.items) {
                itemMap.set(item.id, item);
            }

            const noteMap = new Map<string, any[]>();
            if (syncData.notes) {
                for (const note of syncData.notes) {
                    const taskId = note.item_id;
                    if (!noteMap.has(taskId)) noteMap.set(taskId, []);
                    noteMap.get(taskId)!.push(note);
                }
            }

            const taskFileMapping = this.plugin.settings.taskFileMapping || {};
            let syncedCount = 0;

            // Resolve legacy numeric IDs → new string IDs so we can look up
            // tasks in the Sync API response (which uses new IDs).
            const cacheTaskIds = Object.keys(taskFileMapping);
            const idMapping = await this.resolveTaskIds(cacheTaskIds);

            // Set flag: file writes below are from Todoist pull, not user edits
            this.plugin.isSyncingFromTodoist = true;
            try {
                for (const taskId of cacheTaskIds) {
                    const mapping = taskFileMapping[taskId];
                    if (mapping.syncEnabled === false) continue;

                    const resolvedId = idMapping[taskId] || taskId;
                    const task = itemMap.get(resolvedId) || itemMap.get(taskId);

                    if (!task || task.is_deleted) {
                        // Absent from the sync data does not mean deleted: completed
                        // tasks drop out of /api/v1/sync entirely. Ask Todoist which
                        // it was, so a task ticked off there gets ticked off here.
                        try {
                            const settled = await this.applyVanishedTask(taskId, mapping);
                            if (!settled && this.plugin.settings.debugMode) {
                                this.plugin.debugLog(`[Todoist→Obsidian] Task ${taskId} not in sync data, nothing concluded yet`);
                            }
                        } catch (error) {
                            console.error(`[Todoist→Obsidian] Error resolving vanished task ${taskId}:`, error);
                        }
                        continue;
                    }

                    if (task.updated_at === mapping.updated_at) {
                        continue;
                    }

                    if (this.plugin.settings.debugMode) {
                        this.plugin.debugLog(`[Todoist→Obsidian] Task ${taskId} changed: ${mapping.updated_at} → ${task.updated_at}`);
                    }

                    try {
                        await this.syncSingleTaskToObsidian(taskId, task);
                        syncedCount++;
                        await this.plugin.cacheOperation!.updateTaskMappingSyncMeta(taskId, {
                            updated_at: task.updated_at,
                            note_count: task.note_count || 0
                        });
                    } catch (error) {
                        console.error(`[Todoist→Obsidian] Error syncing task ${taskId}:`, error);
                    }
                }

                // Notes insert new lines into the note, so they are part of the
                // full scope. note_count is deliberately left untouched in
                // status-only scope: switching to full later then appends the
                // backlog rather than silently dropping it.
                if (this.plugin.settings.todoistToObsidianScope === 'full') {
                    await this.syncNotesToObsidian(taskFileMapping, noteMap, idMapping);
                }
            } finally {
                this.plugin.isSyncingFromTodoist = false;
            }

            if (syncedCount > 0) {
                this.plugin.logOperation?.log('SYNC_COMPLETED', `Synced ${syncedCount} tasks from Todoist to Obsidian`);
            }
            return syncedCount;
        } catch (err) {
            console.error('An error occurred while synchronizing:', err);
            this.plugin.logOperation?.log('SYNC_ERROR', `Sync failed: ${(err as Error).message}`, undefined, undefined, 'todoist→obsidian');
            new Notice(`Todoist sync failed: ${(err as Error).message}`);
            return 0;
        }
    }

    /**
     * Handle a mapped task that is no longer in the sync data.
     *
     * Returns true when the task reached a settled state (completed here too, or
     * confirmed gone), false when nothing could be concluded and it should be
     * looked at again on the next pass.
     */
    private async applyVanishedTask(
        taskId: string,
        mapping: { filePath: string; createdAt?: number }
    ): Promise<boolean> {
        const completionState = await this.plugin.todoistSyncAPI!.GetTaskCompletionState(taskId);
        const vaultCompleted = await this.isTaskCompletedInVault(taskId, mapping.filePath);

        const action = resolveVanishedTask({
            completionState,
            vaultCompleted,
            mappingAgeMs: mapping.createdAt === undefined ? undefined : Date.now() - mapping.createdAt,
            creationGraceMs: TodoistToObsidianSync.VANISHED_GRACE_MS,
        });

        switch (action) {
            case 'complete-in-vault':
                await this.plugin.fileOperation!.completeTaskInTheFile(taskId);
                new Notice(`Task ${taskId} completed from Todoist`);
                this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Task completed in Todoist: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
                await this.settleCompletedTask(taskId, mapping.filePath);
                return true;
            case 'settle':
                await this.settleCompletedTask(taskId, mapping.filePath);
                return true;
            case 'flag-missing':
                // Genuinely deleted in Todoist while still open here. Leave the
                // flagging to the push side and the database checker, which own the
                // issue records and the user-facing resolution flow.
                this.plugin.debugLog(`[Todoist→Obsidian] Task ${taskId} confirmed deleted in Todoist`);
                return false;
            case 'wait':
            default:
                return false;
        }
    }

    /**
     * Mark a task done on both sides as settled: nothing left to sync, and not a
     * problem needing the user's attention.
     */
    private async settleCompletedTask(taskId: string, filePath: string): Promise<void> {
        await this.plugin.cacheOperation!.setTaskFileMapping(taskId, filePath, 'nonActive', false);
        this.plugin.debugLog(`[Todoist→Obsidian] Task ${taskId} settled as completed on both sides`);
    }

    private async isTaskCompletedInVault(taskId: string, filePath: string): Promise<boolean> {
        try {
            const content = await this.plugin.fileOperation!.readLiveFileContent(filePath);
            const line = content.split('\n').find(
                (candidate) => candidate.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(candidate)
            );
            return line ? /\[(x|X)\]/.test(line) : false;
        } catch (error) {
            this.plugin.debugLog(`[Todoist→Obsidian] Could not read vault state for ${taskId}: ${(error as Error).message}`);
            return false;
        }
    }

    private async syncSingleTaskToObsidian(taskId: string, task: any): Promise<void> {
        const mapping = this.plugin.cacheOperation!.getTaskFileMapping(taskId);
        if (!mapping) {
            console.warn(`[syncSingleTaskToObsidian] No mapping found for task ${taskId}`);
            this.plugin.debugLog(`[syncSingleTaskToObsidian] No mapping found for task ${taskId}`);
            this.plugin.logOperation?.log('SYNC_TARGET_MISSING', `Todoist→Obsidian sync skipped: no mapping for task ${taskId}`, undefined, taskId);
            return;
        }

        const file = this.app.vault.getAbstractFileByPath(mapping.filePath);
        if (!file) {
            console.warn(`[syncSingleTaskToObsidian] File not found: ${mapping.filePath} (task ${taskId})`);
            this.plugin.debugLog(`[syncSingleTaskToObsidian] File not found: ${mapping.filePath} (task ${taskId})`);
            this.plugin.logOperation?.log('SYNC_TARGET_MISSING', `Todoist→Obsidian sync skipped: file not found ${mapping.filePath}`, mapping.filePath, taskId);
            return;
        }

        const fileContent = await this.plugin.fileOperation!.readLiveFileContent(mapping.filePath);
        const lines = fileContent.split('\n');

        let taskLine = '';
        for (const line of lines) {
            if (line.includes(taskId) && this.plugin.taskParser!.hasTodoistTag(line)) {
                taskLine = line;
                break;
            }
        }
        if (!taskLine) {
            console.warn(`[syncSingleTaskToObsidian] Task line not found in file for task ${taskId}`);
            this.plugin.debugLog(`[syncSingleTaskToObsidian] Task line not found in file for task ${taskId}`);
            this.plugin.logOperation?.log('SYNC_TARGET_MISSING', `Todoist→Obsidian sync skipped: task line not found in file`, mapping.filePath, taskId);
            return;
        }

        const obsidianIsChecked = /\[(x|X)\]/.test(taskLine);
        const todoistIsChecked = task.checked || false;

        // Completion status is the one field that rewrites nothing but the
        // checkbox, so it is applied in every scope.
        if (todoistIsChecked && !obsidianIsChecked) {
            await this.plugin.fileOperation!.completeTaskInTheFile(taskId);
            new Notice(`Task ${taskId} completed from Todoist`);
            this.plugin.logOperation?.log('TODOIST_TASK_COMPLETED', `Task completed in Todoist: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        } else if (!todoistIsChecked && obsidianIsChecked) {
            await this.plugin.fileOperation!.uncompleteTaskInTheFile(taskId);
            new Notice(`Task ${taskId} reopened from Todoist`);
            this.plugin.logOperation?.log('TODOIST_TASK_REOPENED', `Task reopened in Todoist: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }

        // The due date is applied in every scope, for the same reason as completion:
        // its writer only swaps the date token (or inserts one before #todoist) and
        // leaves the rest of the line alone. It also has to be pulled — a field that
        // is not pulled but *is* pushed gets actively reverted in Todoist, because
        // the next push sees the vault's older value as a local change.
        const obsidianDueDate = this.plugin.taskParser!.getDueDateFromLineText(taskLine) || "";
        const todoistDueDate = task.due?.date ? (this.plugin.taskParser!.ISOStringToLocalDateString(task.due.date) || "") : "";
        if (obsidianDueDate !== todoistDueDate) {
            await this.plugin.fileOperation!.syncTaskDueDateToFile(taskId, task.due?.date || "");
            this.plugin.logOperation?.log('FILE_TASK_DUEDATE_SYNCED', `Synced due date: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }

        // The remaining writers rebuild parts of the task line — content is a
        // substring replace, and the label and priority writers normalise tag
        // order and collapse runs of spaces — so they can reformat or overwrite
        // text the user edited in Obsidian. Only apply them in the full scope.
        //
        // Note the consequence of leaving them out: for those fields Obsidian stays
        // authoritative, so a change made to them in Todoist is overwritten on the
        // next push. That is the trade the limited scope makes.
        if (this.plugin.settings.todoistToObsidianScope !== 'full') {
            this.plugin.debugLog(`[syncSingleTaskToObsidian] Task ${taskId}: limited scope, leaving line text untouched`);
            return;
        }

        const obsidianContent = this.plugin.taskParser!.getTaskContentFromLineText(taskLine);
        if (obsidianContent && task.content && obsidianContent !== task.content) {
            await this.plugin.fileOperation!.syncTaskContentToFile(taskId, task.content);
            this.plugin.logOperation?.log('FILE_TASK_CONTENT_SYNCED', `Synced content: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }

        const prioritySynced = await this.plugin.fileOperation!.syncTaskPriorityToFile(taskId, task.priority || 1);
        if (prioritySynced) {
            this.plugin.logOperation?.log('FILE_TASK_PRIORITY_SYNCED', `Synced priority: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }

        const labelsSynced = await this.plugin.fileOperation!.syncTaskLabelsToFile(taskId, task.labels || []);
        if (labelsSynced) {
            this.plugin.logOperation?.log('FILE_TASK_LABELS_SYNCED', `Synced labels: ${taskId}`, mapping.filePath, taskId, 'todoist→obsidian');
        }
    }

    private async syncNotesToObsidian(
        taskFileMapping: Record<string, { note_count?: number; syncEnabled?: boolean }>,
        noteMap: Map<string, any[]>,
        idMapping: Record<string, string>
    ): Promise<void> {
        // Build reverse map: newId → cacheId so we can look up noteMap entries
        // (keyed by new IDs from syncData) against taskFileMapping (keyed by
        // cache IDs which may be legacy numeric IDs).
        const reverseIdMap = new Map<string, string>();
        for (const [cacheId, resolvedId] of Object.entries(idMapping)) {
            if (resolvedId !== cacheId) {
                reverseIdMap.set(resolvedId, cacheId);
            }
        }

        for (const [noteTaskId, notes] of noteMap.entries()) {
            // noteTaskId is from syncData (new ID). Find corresponding cache ID.
            const taskId = reverseIdMap.get(noteTaskId) || noteTaskId;
            const mapping = taskFileMapping[taskId];
            if (!mapping) continue;
            if (mapping.syncEnabled === false) continue;

            const storedNoteCount = mapping.note_count || 0;
            if (notes.length <= storedNoteCount) continue;

            const sortedNotes = notes.sort((a: any, b: any) =>
                new Date(a.posted_at || a.added_at || 0).getTime() - new Date(b.posted_at || b.added_at || 0).getTime()
            );

            const newNotes = sortedNotes.slice(storedNoteCount);
            for (const note of newNotes) {
                try {
                    const dateStr = this.plugin.taskParser!.ISOStringToLocalDatetimeString(note.posted_at || note.added_at || '');
                    await this.plugin.fileOperation!.syncTaskNoteToFile(taskId, note.content || '', dateStr ?? '');
                    new Notice(`Note synced to task ${taskId}`);
                } catch (error) {
                    console.error(`[Todoist→Obsidian] Error syncing note for task ${taskId}:`, error);
                }
            }

            await this.plugin.cacheOperation!.updateTaskMappingSyncMeta(taskId, {
                note_count: notes.length
            });
        }
    }

    /**
     * Resolve legacy numeric task IDs to new string IDs via the REST API
     * ID mapping endpoint. Returns a map of oldId → newId for any IDs that
     * were translated; non-legacy IDs are excluded.
     */
    private async resolveTaskIds(taskIds: string[]): Promise<Record<string, string>> {
        const restApi = this.plugin.todoistRestAPI;
        if (!restApi) return {};
        try {
            return await restApi.resolveIds('tasks', taskIds);
        } catch (err) {
            console.warn('[Todoist→Obsidian] Failed to resolve legacy task IDs, proceeding with original IDs:', err);
            return {};
        }
    }

    async backupTodoistAllResources(): Promise<void> {
        try {
            const todoistSyncAPI = this.plugin.todoistSyncAPI;
            if (!todoistSyncAPI) {
                throw new Error('Todoist sync API is not initialized');
            }

            const resources = await todoistSyncAPI.getAllResources(true);

            const now: Date = new Date();
            const timeString = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

            const backupFolder = this.plugin.storagePathManager?.getBackupsTodoistPath() || 'ultimate-todoist-sync/backups/todoist';
            const tempFileName = `todoist-data-backup-${timeString}.tmp`;
            const fileName = `todoist-data-backup-${timeString}.json`;
            const tempPath = `${backupFolder}/${tempFileName}`;
            const fullPath = `${backupFolder}/${fileName}`;

            const adapter = this.app.vault.adapter;
            const folderExists = await adapter.exists(backupFolder);
            if (!folderExists) {
                await adapter.mkdir(backupFolder);
            }

            const jsonContent = JSON.stringify(resources, null, 2);
            
            await adapter.write(tempPath, jsonContent);
            const tempExists = await adapter.exists(tempPath);
            if (!tempExists) {
                throw new Error('Temp backup file was not created');
            }

            await adapter.write(fullPath, jsonContent);
            
            const verifyExists = await adapter.exists(fullPath);
            if (!verifyExists) {
                throw new Error('Backup file verification failed');
            }

            try {
                await adapter.remove(tempPath);
            } catch (cleanupError) {
                console.warn('[TodoistBackup] Failed to cleanup temp file:', cleanupError);
            }

            new Notice(`Todoist backup saved to ${fullPath}`);
            this.plugin.logOperation?.log('BACKUP_CREATED', `Todoist backup created: ${fullPath}`);
        } catch (error) {
            console.error("An error occurred while creating Todoist backup:", error);
            this.plugin.logOperation?.log('BACKUP_FAILED', `Backup failed: ${(error as Error).message}`);
            new Notice('Todoist backup failed');
        }
    }
}
