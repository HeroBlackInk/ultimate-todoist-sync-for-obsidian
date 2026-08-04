import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../../main';

export class StoragePathManager {
    private app: App;
    private plugin: UltimateTodoistSyncForObsidian;
    private appendLock = false;

    static settingsFilePath(manifestDir: string | undefined): string {
        const dir = manifestDir || `.obsidian/plugins/ultimate-todoist-sync`;
        return `${dir}/data.json`;
    }

    static settingsTempFilePath(manifestDir: string | undefined): string {
        const dir = manifestDir || `.obsidian/plugins/ultimate-todoist-sync`;
        return `${dir}/data.json.tmp`;
    }
    static readonly DEFAULT_BASE_PATH = 'ultimate-todoist-sync';
    static readonly LEGACY_BASE_PATH = '.ultimate-todoist-sync';

    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    getBasePath(): string {
        return this.plugin.settings?.storageDirectory || StoragePathManager.DEFAULT_BASE_PATH;
    }

    getLogsBasePath(): string {
        return `${this.getBasePath()}/logs`;
    }

    getLogFilePath(): string {
        return `${this.getLogsBasePath()}/todoist-sync-logs.json`;
    }

    getBackupsBasePath(): string {
        return `${this.getBasePath()}/backups`;
    }

    getBackupsFilesPath(): string {
        return `${this.getBasePath()}/backups/files`;
    }

    getBackupsTodoistPath(): string {
        return `${this.getBasePath()}/backups/todoist`;
    }

    getBackupsSettingsPath(): string {
        return `${this.getBasePath()}/backups/settings`;
    }

    getReportsPath(): string {
        return `${this.getBasePath()}/reports`;
    }

    async getLogsPath(): Promise<string> {
        const deviceId = await this.plugin.deviceManager?.getDeviceId() || 'unknown';
        return `${this.getLogsBasePath()}/${deviceId}`;
    }

    async getTodayLogFileName(): Promise<string> {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const deviceId = await this.plugin.deviceManager?.getDeviceId() || 'unknown';
        return `${deviceId}_${date}.json`;
    }

    async getTodayLogPath(): Promise<string> {
        const logsPath = await this.getLogsPath();
        const fileName = await this.getTodayLogFileName();
        return this.joinPath(logsPath, fileName);
    }

    getBackupFileName(originalPath: string): string {
        const timestamp = this.generateTimestamp();
        const safePath = originalPath.replace(/[/\\]/g, '_');
        return `${safePath}_${timestamp}.md.bak`;
    }

    getTodoistBackupFileName(): string {
        const timestamp = this.generateTimestamp();
        return `todoist-data_${timestamp}.json`;
    }

    getSettingsBackupFileName(): string {
        const timestamp = this.generateTimestamp();
        return `settings-${timestamp}.json`;
    }

    private generateTimestamp(): string {
        const now = new Date();
        return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    }

    private joinPath(...parts: string[]): string {
        return parts.join('/');
    }

    async ensureDir(path: string): Promise<boolean> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (!exists) {
                await adapter.mkdir(path);
            }
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to ensure directory ${path}:`, error);
            return false;
        }
    }

    async ensureAllDirs(): Promise<boolean> {
        const basePath = this.getBasePath();
        const dirs = [
            basePath,
            this.getLogsBasePath(),
            `${basePath}/backups/todoist`,
            `${basePath}/backups/files`,
            `${basePath}/backups/settings`,
            this.getReportsPath()
        ];

        for (const dir of dirs) {
            const success = await this.ensureDir(dir);
            if (!success) {
                console.error(`[StoragePathManager] Failed to create directory: ${dir}`);
                return false;
            }
        }

        try {
            const logsPath = await this.getLogsPath();
            const success = await this.ensureDir(logsPath);
            if (!success) {
                console.error(`[StoragePathManager] Failed to create logs directory: ${logsPath}`);
                return false;
            }
        } catch (error) {
            console.error(`[StoragePathManager] Failed to create logs directory:`, error);
            return false;
        }

        return true;
    }

    async migrateToNewDirectory(newDir: string): Promise<boolean> {
        const oldDir = this.plugin.settings?.lastStorageDirectory 
            || StoragePathManager.LEGACY_BASE_PATH;
        
        if (oldDir === newDir) {
            this.plugin.debugLog('[StoragePathManager] Directory unchanged, no migration needed');
            return true;
        }

        this.plugin.debugLog(`[StoragePathManager] Starting migration from "${oldDir}" to "${newDir}"`);

        const adapter = this.app.vault.adapter;

        try {
            const oldExists = await adapter.exists(oldDir);
            if (!oldExists) {
                this.plugin.debugLog('[StoragePathManager] Old directory does not exist, no migration needed');
                await this.plugin.safeSettings?.update({ lastStorageDirectory: newDir });
                return true;
            }

            const newExists = await adapter.exists(newDir);
            if (!newExists) {
                await adapter.mkdir(newDir);
            }

            await this.migrateDirectoryContents(oldDir, newDir);

            this.plugin.debugLog('[StoragePathManager] Migration completed successfully');
            await this.plugin.safeSettings?.update({ lastStorageDirectory: newDir });
            return true;
        } catch (error) {
            console.error('[StoragePathManager] Migration failed:', error);
            return false;
        }
    }

    private async migrateDirectoryContents(srcDir: string, destDir: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        
        try {
            const result = await adapter.list(srcDir);
            
            for (const folder of result.folders) {
                const newFolderPath = folder.replace(srcDir, destDir);
                const folderExists = await adapter.exists(newFolderPath);
                if (!folderExists) {
                    await adapter.mkdir(newFolderPath);
                }
                await this.migrateDirectoryContents(folder, newFolderPath);
            }

            for (const file of result.files) {
                const newFilePath = file.replace(srcDir, destDir);
                const content = await adapter.read(file);
                
                const destExists = await adapter.exists(newFilePath);
                if (destExists) {
                    const destContent = await adapter.read(newFilePath);
                    const srcMtime = await this.getFileMtime(file);
                    const destMtime = await this.getFileMtime(newFilePath);
                    
                    if (srcMtime > destMtime) {
                        await adapter.write(newFilePath, content);
                        this.plugin.debugLog(`[StoragePathManager] Updated file: ${newFilePath}`);
                    } else {
                        this.plugin.debugLog(`[StoragePathManager] Kept newer file: ${newFilePath}`);
                    }
                } else {
                    await adapter.write(newFilePath, content);
                    this.plugin.debugLog(`[StoragePathManager] Migrated file: ${newFilePath}`);
                }
                
                await adapter.remove(file);
            }

            const remaining = await adapter.list(srcDir);
            if (remaining.folders.length === 0 && remaining.files.length === 0) {
                await adapter.rmdir(srcDir, true);
                this.plugin.debugLog(`[StoragePathManager] Removed empty directory: ${srcDir}`);
            }
        } catch (error) {
            console.error('[StoragePathManager] Error during migration:', error);
            throw error;
        }
    }

    private async getFileMtime(path: string): Promise<number> {
        try {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file && 'stat' in file) {
                return (file as { stat: { mtime: number } }).stat.mtime;
            }
            return 0;
        } catch {
            return 0;
        }
    }

    async readJsonFile<T>(path: string): Promise<T | null> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (!exists) {
                return null;
            }
            const content = await adapter.read(path);
            return JSON.parse(content) as T;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to read JSON file ${path}:`, error);
            return null;
        }
    }

    async writeJsonFile<T>(path: string, data: T): Promise<boolean> {
        try {
            const adapter = this.app.vault.adapter;
            await adapter.write(path, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to write JSON file ${path}:`, error);
            return false;
        }
    }

    async writeJsonFileAtomic<T>(path: string, data: T): Promise<boolean> {
        const tempPath = `${path}.tmp`;
        const jsonContent = JSON.stringify(data, null, 2);
        const adapter = this.app.vault.adapter;

        try {
            await adapter.write(tempPath, jsonContent);
            const exists = await adapter.exists(tempPath);
            if (!exists) {
                throw new Error('Temp file was not created');
            }

            await adapter.write(path, jsonContent);

            try {
                await adapter.remove(tempPath);
            } catch (cleanupError) {
                console.warn(`[StoragePathManager] Failed to cleanup temp file:`, cleanupError);
            }

            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Atomic write failed for ${path}:`, error);
            return false;
        }
    }

    async appendJsonToFile(path: string, newData: unknown): Promise<boolean> {
        if (this.appendLock) {
            console.warn('[StoragePathManager] Append in progress, skipping...');
            return false;
        }

        this.appendLock = true;
        try {
            const adapter = this.app.vault.adapter;
            let data: unknown[] = [];
            
            const exists = await adapter.exists(path);
            if (exists) {
                const content = await adapter.read(path);
                try {
                    data = JSON.parse(content);
                    if (!Array.isArray(data)) {
                        data = [];
                    }
                } catch {
                    data = [];
                }
            }
            
            data.push(newData);
            await adapter.write(path, JSON.stringify(data, null, 2));
            this.appendLock = false;
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to append to JSON file ${path}:`, error);
            this.appendLock = false;
            return false;
        }
    }

    async listFiles(dirPath: string): Promise<string[]> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(dirPath);
            if (!exists) {
                return [];
            }

            const result = await adapter.list(dirPath);
            return result.files;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to list files in ${dirPath}:`, error);
            return [];
        }
    }

    async listFolders(dirPath: string): Promise<string[]> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(dirPath);
            if (!exists) {
                return [];
            }

            const result = await adapter.list(dirPath);
            return result.folders;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to list folders in ${dirPath}:`, error);
            return [];
        }
    }

    async deleteFile(path: string): Promise<boolean> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (exists) {
                await adapter.remove(path);
            }
            return true;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to delete file ${path}:`, error);
            return false;
        }
    }

    async getFileSize(path: string): Promise<number> {
        try {
            const adapter = this.app.vault.adapter;
            const exists = await adapter.exists(path);
            if (!exists) {
                return 0;
            }
            const content = await adapter.read(path);
            return content.length;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to get file size ${path}:`, error);
            return 0;
        }
    }

    async getDirSize(dirPath: string): Promise<number> {
        try {
            const files = await this.listFiles(dirPath);
            let totalSize = 0;
            for (const filePath of files) {
                const size = await this.getFileSize(filePath);
                totalSize += size;
            }
            return totalSize;
        } catch (error) {
            console.error(`[StoragePathManager] Failed to get directory size ${dirPath}:`, error);
            return 0;
        }
    }

    async cleanOldBackups(dirPath: string, maxCount: number, namePrefix?: string): Promise<void> {
        try {
            let files = await this.listFiles(dirPath);
            
            if (namePrefix) {
                files = files.filter(f => {
                    const fileName = f.split('/').pop() || '';
                    return fileName.startsWith(namePrefix);
                });
            }

            if (files.length <= maxCount) {
                return;
            }

            const fileObjects = await Promise.all(
                files.map(async path => ({
                    path,
                    mtime: await this.getFileMtime(path)
                }))
            );

            fileObjects.sort((a, b) => b.mtime - a.mtime);

            const filesToDelete = fileObjects.slice(maxCount);
            for (const file of filesToDelete) {
                await this.deleteFile(file.path);
                this.plugin.debugLog(`[StoragePathManager] Deleted old backup: ${file.path}`);
            }
        } catch (error) {
            console.error(`[StoragePathManager] Failed to clean old backups in ${dirPath}:`, error);
        }
    }
}
