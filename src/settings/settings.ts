import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";
import { DatabaseReportModal, ExcludedFoldersModal, LogViewerModal, TaskManagerModal } from '../ui/modals';
import type { DatabaseCheckIssue, DatabaseCheckResult } from '../data/databaseChecker';

export interface TaskIssueEntry {
    state: 'open' | 'resolved' | 'ignored';
    severity: 'low' | 'medium' | 'high';
    source: 'database_checker' | 'runtime';
    detectedAt: number;
    lastSeenAt: number;
    details?: string;
    expected?: string;
    actual?: string;
    manualAction?: string;
}

export interface TaskFileMappingEntry {
    filePath: string;
    status?: 'active' | 'nonActive' | 'conflicted' | 'issue';
    syncEnabled?: boolean;
    updated_at?: string;
    note_count?: number;
    /** Local epoch ms when this mapping was first created. Used as a grace window
     *  before a task may be deleted, since a freshly written todoist_id can be
     *  absent from the file text we read for a moment. */
    createdAt?: number;
    issues?: Record<string, TaskIssueEntry>;
}

export interface UltimateTodoistSyncSettings {
    initialized: boolean;
    todoistAPIToken: string;
    apiInitialized: boolean;
    defaultProjectName: string;
    defaultProjectId: string;
    automaticSynchronizationInterval: number;
    fileMetadata: Record<string, { defaultProjectId?: string }>;
    taskFileMapping: {
        [taskId: string]: TaskFileMappingEntry;
    };
    enableFullVaultSync: boolean;
    debugMode: boolean;
    useAppURI: boolean;
    syncEnabled: boolean;
    obsidianToTodoistEnabled: boolean;
    /**
     * How much of a vault edit is pushed to Todoist after the task exists.
     * 'create-and-complete' suits the common workflow where tasks are captured in
     * Obsidian and then worked on in Todoist, which makes Todoist authoritative.
     */
    obsidianToTodoistScope: 'create-and-complete' | 'full';
    todoistToObsidianEnabled: boolean;
    /** What a Todoist→Obsidian pull is allowed to change in the vault. */
    todoistToObsidianScope: 'status' | 'full';
    lastDatabaseCheckTime: number | null;
    syncDataCache: Record<string, any> | null;
    enableLog: boolean;
    logFileEnabled: boolean;
    maxLogFileSize: number;
    logRetentionPercent: number;
    maxBackupsPerFile: number;
    storageDirectory: string;
    lastStorageDirectory: string | null;
    conflictResolutionStrategy: 'todoist-wins' | 'obsidian-wins' | 'manual';
    lastFullSyncTime: number | null;
    lastDatabaseCheckAutoTime: number | null;
    primaryDeviceId: string;
    schemaVersion: number;
    excludedFolders: string[];
}

export const DEFAULT_SETTINGS: UltimateTodoistSyncSettings = {
    initialized: false,
    apiInitialized: false,
    todoistAPIToken: '',
    defaultProjectName: "Inbox",
    defaultProjectId: "",
    automaticSynchronizationInterval: 300,
    fileMetadata: {},
    taskFileMapping: {},
    enableFullVaultSync: false,
    debugMode: false,
    useAppURI: true,
    syncEnabled: true,
    obsidianToTodoistEnabled: true,
    obsidianToTodoistScope: 'full',
    todoistToObsidianEnabled: false,
    todoistToObsidianScope: 'status',
    lastDatabaseCheckTime: null,
    syncDataCache: null,
    enableLog: true,
    logFileEnabled: true,
    maxLogFileSize: 1024 * 1024,
    logRetentionPercent: 80,
    maxBackupsPerFile: 100,
    storageDirectory: 'ultimate-todoist-sync',
    lastStorageDirectory: null,
    conflictResolutionStrategy: 'manual',
    lastFullSyncTime: null,
    lastDatabaseCheckAutoTime: null,
    primaryDeviceId: '',
    schemaVersion: 1,
    excludedFolders: [],
}

export class UltimateTodoistSyncSettingTab extends PluginSettingTab {
    plugin: UltimateTodoistSyncForObsidian;

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private async applyDatabaseIssuesToMapping(result: DatabaseCheckResult): Promise<void> {
        const cacheOperation = this.plugin.cacheOperation;
        if (!cacheOperation) return;
        await cacheOperation.applyDatabaseCheckerIssues(result.issues as DatabaseCheckIssue[], true);
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Ultimate Todoist Sync Settings', cls: 'uts-settings-title' });

        // ============================================
        // API Configuration Section
        // ============================================
        containerEl.createEl('h3', { text: 'API Configuration', cls: 'uts-section-heading' });

        new Setting(containerEl)
            .setName('Todoist API Token')
            .setDesc('Enter your Todoist API token and click Connect.')
            .addText((text) => {
                text
                    .setPlaceholder('Enter your API token')
                    .setValue(this.plugin.settings.todoistAPIToken);
                text.inputEl.type = 'password';
                text.inputEl.addEventListener('blur', async () => {
                    const value = text.inputEl.value;
                    if (value !== this.plugin.settings.todoistAPIToken) {
                        await this.plugin.safeSettings?.update({ todoistAPIToken: value, apiInitialized: false });
                    }
                });
            })
            .addExtraButton((button) => {
                button.setIcon('eye')
                    .setTooltip('Toggle token visibility')
                    .onClick(() => {
                        const settingEl = button.extraSettingsEl.closest('.setting-item');
                        const inputEl = settingEl?.querySelector('input') as HTMLInputElement | null;
                        if (inputEl) {
                            const isHidden = inputEl.type === 'password';
                            inputEl.type = isHidden ? 'text' : 'password';
                            button.setIcon(isHidden ? 'eye-off' : 'eye');
                        }
                    });
            })
            .addButton((button) => {
                button.setButtonText('Connect');
                button.onClick(async () => {
                    // Save token from input before connecting (in case blur hasn't fired)
                    const settingEl = button.buttonEl.closest('.setting-item');
                    const inputEl = settingEl?.querySelector('input') as HTMLInputElement | null;
                    if (inputEl) {
                        const value = inputEl.value;
                        if (value !== this.plugin.settings.todoistAPIToken) {
                            await this.plugin.safeSettings?.update({ todoistAPIToken: value, apiInitialized: false });
                        }
                    }
                    button.setButtonText('Connecting...');
                    button.setDisabled(true);
                    try {
                        const result = await this.plugin.modifyTodoistAPI(this.plugin.settings.todoistAPIToken);
                        if (result) {
                            button.setButtonText('✓ Connected');
                        } else {
                            button.setButtonText('✗ Failed');
                            new Notice('Failed to connect to Todoist. Please check your API token.');
                        }
                    } catch (error) {
                        button.setButtonText('✗ Error');
                        new Notice(`Connection error: ${error instanceof Error ? error.message : String(error)}`);
                    } finally {
                        button.setDisabled(false);
                        setTimeout(() => {
                            button.setButtonText('Connect');
                        }, 2000);
                    }
                    this.display();
                });
            });

        // ============================================
        // Sync Settings Section
        // ============================================
        containerEl.createEl('h3', { text: 'Sync Settings', cls: 'uts-section-heading' });

        let intervalInputEl: HTMLInputElement | null = null;
        new Setting(containerEl)
            .setName('Automatic Sync Interval')
            .setDesc('Set interval in seconds (minimum 20). Example: 300 = every 5 minutes. Click Apply to save.')
            .addText((text) => {
                text
                    .setPlaceholder('e.g. 300')
                    .setValue(this.plugin.settings.automaticSynchronizationInterval.toString());
                text.inputEl.type = 'number';
                text.inputEl.min = '20';
                text.inputEl.step = '1';
                intervalInputEl = text.inputEl;
            })
            .addButton((button) => {
                button.setButtonText('Apply');
                button.onClick(async () => {
                    const rawValue = intervalInputEl?.value?.trim() ?? '';
                    const intervalNum = Number(rawValue);

                    if (rawValue === '' || Number.isNaN(intervalNum)) {
                        new Notice('Please enter a valid number.');
                        return;
                    }

                    if (!Number.isInteger(intervalNum)) {
                        new Notice('Please enter an integer.');
                        return;
                    }

                    if (intervalNum < 20) {
                        new Notice('Minimum interval is 20 seconds.');
                        return;
                    }

                    if (intervalNum === this.plugin.settings.automaticSynchronizationInterval) {
                        new Notice('Sync interval unchanged.');
                        return;
                    }

                    button.setButtonText('Applying...');
                    button.setDisabled(true);
                    try {
                        await this.plugin.safeSettings?.update({ automaticSynchronizationInterval: intervalNum }, true);
                        this.plugin.restartSyncSchedulerInterval();
                        new Notice('Sync interval updated and applied.');
                    } finally {
                        button.setDisabled(false);
                        button.setButtonText('Apply');
                    }
                });
            });

        const myProjectsOptions: Record<string, string> = {};
        const projects = this.plugin.todoistSyncAPI?.getSyncData()?.projects || [];
        for (const p of projects) {
            myProjectsOptions[p.id] = p.name;
        }

        new Setting(containerEl)
            .setName('Default Project')
            .setDesc('New tasks will be created in this project.')
            .addDropdown((component) => {
                if (!myProjectsOptions[this.plugin.settings.defaultProjectId]) {
                    component.addOption(this.plugin.settings.defaultProjectId, this.plugin.settings.defaultProjectName);
                }
                component
                    .addOptions(myProjectsOptions)
                    .setValue(this.plugin.settings.defaultProjectId)
                    .onChange(async (value) => {
                        const project = projects.find((p: any) => p.id === value);
                        await this.plugin.safeSettings?.update({
                            defaultProjectId: value,
                            defaultProjectName: project?.name || value
                        }, true)
                    });
            });

        new Setting(containerEl)
            .setName('Full Vault Sync')
            .setDesc('Sync all tasks in vault, not just those with #todoist tag.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.enableFullVaultSync)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ enableFullVaultSync: value }, true)
                        new Notice(`Full vault sync ${value ? 'enabled' : 'disabled'}.`)
                    })
            );

        // Excluded Folders — summary + Configure button
        this.renderExcludedFoldersSummary(containerEl);

        new Setting(containerEl)
            .setName('Use App URI Scheme')
            .setDesc('When enabled, generated task links use todoist:// (desktop app). When disabled, links use https://app.todoist.com/app/task/... (web).')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.useAppURI)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ useAppURI: value }, true)
                    })
            );

        new Setting(containerEl)
            .setName('Conflict Resolution Strategy')
            .setDesc('When a task is modified in both Obsidian and Todoist: todoist-wins overwrites Obsidian, obsidian-wins pushes Obsidian to Todoist, manual disables sync until resolved.')
            .addDropdown(component =>
                component
                    .addOption('manual', 'Manual (disable sync until resolved)')
                    .addOption('todoist-wins', 'Todoist wins (overwrite Obsidian)')
                    .addOption('obsidian-wins', 'Obsidian wins (overwrite Todoist)')
                    .setValue(this.plugin.settings.conflictResolutionStrategy)
                    .onChange(async (value: 'todoist-wins' | 'obsidian-wins' | 'manual') => {
                        await this.plugin.safeSettings?.update({ conflictResolutionStrategy: value }, true);
                        new Notice(`Conflict strategy set to: ${value}`);
                    })
            );

        // ============================================
        // Sync Direction Control Section
        // ============================================
        containerEl.createEl('h3', { text: 'Sync Direction', cls: 'uts-section-heading' });

        const syncStatusEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        const updateSyncStatus = () => {
            const mainEnabled = this.plugin.settings.syncEnabled;
            const o2tEnabled = this.plugin.settings.obsidianToTodoistEnabled;
            const t2oEnabled = this.plugin.settings.todoistToObsidianEnabled;

            let statusText = '';
            if (!mainEnabled) {
                statusText = '❌ Disabled';
            } else {
                const o2t = o2tEnabled ? '✅' : '❌';
                const t2o = t2oEnabled ? '✅' : '❌';
                statusText = `✅ Enabled (O→T: ${o2t}, T→O: ${t2o})`;
            }

            syncStatusEl.innerHTML = `<div><strong>Status:</strong> ${statusText}</div>`;
        };
        updateSyncStatus();

        new Setting(containerEl)
            .setName('Enable Sync')
            .setDesc('Master switch for all synchronization.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.syncEnabled)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ syncEnabled: value }, true);
                        updateSyncStatus();
                        new Notice(`Sync ${value ? 'enabled' : 'disabled'}`);
                    })
            );

        new Setting(containerEl)
            .setName('Obsidian → Todoist')
            .setDesc('Push changes from Obsidian to Todoist.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.obsidianToTodoistEnabled)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ obsidianToTodoistEnabled: value }, true);
                        updateSyncStatus();
                        new Notice(`Obsidian → Todoist ${value ? 'enabled' : 'disabled'}`);
                    })
            );

        new Setting(containerEl)
            .setName('Forward sync scope')
            .setDesc('Everything: keep Todoist matching the vault line — edits to the text, due date, priority and labels are pushed, and removing the line deletes the task. Create and complete: send new tasks and completion only, leaving everything else to Todoist. Choose the latter if you capture tasks in Obsidian and then work on them in Todoist, since a vault line that has drifted will otherwise overwrite what you did there.')
            .addDropdown(dropdown =>
                dropdown
                    .addOption('full', 'Everything (text, due date, priority, labels, deletions)')
                    .addOption('create-and-complete', 'Create and complete only (Todoist owns the rest)')
                    .setValue(this.plugin.settings.obsidianToTodoistScope)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ obsidianToTodoistScope: value as 'create-and-complete' | 'full' }, true);
                        new Notice(value === 'full'
                            ? 'Forward sync: pushing every field'
                            : 'Forward sync: new tasks and completion only');
                    })
            );

        // Created after the two settings below so it renders underneath them.
        let reverseSyncWarningEl: HTMLElement;
        const updateReverseSyncWarning = () => {
            if (!reverseSyncWarningEl) return;
            const enabled = this.plugin.settings.todoistToObsidianEnabled;
            const full = this.plugin.settings.todoistToObsidianScope === 'full';
            if (enabled && full) {
                reverseSyncWarningEl.style.cssText = 'color: var(--text-error); font-weight: 600; margin: 6px 0 12px 0;';
                reverseSyncWarningEl.textContent = '⚠️ Warning: in "Everything" scope, pulls rewrite the task line — tag order and spacing are normalised, and text you edited in Obsidian can be overwritten by the Todoist version. Back up your vault before relying on it.';
            } else if (enabled) {
                reverseSyncWarningEl.style.cssText = 'margin: 6px 0 12px 0;';
                reverseSyncWarningEl.textContent = 'Pulling completion and due date: a task ticked or re-dated in Todoist is updated in your vault, and nothing else on the line is touched. Content, priority and labels stay owned by Obsidian — changing those in Todoist will be overwritten.';
            } else {
                reverseSyncWarningEl.style.cssText = 'margin: 6px 0 12px 0;';
                reverseSyncWarningEl.textContent = 'Changes made in Todoist are not applied to your vault. Note that with this off, a task edited in Todoist keeps its Obsidian version — the next edit here pushes over it.';
            }
        };

        new Setting(containerEl)
            .setName('Todoist → Obsidian')
            .setDesc('Apply changes made in Todoist to your vault. Use the scope below to choose what a pull is allowed to change.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.todoistToObsidianEnabled)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ todoistToObsidianEnabled: value }, true);
                        updateSyncStatus();
                        updateReverseSyncWarning();
                        new Notice(`Todoist → Obsidian ${value ? 'enabled' : 'disabled'}`);
                    })
            );

        new Setting(containerEl)
            .setName('Reverse sync scope')
            .setDesc('Completion and due date: tick/untick the checkbox and update the date, leaving the rest of the line alone. Everything: also apply content, priority and labels, and append Todoist comments as sub-items — note that fields left out here are owned by Obsidian, so changing them in Todoist gets overwritten on the next push.')
            .addDropdown(dropdown =>
                dropdown
                    .addOption('status', 'Completion and due date (recommended)')
                    .addOption('full', 'Everything (also content, priority, labels, notes)')
                    .setValue(this.plugin.settings.todoistToObsidianScope)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ todoistToObsidianScope: value as 'status' | 'full' }, true);
                        updateReverseSyncWarning();
                        new Notice(`Reverse sync scope: ${value === 'full' ? 'everything' : 'completion and due date'}`);
                    })
            );

        reverseSyncWarningEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        updateReverseSyncWarning();

        // ============================================
        // Device Management Section
        // ============================================
        containerEl.createEl('h3', { text: 'Device Management', cls: 'uts-section-heading' });

        // Device status display
        const deviceStatusEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        const updateDeviceStatus = () => {
            const thisDeviceId = this.plugin.cachedDeviceId || '(loading...)';
            const primaryId = this.plugin.settings.primaryDeviceId || '(none)';
            const isPrimary = this.plugin.isPrimaryDevice();
            const role = isPrimary ? 'Primary' : 'Secondary (read-only)';
            const roleIcon = isPrimary ? '\u2705' : '\ud83d\udcf1';
            deviceStatusEl.innerHTML = `<div><strong>This Device:</strong> <code>${thisDeviceId}</code></div><div><strong>Primary Device:</strong> <code>${primaryId}</code></div><div><strong>Role:</strong> ${roleIcon} ${role}</div>`;
        };
        updateDeviceStatus();

        new Setting(containerEl)
            .setName('Set as Primary Device')
            .setDesc('Only the primary device pushes changes to Todoist. Secondary devices are read-only (sync disabled entirely).')
            .addButton(button => button
                .setButtonText(this.plugin.isPrimaryDevice() ? 'Already Primary' : 'Switch to Primary')
                .setDisabled(this.plugin.isPrimaryDevice())
                .onClick(async () => {
                    const deviceId = this.plugin.cachedDeviceId;
                    if (!deviceId) {
                        new Notice('Device ID not available yet. Please wait for plugin initialization.');
                        return;
                    }
                    await this.plugin.safeSettings?.update({ primaryDeviceId: deviceId }, true);
                    updateDeviceStatus();
                    this.display();
                    new Notice('This device is now the primary device. Please reload the plugin to activate sync.');
                })
            );

                // ============================================
        // Tools Section
        // ============================================
        containerEl.createEl('h3', { text: 'Tools', cls: 'uts-section-heading' });

        new Setting(containerEl)
            .setName('Manual Sync')
            .setDesc('Manually trigger a sync now.')
            .addButton(button => button
                .setButtonText('Sync Now')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first')
                        return
                    }
                    try {
                        await this.plugin.scheduler?.run()
                        new Notice('Sync completed.')
                    } catch (error) {
                        new Notice(`Sync error: ${error}`)
                    }
                })
            );

        const checkStatusEl = containerEl.createEl('div', { cls: 'setting-item-description' });
        const updateCheckStatus = () => {
            const lastCheck = this.plugin.settings.lastDatabaseCheckTime
                ? new Date(this.plugin.settings.lastDatabaseCheckTime).toLocaleString()
                : 'Never';
            checkStatusEl.innerHTML = `<div><strong>Last Check:</strong> ${lastCheck}</div>`;
        };
        updateCheckStatus();

        new Setting(containerEl)
            .setName('Verify Database')
            .setDesc('Run a read-only health check across Vault, Todoist, and mapping (match-first). No data will be changed.')
            .addButton(button => button
                .setButtonText('Run Verification')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first');
                        return;
                    }
                    if (!this.plugin.databaseChecker) {
                        new Notice('Database checker not initialized');
                        return;
                    }
                    const verifyNotice = new Notice('Verifying database...', 0);
                    try {
                        const result = await this.plugin.databaseChecker.checkDatabase((msg) => {
                            verifyNotice.setMessage(msg);
                        });
                        await this.applyDatabaseIssuesToMapping(result);
                        verifyNotice.hide();
                        const todoistCount = this.plugin.todoistSyncAPI?.getSyncData()?.items?.length ?? 0;
                        const vaultCount = Object.keys(this.plugin.settings.taskFileMapping).length;
                        const settledCount = result.summary.taskNonActive;
                        const settledSuffix = settledCount > 0 ? ` + ${settledCount} settled` : '';
                        const status = result.success
                            ? `✅ Healthy${settledSuffix}`
                            : `⚠️ ${result.actionableIssues} issues${settledSuffix}`;
                        new Notice(
                            `Verify complete — ${status}\nTodoist: ${todoistCount} tasks | Vault: ${vaultCount} mapped tasks`,
                            8000
                        );
                        if (result.reportPath) {
                            new DatabaseReportModal(this.app, this.plugin, result.reportPath).open();
                        }
                    } catch (error) {
                        verifyNotice.hide();
                        new Notice(`Verify error: ${error instanceof Error ? error.message : String(error)}`);
                    }
                })
            );

        new Setting(containerEl)
            .setName('Fix Database')
            .setDesc('Run safe auto-repair for eligible issues only: (A) repair missing/stale mapping when Vault and Todoist already match, (B) mark completed-in-Vault and confirmed-missing-in-Todoist tasks as nonActive, (C) re-check every task reported missing in Todoist by asking Todoist directly — tasks merely completed there are settled, and ones Todoist still has are put back into sync. Then re-check and report what still needs manual handling.')
            .addButton(button => button
                .setButtonText('Run Safe Repair')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first');
                        return;
                    }
                    if (!this.plugin.databaseChecker) {
                        new Notice('Database checker not initialized');
                        return;
                    }
                    if (!this.plugin.cacheOperation) {
                        new Notice('Cache operation not initialized');
                        return;
                    }
                    if (!this.plugin.syncLockManager) {
                        new Notice('Sync lock manager not initialized');
                        return;
                    }

                    const databaseChecker = this.plugin.databaseChecker;
                    const cacheOperation = this.plugin.cacheOperation;
                    const syncLockManager = this.plugin.syncLockManager;
                    let lockAcquired = false;

                    const progressNotice = new Notice('Step 1/3: Checking database...', 0);
                    try {
                        lockAcquired = await syncLockManager.acquireExclusive();
                        if (!lockAcquired) {
                            throw new Error('Unable to acquire lock for safe repair. Please retry in a few seconds.');
                        }

                        // Step 1: Initial check
                        const before = await databaseChecker.checkDatabase((msg) => {
                            progressNotice.setMessage(`Step 1/3: ${msg}`);
                        });
                        if (before.success) {
                            progressNotice.hide();
                            await this.plugin.safeSettings?.update({
                                lastDatabaseCheckTime: Date.now()
                            }, true);
                            updateSyncStatus();
                            updateCheckStatus();
                            new Notice('✅ Database is healthy.');
                            return;
                        }

                        progressNotice.setMessage(`Step 2/4: Found ${before.totalIssues} issues. Applying safe auto-repair...`);
                        const autoRepairResult = await cacheOperation.applyMatchFirstAutoRepairs(before.issues as DatabaseCheckIssue[], true);
                        const autoRepairParts: string[] = [];
                        autoRepairParts.push(`🔧 Mapping repaired: ${autoRepairResult.mappingRepaired}`);
                        autoRepairParts.push(`📋 Marked nonActive: ${autoRepairResult.nonActiveMarked}`);
                        if (autoRepairResult.skipped > 0) {
                            autoRepairParts.push(`⏭️ Skipped: ${autoRepairResult.skipped}`);
                        }
                        new Notice(autoRepairParts.join(' · '), 7000);

                        // Ask Todoist directly about every task flagged as missing:
                        // most of them were merely completed there.
                        progressNotice.setMessage('Step 3/4: Re-checking tasks reported missing in Todoist...');
                        const missingResult = await cacheOperation.reclassifyMissingTaskIssues((doneCount, total) => {
                            progressNotice.setMessage(`Step 3/4: Checking task ${doneCount}/${total} against Todoist...`);
                        });
                        if (missingResult.migrated + missingResult.completed + missingResult.restored + missingResult.stillMissing + missingResult.unresolved > 0) {
                            const missingParts: string[] = [];
                            if (missingResult.migrated > 0) missingParts.push(`🆔 Legacy IDs migrated: ${missingResult.migrated}`);
                            if (missingResult.completed > 0) missingParts.push(`✅ Completed in Todoist: ${missingResult.completed}`);
                            if (missingResult.restored > 0) missingParts.push(`🔄 Restored to sync: ${missingResult.restored}`);
                            if (missingResult.stillMissing > 0) missingParts.push(`🗑️ Confirmed deleted: ${missingResult.stillMissing}`);
                            if (missingResult.unresolved > 0) missingParts.push(`❓ Could not check: ${missingResult.unresolved}`);
                            new Notice(missingParts.join(' · '), 8000);
                        }

                        progressNotice.setMessage('Step 4/4: Re-checking database...');
                        const after = await databaseChecker.checkDatabase((msg) => {
                            progressNotice.setMessage(`Step 4/4: ${msg}`);
                        });
                        await this.applyDatabaseIssuesToMapping(after);
                        progressNotice.hide();
                        const fixedCount = Math.max(0, before.actionableIssues - after.actionableIssues);
                        const remainingCount = after.actionableIssues;
                        await this.plugin.safeSettings?.update({
                            lastDatabaseCheckTime: Date.now()
                        }, true);
                        updateSyncStatus();
                        updateCheckStatus();
                        if (after.success) {
                            new Notice(`✅ Fixed ${fixedCount} issues. Database is healthy.`);
                        } else {
                            new Notice(
                                `⚠️ Fixed ${fixedCount} issues via safe auto-repair. ${remainingCount} remain for manual handling.`,
                                8000
                            );
                        }
                        if (after.reportPath) {
                            new Notice(`Report: ${after.reportPath}`, 5000);
                        }
                        if (after.summary.staleTodoistLink > 0) {
                            new Notice(`🔗 Found ${after.summary.staleTodoistLink} stale Todoist links. Please repair them manually in Manage Problem Tasks.`, 8000);
                        }
                    } catch (error) {
                        progressNotice.hide();
                        new Notice(`Fix Database error: ${error instanceof Error ? error.message : String(error)}`);
                    } finally {
                        if (lockAcquired) {
                            syncLockManager.release();
                        }
                    }
                })
            );


        new Setting(containerEl)
            .setName('Manage Problem Tasks')
            .setDesc('Open the task manager to manually resolve unresolved conflicts, stale links, and issue tasks that require decisions.')
            .addButton(button => button
                .setButtonText('Open Task Manager')
                .onClick(() => {
                    new TaskManagerModal(this.app, this.plugin).open();
                })
            );

        // ============================================
        // Logs & Debug Section
        // ============================================
        containerEl.createEl('h3', { text: 'Logs & Debug', cls: 'uts-section-heading' });

        new Setting(containerEl)
            .setName('Enable Logging')
            .setDesc('Log file modifications and sync operations.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.enableLog)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ enableLog: value }, true)
                    })
            );

        new Setting(containerEl)
            .setName('Debug Mode')
            .setDesc('Output detailed logs to console for troubleshooting.')
            .addToggle(component =>
                component
                    .setValue(this.plugin.settings.debugMode)
                    .onChange(async (value) => {
                        await this.plugin.safeSettings?.update({ debugMode: value }, true)
                    })
            );

        new Setting(containerEl)
            .setName('View Logs')
            .setDesc('Browse, search and filter operation logs.')
            .addButton(button => button
                .setButtonText('View')
                .onClick(() => {
                    new LogViewerModal(this.app, this.plugin).open();
                })
            );

        // ============================================
        // Backup & Recovery Section
        // ============================================
        containerEl.createEl('h3', { text: 'Backup & Recovery', cls: 'uts-section-heading' });

        let storageDirectoryInputEl: HTMLInputElement | null = null;
        new Setting(containerEl)
            .setName('Storage Directory')
            .setDesc('Directory for plugin data storage. Click Apply to confirm and migrate existing data.')
            .addText((text) => {
                text
                    .setPlaceholder('ultimate-todoist-sync')
                    .setValue(this.plugin.settings.storageDirectory);
                storageDirectoryInputEl = text.inputEl;
            })
            .addButton((button) => {
                button.setButtonText('Apply');
                button.onClick(async () => {
                    const newDir = storageDirectoryInputEl?.value?.trim() ?? '';
                    const currentDir = this.plugin.settings.storageDirectory;

                    if (!newDir) {
                        new Notice('Directory name cannot be empty');
                        return;
                    }

                    if (newDir === currentDir) {
                        new Notice('Storage directory unchanged.');
                        return;
                    }

                    const confirmed = confirm(
                        `Change storage directory from "${currentDir}" to "${newDir}"?\n\n` +
                        'Existing data will be migrated to the new location.'
                    );
                    if (!confirmed) return;

                    button.setButtonText('Applying...');
                    button.setDisabled(true);
                    try {
                        if (this.plugin.storagePathManager) {
                            const success = await this.plugin.storagePathManager.migrateToNewDirectory(newDir);
                            if (success) {
                                await this.plugin.safeSettings?.update({ storageDirectory: newDir }, true);
                                new Notice('Storage directory changed. Please reload the plugin.');
                            } else {
                                new Notice('Migration failed. Check console for details.');
                            }
                        } else {
                            await this.plugin.safeSettings?.update({ storageDirectory: newDir }, true);
                            new Notice('Storage directory updated. Please reload the plugin.');
                        }
                    } finally {
                        button.setDisabled(false);
                        button.setButtonText('Apply');
                    }
                });
            });

        new Setting(containerEl)
            .setName('Backup Todoist Data')
            .setDesc('Backup all Todoist data to vault.')
            .addButton(button => button
                .setButtonText('Backup')
                .onClick(async () => {
                    if (!this.plugin.settings.apiInitialized) {
                        new Notice('Please set the Todoist API first')
                        return
                    }

                    if (!this.plugin.todoistToObsidian) {
                        new Notice('Todoist backup module not initialized');
                        return;
                    }

                    const todoistToObsidian = this.plugin.todoistToObsidian;

                    button.setButtonText('Backing up...');
                    button.setDisabled(true);
                    try {
                        await todoistToObsidian.backupTodoistAllResources();
                        new Notice('Todoist data backup completed.');
                    } catch (error) {
                        new Notice(`Backup failed: ${error instanceof Error ? error.message : String(error)}`);
                    } finally {
                        button.setButtonText('Backup');
                        button.setDisabled(false);
                    }
                })
            );

        new Setting(containerEl)
            .setName('Backup Settings')
            .setDesc('Manually backup current settings.')
            .addButton(button => button
                .setButtonText('Backup')
                .onClick(async () => {
                    if (!this.plugin.settingsBackup) {
                        new Notice('Settings backup not initialized')
                        return;
                    }
                    const success = await this.plugin.settingsBackup.backup();
                    new Notice(success ? 'Settings backed up.' : 'Backup failed.');
                })
            );

		new Setting(containerEl)
			.setName('Restore Settings')
			.setDesc('Restore settings from latest backup.')
			.addButton(button => button
				.setButtonText('Restore')
				.onClick(async () => {
					if (!this.plugin.safeSettings) {
						new Notice('Settings backup not initialized')
						return;
					}
					const success = await this.plugin.safeSettings.restoreFromLatestBackup();
					if (success) {
						new Notice('Settings restored and reloaded.');
					}
				})
			);

        new Setting(containerEl)
            .setName('View Backup History')
            .setDesc('View available settings backups.')
            .addButton(button => button
                .setButtonText('View')
                .onClick(async () => {
                    if (!this.plugin.settingsBackup) {
                        new Notice('Not initialized')
                        return;
                    }
                    const backups = await this.plugin.settingsBackup.getBackupList();
                    if (backups.length === 0) {
                        new Notice('No backups found');
                        return;
                    }
                    let msg = 'Backups:\n';
                    backups.slice(0, 5).forEach((b, i) => {
                        msg += `${i + 1}. ${b.split('/').pop()}\n`;
                    });
                    new Notice(msg, 8000);
                })
            );

        new Setting(containerEl)
            .setName('Reset Settings')
            .setDesc('Reset all settings to defaults. WARNING: Will lose all task mappings!')
            .addButton(button => {
                button.setButtonText('Reset');
                button.setWarning();
                button.onClick(async () => {
                    const confirmed = confirm('Reset ALL settings to defaults? All task mappings will be lost!');
                    if (!confirmed) return;

                    await this.plugin.safeSettings?.reset();
                    new Notice('Settings reset. Please reload the plugin.');
                });
            });
    }

    private renderExcludedFoldersSummary(containerEl: HTMLElement): void {
        const excluded = this.plugin.settings.excludedFolders;

        const setting = new Setting(containerEl)
            .setName('Excluded Folders from Sync')
            .addButton(btn => btn
                .setButtonText('Configure')
                .onClick(() => {
                    new ExcludedFoldersModal(this.app, this.plugin, () => {
                        this.display();
                    }).open();
                })
            );

        if (excluded.length === 0) {
            setting.setDesc('All folders are included in sync. Click Configure to exclude specific folders.');
        } else {
            setting.setDesc(`${excluded.length} folder(s) excluded from Todoist sync.`);
            const listEl = setting.settingEl.createDiv({ cls: 'uts-excluded-folders-summary' });
            for (const folder of excluded) {
                listEl.createDiv({ text: folder, cls: 'uts-excluded-folders-summary-item' });
            }
        }
    }
}
