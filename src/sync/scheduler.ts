import UltimateTodoistSyncForObsidian from '../../main';

export class SyncScheduler {
	private plugin: UltimateTodoistSyncForObsidian;
	private inProgress = false;

	/**
	 * Pause between the pull and push phases, so vault writes from the pull are
	 * visible to the push. Only applied when the pull actually wrote something.
	 */
	private static readonly PULL_SETTLE_MS = 500;

	constructor(plugin: UltimateTodoistSyncForObsidian) {
		this.plugin = plugin;
	}

	async run(): Promise<void> {
		if (this.inProgress) {
			this.plugin.debugLog('Scheduled sync already in progress, skipping');
			return;
		}
		if (!await this.plugin.checkModuleClass()) return;

		this.inProgress = true;
		this.plugin.debugLog('Todoist scheduled synchronization task started at', new Date().toLocaleString());

		try {
			// Periodic full sync: every 24h, reset sync_token to force full sync
			const FULL_SYNC_INTERVAL = 24 * 60 * 60 * 1000;
			const lastFullSync = this.plugin.settings.lastFullSyncTime || 0;
			if (Date.now() - lastFullSync > FULL_SYNC_INTERVAL) {
				this.plugin.debugLog('Periodic full sync triggered');
				try {
					await this.plugin.todoistSyncAPI?.initializeSync();
					await this.plugin.safeSettings?.update({ lastFullSyncTime: Date.now() }, true);
				} catch (error) {
					console.error('[Scheduler] Periodic full sync failed:', error);
				}
			}

			let pulledCount = 0;
			await this.plugin.syncLockManager.run('todoistToObsidian', async () => {
				pulledCount = await this.plugin.todoistToObsidian!.syncTodoistToObsidian();
			});

			await this.plugin.saveSettings();

			// Let vault writes from the pull settle before the push phase reads
			// those files back. This used to be an unconditional 5s wait, which was
			// the single largest cost of a sync pass even when the pull wrote
			// nothing — and it is only needed when it did write.
			if (pulledCount > 0) {
				await new Promise(resolve => setTimeout(resolve, SyncScheduler.PULL_SETTLE_MS));
			}

			const filesToSync = this.getUniqueFiles();

			if (this.plugin.settings.debugMode) {
				this.plugin.debugLog('Files to sync:', filesToSync);
			}

			for (const fileKey of filesToSync) {
				if (this.plugin.settings.debugMode) {
					this.plugin.debugLog('Syncing file:', fileKey);
				}

				const lockOk = await this.plugin.syncLockManager.run('obsidianToTodoist', async () => {
					await this.plugin.obsidianToTodoist!.fullTextNewTaskCheck(fileKey);
				});
				if (!lockOk) {
					this.plugin.debugLog(`[Scheduler] Skipping file sync for ${fileKey}: lock not acquired`);
					continue;
				}

				await this.plugin.syncLockManager.run('obsidianToTodoist', async () => {
					await this.plugin.obsidianToTodoist!.deletedTaskCheck(fileKey);
				});

				await this.plugin.syncLockManager.run('obsidianToTodoist', async () => {
					await this.plugin.obsidianToTodoist!.fullTextModifiedTaskCheck(fileKey);
				});
			}
			// Periodic database check: every 72h, run three-way consistency check
			const DB_CHECK_INTERVAL = 72 * 60 * 60 * 1000;
			const lastDbCheck = this.plugin.settings.lastDatabaseCheckAutoTime || 0;
			if (Date.now() - lastDbCheck > DB_CHECK_INTERVAL) {
				this.plugin.debugLog('Periodic database check triggered');
				try {
					if (this.plugin.databaseChecker) {
						await this.plugin.databaseChecker.checkDatabase();
						await this.plugin.safeSettings?.update({ lastDatabaseCheckAutoTime: Date.now() }, true);
					}
				} catch (error) {
					console.error('[Scheduler] Periodic database check failed:', error);
				}
			}
		} catch (error) {
			console.error('An error occurred during scheduled sync:', error);
		} finally {
			try {
				await this.plugin.logOperation?.flushToFile();
			} catch (error) {
				console.error('An error occurred in flushToFile:', error);
			}
			this.inProgress = false;
			this.plugin.debugLog('Todoist scheduled synchronization task completed at', new Date().toLocaleString());
		}
	}

	private getUniqueFiles(): string[] {
		const seen = new Set<string>();
		for (const entry of Object.values(this.plugin.settings.taskFileMapping)) {
			seen.add(entry.filePath);
		}

		// Full Vault Sync: include all vault .md files not yet in taskFileMapping
		if (this.plugin.settings.enableFullVaultSync && this.plugin.fileOperation) {
			for (const file of this.plugin.app.vault.getMarkdownFiles()) {
				if (this.plugin.fileOperation.isFileExcludedFromSync(file.path)) continue;
				seen.add(file.path);
			}
		}

		return Array.from(seen);
	}
}
