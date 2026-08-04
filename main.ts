import { MarkdownView, Notice, Plugin, Editor } from 'obsidian';

import { UltimateTodoistSyncSettings, DEFAULT_SETTINGS, UltimateTodoistSyncSettingTab } from './src/settings/settings';
import { TodoistRestAPI } from './src/api/restApi';
import { TodoistSyncAPI } from './src/api/syncApi';
import { TaskParser } from './src/data/taskParser';
import { CacheOperation } from './src/data/cache';
import { FileOperation } from './src/vault/fileOperation';
import { LogOperation } from './src/storage/log';
import { BackupOperation } from './src/storage/backup';
import { ObsidianToTodoistSync } from './src/sync/toTodoist';
import { TodoistToObsidianSync } from './src/sync/toObsidian';
import { DatabaseChecker } from './src/data/databaseChecker';
import { DeviceManager } from './src/utils/deviceManager';
import { StoragePathManager } from './src/storage/pathManager';
import { SafeSettings, SettingsBackup } from './src/settings/safeSettings';

import { SyncLockManager } from './src/sync/syncLock';
import { SyncScheduler } from './src/sync/scheduler';
import { EventHandlers } from './src/plugin/eventHandlers';
import { SetDefalutProjectInTheFilepathModal, TaskManagerModal } from './src/ui/modals';

export default class UltimateTodoistSyncForObsidian extends Plugin {
	settings: UltimateTodoistSyncSettings;
	todoistRestAPI: TodoistRestAPI | undefined;
	todoistSyncAPI: TodoistSyncAPI | undefined;
	taskParser: TaskParser | undefined;
	cacheOperation: CacheOperation | undefined;
	fileOperation: FileOperation | undefined;
	obsidianToTodoist: ObsidianToTodoistSync | undefined;
	todoistToObsidian: TodoistToObsidianSync | undefined;
	logOperation: LogOperation | undefined;
	backupOperation: BackupOperation | undefined;
	databaseChecker: DatabaseChecker | undefined;
	deviceManager: DeviceManager | undefined;
	storagePathManager: StoragePathManager | undefined;
	settingsBackup: SettingsBackup | undefined;
	safeSettings: SafeSettings | undefined;
	lastLines: Map<string, number>;
	statusBar: ReturnType<Plugin['addStatusBarItem']>;
	saveLock: boolean;
	isProcessingModify: boolean;
	isSyncingFromTodoist: boolean;
	cachedDeviceId: string;
	loadSucceeded: boolean;

	syncLockManager: SyncLockManager;

	scheduler: SyncScheduler;
	private eventHandlers: EventHandlers;
	private lastApiNoticeTime = 0;
	private syncIntervalId: number | null = null;

	debugLog(...args: unknown[]): void {
		if (this.settings?.debugMode) {
			console.log('[TodoistSync]', ...args);
		}
	}

	async onload() {
		this.loadSucceeded = false;
		this.saveLock = false;
		this.isSyncingFromTodoist = false;
		this.cachedDeviceId = '';
		this.syncLockManager = new SyncLockManager(this);
		this.safeSettings = new SafeSettings(this);

		const isSettingsLoaded = await this.safeSettings.load();
		this.loadSucceeded = isSettingsLoaded;
		if (!isSettingsLoaded) {
			new Notice('Settings failed to load. Please reload the ultimate todoist sync plugin.');
			return;
		}

		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new UltimateTodoistSyncSettingTab(this.app, this));

		// No API token → not configured yet (fresh install or data.json not synced)
		// Don't generate deviceId, don't initialize anything — just show settings tab
		if (!this.settings.todoistAPIToken) {
			new Notice('Please enter your Todoist API.');
			return;
		}

		// API token exists → data.json is present → safe to read/generate device-id
		const earlyDeviceManager = new DeviceManager(this.app, this);
		this.cachedDeviceId = await earlyDeviceManager.getDeviceId();

		// Non-primary device: only keep settings tab + status bar, skip everything else
		if (this.settings.primaryDeviceId !== '' && this.settings.primaryDeviceId !== this.cachedDeviceId) {
			this.statusBar.setText('\ud83d\udcf1 Secondary');
			new Notice('Todoist Sync: Secondary device \u2014 sync disabled. Use settings to claim as primary.');
			return;
		}

		// Primary device (or unclaimed) → full initialization
		await this.initializePlugin();

		this.lastLines = new Map();
		this.scheduler = new SyncScheduler(this);
		this.eventHandlers = new EventHandlers(this);
		this.eventHandlers.register();

		this.restartSyncSchedulerInterval();

		this.app.workspace.on('active-leaf-change', () => {
			this.setStatusBarText();
		});

		this.addCommand({
			id: 'set-default-project-for-todoist-task-in-the-current-file',
			name: 'Set default project for todoist task in the current file',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (!view) return;
				const filepath = view.file.path;
				new SetDefalutProjectInTheFilepathModal(this.app, this, filepath);
			}
		});

		this.addCommand({
			id: 'open-task-manager',
			name: 'Open Task Manager',
			callback: () => {
				new TaskManagerModal(this.app, this).open();
			}
		});
	}

	async onunload() {
		this.debugLog('Ultimate Todoist Sync for Obsidian is unloaded!');
		try {
			await this.logOperation?.flushToFile();
		} catch (error) {
			console.error('An error occurred in flushToFile:', error);
		}
		if (this.loadSucceeded) {
			await this.saveSettings();
		} else {
			console.warn('[Plugin] Skipping saveSettings on unload — load did not succeed');
		}
	}

	async loadSettings(): Promise<boolean> {
		return this.safeSettings!.load();
	}

	async saveSettings(): Promise<boolean> {
		return this.safeSettings!.save();
	}

	restartSyncSchedulerInterval(): void {
		if (!this.scheduler) return;

		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
		}

		const scheduler = this.scheduler;
		this.syncIntervalId = window.setInterval(async () => await scheduler.run(), this.settings.automaticSynchronizationInterval * 1000);
		this.registerInterval(this.syncIntervalId);
	}

	async modifyTodoistAPI(api: string): Promise<boolean> {
		const result = await this.initializePlugin();
		return result === true;
	}

	async initializePlugin() {
		this.todoistRestAPI = new TodoistRestAPI(this.app, this);
		this.logOperation = new LogOperation(this.app, this);
		this.cacheOperation = new CacheOperation(this.app, this);
		const isProjectsSaved = await this.cacheOperation.saveProjectsToCache();

		if (!isProjectsSaved) {
			this.todoistRestAPI = undefined;
			this.todoistSyncAPI = undefined;
			this.taskParser = undefined;
			this.cacheOperation = undefined;
			this.fileOperation = undefined;
			this.obsidianToTodoist = undefined;
			this.todoistToObsidian = undefined;
			this.logOperation = undefined;
			this.backupOperation = undefined;
			await this.safeSettings?.update({ initialized: false, apiInitialized: false }, true);
			new Notice(`Ultimate Todoist Sync plugin initialization failed, please check the todoist api`);
			return;
		}

		if (!this.settings.initialized) {
			try {
				await this.initializeModuleClass();
				await this.todoistToObsidian!.backupTodoistAllResources();
			} catch (error) {
				this.debugLog(`error creating user data folder: ${error}`);
				await this.safeSettings?.update({ initialized: false, apiInitialized: false }, true);
				new Notice(`error creating user data folder`);
				return;
			}
			await this.safeSettings?.update({ initialized: true }, true);
			new Notice(`Ultimate Todoist Sync initialization successful. Todoist data has been backed up.`);
		} else {
			await this.initializeModuleClass();
		}

		await this.safeSettings?.update({ apiInitialized: true });
		this.syncLockManager.release();

		// Auto-claim primary device if no primary is set yet
		if (this.settings.primaryDeviceId === '' && this.cachedDeviceId) {
			await this.safeSettings?.update({ primaryDeviceId: this.cachedDeviceId }, true);
			this.debugLog('[Plugin] Auto-claimed as primary device: ' + this.cachedDeviceId);
		}

		this.logOperation?.log('PLUGIN_INITIALIZED', 'Plugin initialized successfully');
		const startupDatabaseCheckSucceeded = await this.runStartupDatabaseCheck();
		if (startupDatabaseCheckSucceeded) {
			new Notice(`Ultimate Todoist Sync loaded successfully.`);
		} else {
			new Notice(`Ultimate Todoist Sync loaded with startup sync warnings. Please check console logs.`, 8000);
		}
		return true;
	}

	async runStartupDatabaseCheck(): Promise<boolean> {
		try {
			if (!this.databaseChecker) {
				this.debugLog('Database checker not initialized, skipping startup check');
				return true;
			}
			this.debugLog('Running startup database check...');
			const result = await this.databaseChecker.checkDatabase();
			await this.safeSettings?.update({
				lastDatabaseCheckTime: Date.now()
			}, true);

			const startupCheckFailed = result.issues.some((issue) =>
				issue.type === 'issue_unclassified' && issue.details.startsWith('Database check failed:')
			);
			if (startupCheckFailed) {
				new Notice('Startup database check failed to reach Todoist. Please verify network/API status and try sync again.', 10000);
				return false;
			}

			if (result.success) {
				this.debugLog('Startup database check passed');
				return true;
			} else {
				// Settled tasks are excluded: a completed task that has left Todoist's
				// active set is a normal end state, and reporting it on every launch
				// trained the warning to be ignored.
				const settled = result.summary.taskNonActive;
				const settledNote = settled > 0 ? ` (${settled} settled task(s) need no action.)` : '';
				new Notice(`Found ${result.actionableIssues} database issue(s). Please use "Fix Database" in settings to resolve them.${settledNote}`);
				return true;
			}
		} catch (error) {
			console.error('Startup database check failed:', error);
			return false;
		}
	}

	async initializeModuleClass() {
		this.todoistRestAPI = new TodoistRestAPI(this.app, this);
		this.cacheOperation = new CacheOperation(this.app, this);
		this.taskParser = new TaskParser(this.app, this);
		this.fileOperation = new FileOperation(this.app, this);
		this.todoistSyncAPI = new TodoistSyncAPI(this.app, this);
		this.obsidianToTodoist = new ObsidianToTodoistSync(this.app, this);
		this.todoistToObsidian = new TodoistToObsidianSync(this.app, this);
		this.backupOperation = new BackupOperation(this.app, this);
		this.databaseChecker = new DatabaseChecker(this.app, this);
		this.deviceManager = new DeviceManager(this.app, this);
		this.cachedDeviceId = await this.deviceManager.getDeviceId();
		this.storagePathManager = new StoragePathManager(this.app, this);

		this.storagePathManager.ensureAllDirs().catch(error => {
			console.error('[Plugin] Failed to create storage directories:', error);
		});

		this.logOperation?.loadFromFile().catch(error => {
			console.error('[Plugin] Failed to load logs from file:', error);
		});

		try {
			const loaded = this.todoistSyncAPI?.loadFromCache();
			if (!loaded) {
				await this.todoistSyncAPI?.initializeSync();
			} else {
				this.debugLog('[Plugin] Loaded sync cache from settings; startup database check will refresh incrementally.');
			}
		} catch (error) {
			console.error('[Plugin] Failed to initialize sync:', error);
		}
	}

	isPrimaryDevice(): boolean {
		return this.settings.primaryDeviceId !== '' && this.settings.primaryDeviceId === this.cachedDeviceId;
	}

	async checkModuleClass(): Promise<boolean> {
		if (this.settings.apiInitialized === true) {
			if (
				this.todoistRestAPI === undefined ||
				this.todoistSyncAPI === undefined ||
				this.cacheOperation === undefined ||
				this.fileOperation === undefined ||
				this.obsidianToTodoist === undefined ||
				this.taskParser === undefined ||
				this.deviceManager === undefined
			) {
				await this.initializeModuleClass();
			}
			return true;
		} else {
			const now = Date.now();
			if (now - this.lastApiNoticeTime > 60_000) {
				new Notice(`Please enter the correct Todoist API token`);
				this.lastApiNoticeTime = now;
			}
			return false;
		}
	}

	async setStatusBarText() {
		if (!await this.checkModuleClass()) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			this.statusBar.setText('');
		} else {
			const filepath = view.file?.path;
			if (filepath === undefined) {
				this.debugLog('file path undefined');
				return;
			}
			const defaultProjectName = await this.cacheOperation!.getDefaultProjectNameForFilepath(filepath);
			if (defaultProjectName === undefined) {
				this.debugLog('projectName undefined');
				return;
			}
			this.statusBar.setText(defaultProjectName);
		}
	}
}
