/**
 * DatabaseChecker - 数据库一致性检查模块
 * 
 * 功能：检查 Vault、Todoist 和 taskFileMapping 三个数据源之间的一致性
 * 
 * 数据流：
 * 1. scanVaultTasks() - 扫描 Vault 中的所有任务
 * 2. getTodoistTasksFromSyncData() - 从 Todoist Sync API 获取任务
 * 3. compareThreeSources() - 比对三个数据源，找出不一致问题
 * 4. generateReport() - 生成 Markdown 格式的检查报告
 */

import { App } from 'obsidian';
import UltimateTodoistSyncForObsidian from '../../main';

/**
 * 数据库检查问题类型定义
 * 用于描述检测到的各种数据不一致问题
 */
export interface DatabaseCheckIssue {
    type: 
        // ===== taskFileMapping 相关问题 =====
        | 'mapping_file_missing'
        | 'mapping_target_missing_in_todoist'
        | 'mapping_orphaned'
        | 'mapping_missing_for_task'
        | 'mapping_pointer_stale'
        
        // ===== 数据一致性问题 =====
        | 'todoist_task_missing'
        | 'vault_task_missing'
        | 'task_unsynced_new'
        | 'task_marked_nonactive'
        | 'task_requires_review'
        | 'issue_source_unconfirmed'
        | 'issue_unclassified'
        | 'sync_content_mismatch'
        | 'sync_completion_mismatch'
        | 'sync_due_mismatch'
        | 'todoist_link_stale'
        | 'sync_priority_mismatch'
        | 'sync_labels_mismatch'
        | 'sync_project_mismatch'
        | 'mapping_legacy_id'
        | 'task_duplicate_candidate';
    
    // 基本信息
    filePath?: string;              // 文件路径
    taskId?: string;                // 任务 ID
    details: string;                 // 问题详情描述
    lineNumber?: number;            // 行号（0-indexed）
    
    // 任务内容相关
    taskContent?: string;           // 任务内容（通用）
    obsidianContent?: string;       // Obsidian/Vault 中的任务内容
    todoistContent?: string;        // Todoist 中的任务内容
    
    // 状态相关
    obsidianStatus?: boolean;       // Obsidian 中的完成状态
    todoistStatus?: boolean;        // Todoist 中的完成状态
    
        // 日期相关
    dueDate?: string;
    todoistDueDate?: string;
    
    // 优先级相关
    priority?: number;              // 优先级（通用）
    obsidianPriority?: number;      // Obsidian 中的优先级
    todoistPriority?: number;      // Todoist 中的优先级
    
    // 项目相关
    projectId?: string;             // 项目 ID（通用）
    obsidianProjectId?: string;    // Obsidian 中的项目 ID
    todoistProjectId?: string;     // Todoist 中的项目 ID
    projectName?: string;           // 项目名称
    
    // 标签相关
    labels?: string[];              // 标签（通用）
    obsidianLabels?: string[];     // Obsidian 中的标签
    todoistLabels?: string[];      // Todoist 中的标签

    expectedFilePath?: string;
    todoistFilePath?: string;
}

/**
 * Vault 任务数据结构
 * 表示从 Obsidian Vault 中扫描到的任务
 */
export interface VaultTask {
    taskId: string;                 // 任务 ID（来自 todoist_id 元数据）
    content: string;                // 任务内容（已去除元数据）
    isCompleted: boolean;           // 是否已完成
    filePath: string;              // 任务所在文件路径
    lineNumber: number;            // 任务所在行号（0-indexed）
    labels: string[];              // 任务标签（#tag 格式）
    dueDate?: string;
    priority?: number;
}



/**
 * Todoist 任务数据结构
 * 表示从 Todoist API 获取的任务
 */
export interface TodoistTask {
    taskId: string;                 // 任务 ID
    content: string;                // 任务内容
    description?: string;
    checked: boolean;           // 是否已完成
    dueDate?: string;              // 截止日期
    priority: number;               // 优先级 (1-4, 1 最高)
    projectId: string;              // 项目 ID
    labels: string[];              // 标签数组
}

/**
 * 数据库检查结果
 * 包含检查是否成功、问题数量、问题列表和统计摘要
 */
export interface DatabaseCheckResult {
    success: boolean;               // 检查是否通过（无问题）
    totalIssues: number;            // 问题总数
    /**
     * Issues that actually need a decision. Excludes settled ones — a task
     * completed in the vault and gone from Todoist's active set is a normal end
     * state, not something to fix, and counting it made every launch report
     * "database issues" for a healthy vault.
     */
    actionableIssues: number;
    issues: DatabaseCheckIssue[];   // 问题列表
    summary: {                      // 统计摘要
        // taskFileMapping 相关
        mappingFileNotFound: number;        // taskFileMapping 中的文件不存在
        mappingTaskNotInTodoist: number;   // taskFileMapping 中的任务在 Todoist 不存在
        mappingOrphan: number;              // 孤岛 mapping
        vaultTaskNoMapping: number;         // Vault 任务没有 mapping
        
        // 数据一致性
        taskDeletedInTodoist: number;       // 任务在 Todoist 端被删除
        taskNotInVault: number;             // Vault 文件丢失
        newTaskNotSynced: number;           // 新任务未同步
        taskNonActive: number;              // 已标记为 nonActive 的任务
        taskIssue: number;                  // 已标记为 issue 的任务
        staleTodoistLink: number;
        unknownIssue: number;               // 未知问题
        contentMismatch: number;             // 内容不一致
        statusMismatch: number;              // 状态不一致
        dueDateMismatch: number;
        priorityMismatch: number;            // 优先级不一致
        labelsMismatch: number;
        projectMismatch: number;            // 项目不一致
        legacyIdIssue: number;
        duplicateTask: number;              // 重复任务
    };
    reportPath?: string;             // 生成的报告文件路径
    step1Stats?: {                  // 第一步 Vault vs Mapping 组合统计
        vaultWithMapping: number;
        vaultWithoutMapping: number;
        orphanMapping: number;
        unknownIssue: number;
    };
    caseStats?: {
        c1AllPresent: number;
        c2VaultMappingOnly: number;
        c3VaultTodoistOnly: number;
        c4VaultOnly: number;
        c5TodoistMappingOnly: number;
        c6MappingOnly: number;
        c7TodoistOnly: number;
        c8None: number;
    };
}

/**
 * DatabaseChecker 类
 * 
 * 主要功能：
 * 1. 扫描 Vault 中的任务
 * 2. 从 Todoist 获取任务数据
 * 3. 比对三个数据源（Vault、Todoist、taskFileMapping）
 * 4. 生成详细的检查报告
 */
export class DatabaseChecker {
    // Obsidian App 实例
    app: App;
    // 插件主实例
    plugin: UltimateTodoistSyncForObsidian;

    /**
     * 构造函数
     * @param app - Obsidian App 实例
     * @param plugin - 插件主实例
     */
    constructor(app: App, plugin: UltimateTodoistSyncForObsidian) {
        this.app = app;
        this.plugin = plugin;
    }

    private normalizeFilePath(path: string): string {
        try {
            return decodeURIComponent(path).replace(/\\/g, '/');
        } catch (_error) {
            return path.replace(/\\/g, '/');
        }
    }

    /**
     * 主检查方法 - 执行完整的数据库一致性检查
     * 
     * 执行流程：
     * 1. 扫描 Vault 中的所有任务
     * 2. 从 Todoist Sync API 获取任务
     * 3. 加载 taskFileMapping
     * 4. 比对三个数据源
     * 5. 生成检查报告
     * 
     * @param noticeCallback - 可选的进度回调函数
     * @returns DatabaseCheckResult - 检查结果
     */
    async checkDatabase(noticeCallback?: (message: string) => void): Promise<DatabaseCheckResult> {
        // 初始化问题列表
        const issues: DatabaseCheckIssue[] = [];
        
        // 初始化统计摘要（各类型问题计数）
        const summary = {
            mappingFileNotFound: 0,           // taskFileMapping 文件不存在
            mappingTaskNotInTodoist: 0,       // taskFileMapping 任务在 Todoist 不存在
            mappingOrphan: 0,                 // 孤岛 mapping
            vaultTaskNoMapping: 0,            // Vault 任务无 mapping
            taskDeletedInTodoist: 0,          // 任务在 Todoist 被删除
            taskNotInVault: 0,                // Vault 文件丢失
            newTaskNotSynced: 0,              // 新任务未同步
            taskNonActive: 0,                 // 已标记为 nonActive 的任务
            taskIssue: 0,                     // 已标记为 issue 的任务
            staleTodoistLink: 0,
            unknownIssue: 0,                  // 未知问题
            contentMismatch: 0,                // 内容不一致
            statusMismatch: 0,                 // 状态不一致
            dueDateMismatch: 0,
            priorityMismatch: 0,              // 优先级不一致
            labelsMismatch: 0,
            legacyIdIssue: 0,
            projectMismatch: 0,               // 项目不一致
            duplicateTask: 0                  // 重复任务
        };

        // 发送开始检查的通知
        if (noticeCallback) {
            noticeCallback('Starting data consistency check...');
        }

        try {
            const fileOperation = this.plugin.fileOperation;
            const todoistSyncAPI = this.plugin.todoistSyncAPI;
            const taskParser = this.plugin.taskParser;
            if (!fileOperation || !todoistSyncAPI || !taskParser) {
                throw new Error('Required modules are not initialized for database check');
            }

            // ====== Step 1: 扫描 Vault 任务 ======
            if (noticeCallback) {
                noticeCallback('Step 1/4: Scanning vault files...');
            }
            // 使用 fileOperation 的统一扫描方法
            const { tasksWithId, tasksWithoutId } = await fileOperation.scanVaultTasks();
            const vaultTasksMap = tasksWithId;

            // ====== Step 2: 获取 Todoist 任务 ======
            if (noticeCallback) {
                noticeCallback('Step 2/4: Loading Todoist data from syncData...');
            }
            // 获取 syncData（如果未加载则先初始化）
            let syncData = todoistSyncAPI.getSyncData();
            if (!syncData) {
                // 如果 syncData 为空，初始化同步
                await todoistSyncAPI.initializeSync();
                // 重新获取 syncData
                syncData = todoistSyncAPI.getSyncData();
            } else {
                if (noticeCallback) {
                    noticeCallback('Step 2/4: Refreshing Todoist cache...');
                }
                await todoistSyncAPI.incrementalSync();
                syncData = todoistSyncAPI.getSyncData();
            }
            // 使用 fileOperation 的方法从 syncData 中获取 Todoist 任务
            const todoistTasksMap = fileOperation.getTodoistTasksFromSyncData(syncData);

            // ====== Step 3: 获取 taskFileMapping ======
            if (noticeCallback) {
                noticeCallback('Step 3/4: Loading taskFileMapping...');
            }
            // 从设置中获取 taskFileMapping（任务 ID -> 文件路径的映射）
            const taskFileMapping = this.plugin.settings.taskFileMapping || {};

            // ====== Step 4: 分析差异 ======
            if (noticeCallback) {
                noticeCallback('Step 4/4: Analyzing differences...');
            }

            // 比对三个数据源，找出所有不一致问题
            const result = await this.compareThreeSources(
                vaultTasksMap,
                todoistTasksMap,
                taskFileMapping
            );

            // 第一步 Vault vs Mapping 组合统计
            const step1Stats = {
                vaultWithMapping: result.vaultWithMappingCount,
                vaultWithoutMapping: result.vaultWithoutMappingCount,
                orphanMapping: result.orphanMappingCount,
                unknownIssue: result.unknownIssueCount
            };

            const caseStats = result.caseStats;
            
            // ====== Step 5: 处理无 todoist_id 的任务（新任务未同步）======
            if (tasksWithoutId.length > 0) {
                for (const newTask of tasksWithoutId) {
                    issues.push({
                        type: 'task_unsynced_new',
                        filePath: newTask.filePath,
                        taskId: undefined,
                        lineNumber: newTask.lineNumber,
                        details: `New task in Vault not yet synced to Todoist (no todoist_id)`,
                        obsidianContent: newTask.content,
                        obsidianStatus: newTask.isCompleted
                    });
                    summary.newTaskNotSynced++;
                }
            }
            
            // 将发现的问题添加到结果中
            issues.push(...result.issues);
            // 累加统计摘要（不能用 Object.assign，会覆盖已有计数）
            for (const key of Object.keys(result.summary) as Array<keyof typeof summary>) {
                summary[key] += result.summary[key];
            }

            // 计算问题总数
            const totalIssues = Object.values(summary).reduce((a, b) => a + b, 0);
            const actionableIssues = totalIssues - summary.taskNonActive;
            // 记录日志
            this.plugin.logOperation?.log('DATABASE_CHECKED', `Database check completed: ${actionableIssues} issues needing action, ${summary.taskNonActive} settled`);

            // ====== 生成报告 ======
            const reportPath = await this.generateReport({
                success: actionableIssues === 0,
                totalIssues,
                actionableIssues,
                issues,
                summary,
                step1Stats,
                caseStats
            });

            // 返回检查结果
            return {
                success: actionableIssues === 0,
                totalIssues,
                actionableIssues,
                issues,
                summary,
                reportPath,
                step1Stats,
                caseStats
            };
        } catch (error) {
            // 检查失败，记录错误日志
            this.plugin.logOperation?.log('DATABASE_CHECK', `Database check failed: ${(error as Error).message}`);
            // 返回失败结果
            return {
                success: false,
                totalIssues: 0,
                actionableIssues: 0,
                issues: [{
                    type: 'issue_unclassified',
                    details: `Database check failed: ${(error as Error).message}`
                }],
                summary,
                reportPath: undefined
            };
        }
    }

    /**
     * 比较三个数据源，找出所有不一致问题
     * 
     * 三个数据源：
     * 1. vaultTasksMap - Vault 中扫描到的任务
     * 2. todoistTasksMap - Todoist 中的任务
     * 3. taskFileMapping - 任务 ID 到文件路径的映射
     * 
     * 8 种组合情况：
     * | 情况 | Vault | Todoist | Mapping | 说明 |
     * |------|-------|---------|---------|------|
     * | 1    | ✓     | ✓       | ✓       | 全部存在，检查一致性 |
     * | 2    | ✓     | ✓       | ✗       | mapping 丢失 |
     * | 3    | ✓     | ✗       | ✓       | 任务在 Todoist 被删除 |
     * | 4    | ✓     | ✗       | ✗       | 新任务未同步 |
     * | 5    | ✗     | ✓       | ✓       | Vault 文件丢失 |
     * | 6    | ✗     | ✓       | ✗       | 其他设备添加的任务（正常）|
     * | 7    | ✗     | ✗       | ✓       | mapping 孤岛 |
     * | 8    | ✗     | ✗       | ✗       | 不可能情况 |
     * 
     * @param vaultTasksMap - Vault 任务映射
     * @param todoistTasksMap - Todoist 任务映射
     * @param taskFileMapping - taskFileMapping 映射
     * @returns 问题和统计摘要
     */
    async compareThreeSources(
        vaultTasksMap: Map<string, VaultTask>,
        todoistTasksMap: Map<string, TodoistTask>,
        taskFileMapping: Record<string, { filePath: string; status?: string; syncEnabled?: boolean; issues?: Record<string, { state?: 'open' | 'resolved' | 'ignored' }> }>
    ): Promise<{ 
        issues: DatabaseCheckIssue[], 
        summary: DatabaseCheckResult['summary'],
        vaultWithMappingCount: number,
        vaultWithoutMappingCount: number,
        orphanMappingCount: number,
        unknownIssueCount: number,
        caseStats: NonNullable<DatabaseCheckResult['caseStats']>
    }> {
        const taskParser = this.plugin.taskParser;
        if (!taskParser) {
            throw new Error('TaskParser is not initialized for database comparison');
        }

        const issues: DatabaseCheckIssue[] = [];
        const summary = {
            mappingFileNotFound: 0,
            mappingTaskNotInTodoist: 0,
            mappingOrphan: 0,
            vaultTaskNoMapping: 0,
            taskDeletedInTodoist: 0,
            taskNotInVault: 0,
            newTaskNotSynced: 0,
            taskNonActive: 0,
            taskIssue: 0,
            staleTodoistLink: 0,
            unknownIssue: 0,
            contentMismatch: 0,
            statusMismatch: 0,
            dueDateMismatch: 0,
            priorityMismatch: 0,
            labelsMismatch: 0,
            legacyIdIssue: 0,
            projectMismatch: 0,
            duplicateTask: 0
        };

        // Only fields that some direction actually syncs are worth comparing. With
        // Obsidian creating tasks and Todoist owning them afterwards, a differing
        // title or label is the expected steady state, not a fault — reporting it
        // buries the real problems under one entry per task worked on in Todoist.
        const pushesFieldEdits = this.plugin.settings.obsidianToTodoistScope === 'full';
        const pullsFieldEdits = this.plugin.settings.todoistToObsidianEnabled
            && this.plugin.settings.todoistToObsidianScope === 'full';
        const pullsDueDate = this.plugin.settings.todoistToObsidianEnabled;
        const watches = {
            content: pushesFieldEdits || pullsFieldEdits,
            dueDate: pushesFieldEdits || pullsDueDate,
            priority: pushesFieldEdits || pullsFieldEdits,
            labels: pushesFieldEdits || pullsFieldEdits,
        };

        const vaultFiles = new Set(this.app.vault.getFiles().map(file => file.path));

        let vaultWithMapping = 0;
        let vaultWithoutMapping = 0;
        let orphanMapping = 0;
        let unknownIssue = 0;
        const vaultAndMappingTaskIds = new Set<string>([...vaultTasksMap.keys(), ...Object.keys(taskFileMapping)]);
        for (const taskId of vaultAndMappingTaskIds) {
            const inVault = vaultTasksMap.has(taskId);
            const inMapping = !!taskFileMapping[taskId];
            if (inVault && inMapping) vaultWithMapping++;
            else if (inVault && !inMapping) vaultWithoutMapping++;
            else if (!inVault && inMapping) orphanMapping++;
            else unknownIssue++;
        }

        const allTaskIds = new Set<string>([
            ...vaultTasksMap.keys(),
            ...todoistTasksMap.keys(),
            ...Object.keys(taskFileMapping),
        ]);
        const caseStats: NonNullable<DatabaseCheckResult['caseStats']> = {
            c1AllPresent: 0,
            c2VaultMappingOnly: 0,
            c3VaultTodoistOnly: 0,
            c4VaultOnly: 0,
            c5TodoistMappingOnly: 0,
            c6MappingOnly: 0,
            c7TodoistOnly: 0,
            c8None: 0,
        };

        for (const taskId of allTaskIds) {
            const inVault = vaultTasksMap.has(taskId);
            const inTodoist = todoistTasksMap.has(taskId);
            const inMapping = !!taskFileMapping[taskId];

            if (inVault && inMapping && inTodoist) {
                caseStats.c1AllPresent++;
            } else if (inVault && inMapping && !inTodoist) {
                caseStats.c2VaultMappingOnly++;
            } else if (inVault && !inMapping && inTodoist) {
                caseStats.c3VaultTodoistOnly++;
            } else if (inVault && !inMapping && !inTodoist) {
                caseStats.c4VaultOnly++;
            } else if (!inVault && inMapping && inTodoist) {
                caseStats.c5TodoistMappingOnly++;
            } else if (!inVault && inMapping && !inTodoist) {
                caseStats.c6MappingOnly++;
            } else if (!inVault && !inMapping && inTodoist) {
                caseStats.c7TodoistOnly++;
            } else {
                caseStats.c8None++;
            }
        }

        const emitIssue = (issue: DatabaseCheckIssue): void => {
            issues.push(issue);
            switch (issue.type) {
                case 'sync_content_mismatch':
                    summary.contentMismatch++;
                    break;
                case 'sync_completion_mismatch':
                    summary.statusMismatch++;
                    break;
                case 'sync_due_mismatch':
                    summary.dueDateMismatch++;
                    break;
                case 'sync_priority_mismatch':
                    summary.priorityMismatch++;
                    break;
                case 'sync_labels_mismatch':
                    summary.labelsMismatch++;
                    break;
                case 'mapping_legacy_id':
                    summary.legacyIdIssue++;
                    break;
                case 'sync_project_mismatch':
                    summary.projectMismatch++;
                    break;
                case 'todoist_link_stale':
                    summary.staleTodoistLink++;
                    break;
                case 'mapping_missing_for_task':
                    summary.vaultTaskNoMapping++;
                    break;
                case 'mapping_pointer_stale':
                case 'mapping_file_missing':
                    summary.mappingFileNotFound++;
                    break;
                case 'mapping_target_missing_in_todoist':
                    summary.mappingTaskNotInTodoist++;
                    break;
                case 'mapping_orphaned':
                    summary.mappingOrphan++;
                    break;
                case 'todoist_task_missing':
                    summary.taskDeletedInTodoist++;
                    break;
                case 'vault_task_missing':
                    summary.taskNotInVault++;
                    break;
                case 'task_unsynced_new':
                    summary.newTaskNotSynced++;
                    break;
                case 'task_marked_nonactive':
                    summary.taskNonActive++;
                    break;
                case 'task_requires_review':
                    summary.taskIssue++;
                    break;
                case 'task_duplicate_candidate':
                    summary.duplicateTask++;
                    break;
                case 'issue_source_unconfirmed':
                case 'issue_unclassified':
                    summary.unknownIssue++;
                    break;
                default:
                    summary.unknownIssue++;
                    break;
            }
        };

        const allPrimaryTaskIds = new Set<string>([...vaultTasksMap.keys(), ...todoistTasksMap.keys()]);
        const processedMappingTaskIds = new Set<string>();

        const todoistSyncAPI = this.plugin.todoistSyncAPI;
        const potentialLegacyCandidates: { taskId: string; content: string; filePath: string; lineNumber: number }[] = [];
        for (const taskId of allPrimaryTaskIds) {
            const vaultTask = vaultTasksMap.get(taskId);
            const todoistTask = todoistTasksMap.get(taskId);
            if (vaultTask && !todoistTask) {
                potentialLegacyCandidates.push({
                    taskId,
                    content: vaultTask.content,
                    filePath: vaultTask.filePath,
                    lineNumber: vaultTask.lineNumber,
                });
            }
        }

        const legacyIdMapping = new Map<string, string>();
        if (todoistSyncAPI && potentialLegacyCandidates.length > 0) {
            console.log(`[DatabaseChecker] legacy-preflight start: candidates=${potentialLegacyCandidates.length}`);
            try {
                const converted = await todoistSyncAPI.convertLegacyIds(potentialLegacyCandidates);
                console.log(`[DatabaseChecker] legacy-preflight convertLegacyIds returned=${Object.keys(converted).length}`);
                for (const [oldTaskId, newTaskId] of Object.entries(converted)) {
                    if (newTaskId && newTaskId !== oldTaskId) {
                        legacyIdMapping.set(oldTaskId, newTaskId);
                    }
                }
                console.log(`[DatabaseChecker] legacy-preflight usableMappings=${legacyIdMapping.size}`);
            } catch (error) {
                console.error('[DatabaseChecker] legacy ID preflight failed:', error);
                console.log('[DatabaseChecker] legacy-preflight failed: proceeding with empty mapping');
            }
        } else {
            console.log(`[DatabaseChecker] legacy-preflight skipped: hasApi=${!!todoistSyncAPI} candidates=${potentialLegacyCandidates.length}`);
        }

        for (const taskId of allPrimaryTaskIds) {
            const vaultTask = vaultTasksMap.get(taskId);
            const todoistTask = todoistTasksMap.get(taskId);
            const mapping = taskFileMapping[taskId];

            if (vaultTask && todoistTask) {
                if (mapping) processedMappingTaskIds.add(taskId);

                let hasSemanticMismatch = false;

                if (watches.content && !taskParser.taskContentCompare(vaultTask, todoistTask)) {
                    emitIssue({
                        type: 'sync_content_mismatch',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: 'Task content differs between Vault and Todoist',
                        obsidianContent: vaultTask.content.substring(0, 100),
                        todoistContent: todoistTask.content.substring(0, 100),
                    });
                    hasSemanticMismatch = true;
                }

                const todoistChecked = !!todoistTask.checked;
                if (!taskParser.taskStatusCompare(vaultTask, todoistTask)) {
                    emitIssue({
                        type: 'sync_completion_mismatch',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: `Status mismatch: Vault is ${vaultTask.isCompleted ? 'completed' : 'incomplete'}, Todoist is ${todoistChecked ? 'completed' : 'incomplete'}`,
                        obsidianStatus: vaultTask.isCompleted,
                        todoistStatus: todoistChecked,
                    });
                    hasSemanticMismatch = true;
                }

                const vaultDueDate = vaultTask.dueDate || '';
                const todoistDueDate = todoistTask.dueDate || '';
                if (watches.dueDate && !taskParser.compareTaskDueDate(vaultTask, todoistTask)) {
                    emitIssue({
                        type: 'sync_due_mismatch',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: `Due date mismatch: Vault is ${vaultDueDate || '(none)'}, Todoist is ${todoistDueDate || '(none)'}`,
                        dueDate: vaultDueDate,
                        todoistDueDate,
                    });
                    hasSemanticMismatch = true;
                }

                const vaultPriority = vaultTask.priority || 1;
                const todoistPriority = todoistTask.priority || 1;
                if (watches.priority && !taskParser.taskPriorityCompare(vaultTask, todoistTask)) {
                    emitIssue({
                        type: 'sync_priority_mismatch',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: `Priority mismatch: Vault is ${vaultPriority}, Todoist is ${todoistPriority}`,
                        obsidianPriority: vaultPriority,
                        todoistPriority,
                    });
                    hasSemanticMismatch = true;
                }

                const obsidianLabels = taskParser.normalizeLabelsForCompare(vaultTask.labels);
                const todoistLabels = taskParser.normalizeLabelsForCompare(todoistTask.labels);
                if (watches.labels && !taskParser.taskTagCompare(vaultTask, todoistTask)) {
                    emitIssue({
                        type: 'sync_labels_mismatch',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: `Labels differ: Vault [#${obsidianLabels.join(', #')}], Todoist [#${todoistLabels.join(', #')}]`,
                        obsidianLabels,
                        todoistLabels,
                    });
                    hasSemanticMismatch = true;
                }

                const fileMetadata = this.plugin.settings.fileMetadata?.[vaultTask.filePath];
                const expectedProjectId = fileMetadata?.defaultProjectId;
                if (expectedProjectId && !(await taskParser.taskProjectCompare({ projectId: expectedProjectId }, todoistTask))) {
                    emitIssue({
                        type: 'sync_project_mismatch',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: `Project differs: Vault metadata project is ${expectedProjectId}, Todoist is ${todoistTask.projectId}`,
                        obsidianProjectId: expectedProjectId,
                        todoistProjectId: todoistTask.projectId,
                    });
                    hasSemanticMismatch = true;
                }

                const descriptionFilePath = this.plugin.taskParser?.extractFilePathFromObsidianDescription(todoistTask.description || '');
                if (descriptionFilePath) {
                    const expectedPath = this.normalizeFilePath(vaultTask.filePath);
                    const parsedPath = this.normalizeFilePath(descriptionFilePath);
                    if (expectedPath !== parsedPath) {
                        emitIssue({
                            type: 'todoist_link_stale',
                            filePath: vaultTask.filePath,
                            taskId,
                            lineNumber: vaultTask.lineNumber,
                            details: `Todoist description link points to ${parsedPath} but Vault task is at ${expectedPath}`,
                            expectedFilePath: expectedPath,
                            todoistFilePath: parsedPath,
                            todoistContent: todoistTask.description || '',
                        });
                    }
                }

                if (!hasSemanticMismatch) {
                    if (!mapping) {
                        emitIssue({
                            type: 'mapping_missing_for_task',
                            filePath: vaultTask.filePath,
                            taskId,
                            lineNumber: vaultTask.lineNumber,
                            details: 'Task matches between Vault and Todoist, but mapping is missing',
                            obsidianContent: vaultTask.content,
                            todoistContent: todoistTask.content,
                        });
                    } else if (this.normalizeFilePath(mapping.filePath) !== this.normalizeFilePath(vaultTask.filePath)) {
                        emitIssue({
                            type: 'mapping_pointer_stale',
                            filePath: vaultTask.filePath,
                            taskId,
                            lineNumber: vaultTask.lineNumber,
                            details: `Mapping points to ${mapping.filePath} but Vault task is in ${vaultTask.filePath}`,
                            expectedFilePath: vaultTask.filePath,
                            todoistFilePath: mapping.filePath,
                        });
                    }
                }

                continue;
            }

            if (vaultTask && !todoistTask) {
                if (mapping) processedMappingTaskIds.add(taskId);

                const mappedLegacyId = legacyIdMapping.get(taskId);
                if (mappedLegacyId) {
                    const mappedTodoistTask = todoistTasksMap.get(mappedLegacyId);
                    emitIssue({
                        type: 'mapping_legacy_id',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: `Legacy task ID ${taskId} can be migrated to ${mappedLegacyId}`,
                        obsidianContent: vaultTask.content,
                        todoistContent: mappedTodoistTask?.content,
                    });
                    continue;
                }

                if (vaultTask.isCompleted) {
                    // Completed here and absent from the sync data is the normal end
                    // state, not a discrepancy: /api/v1/sync only returns active
                    // items, so every task ever completed leaves it. This used to be
                    // put to a direct lookup, and anything that lookup could not
                    // confirm — including every failure of it — was escalated to
                    // "source unconfirmed", turning ordinary finished tasks into
                    // problems demanding attention.
                    emitIssue({
                        type: 'task_marked_nonactive',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: 'Task is completed in Vault and no longer in the Todoist active set',
                        obsidianContent: vaultTask.content,
                        obsidianStatus: vaultTask.isCompleted,
                    });
                } else {
                    emitIssue({
                        type: 'todoist_task_missing',
                        filePath: vaultTask.filePath,
                        taskId,
                        lineNumber: vaultTask.lineNumber,
                        details: 'Task exists in Vault but is missing in Todoist',
                        obsidianContent: vaultTask.content,
                        obsidianStatus: vaultTask.isCompleted,
                    });
                }
                continue;
            }

            if (!vaultTask && todoistTask) {
                if (mapping) {
                    processedMappingTaskIds.add(taskId);
                    emitIssue({
                        type: 'vault_task_missing',
                        filePath: mapping.filePath,
                        taskId,
                        details: 'Task exists in Todoist and mapping but not found in Vault',
                        todoistContent: todoistTask.content,
                        todoistStatus: !!(todoistTask as unknown as { checked?: boolean }).checked,
                    });
                }
                continue;
            }
        }

        for (const [taskId, mapping] of Object.entries(taskFileMapping)) {
            if (processedMappingTaskIds.has(taskId)) continue;
            if (vaultTasksMap.has(taskId) || todoistTasksMap.has(taskId)) continue;

            if (!vaultFiles.has(mapping.filePath)) {
                emitIssue({
                    type: 'mapping_file_missing',
                    filePath: mapping.filePath,
                    taskId,
                    details: 'Mapping points to a file path that no longer exists in Vault',
                });
            } else {
                emitIssue({
                    type: 'mapping_orphaned',
                    filePath: mapping.filePath,
                    taskId,
                    details: 'Mapping exists but task does not exist in Vault or Todoist',
                });
            }
        }

        return {
            issues,
            summary,
            vaultWithMappingCount: vaultWithMapping,
            vaultWithoutMappingCount: vaultWithoutMapping,
            orphanMappingCount: orphanMapping,
            unknownIssueCount: unknownIssue,
            caseStats
        };
    }

    /**
     * 生成数据库检查报告
     * 
     * 报告格式：Markdown
     * 包含内容：
     * 1. 检查状态摘要
     * 2. 数据源概览表格
     * 3. 各类问题的详细列表
     * 4. 内容/状态/优先级/标签/行号等详细对比信息
     * 
     * @param result - 数据库检查结果
     * @returns string | undefined - 报告文件路径，失败时返回 undefined
     */
    async generateReport(result: DatabaseCheckResult): Promise<string | undefined> {
        // 生成时间戳作为文件名的一部分
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportFilename = `ultimate-todoist-sync-database-check-${timestamp}.md`;

        // 从 result 中获取第一步 Vault vs Mapping 组合统计
        const step1 = result.step1Stats || {
            vaultWithMapping: 0,
            vaultWithoutMapping: 0,
            orphanMapping: 0,
            unknownIssue: 0
        };

        // 使用第一步的统计
        const sumVaultWithMapping = step1.vaultWithMapping;
        const sumVaultWithoutMapping = step1.vaultWithoutMapping;
        const sumOrphanMapping = step1.orphanMapping;
        const sumUnknownIssue = step1.unknownIssue;
        const totalVaultMapping = sumVaultWithMapping + sumVaultWithoutMapping + sumOrphanMapping + sumUnknownIssue;

        const fallbackCaseStats: NonNullable<DatabaseCheckResult['caseStats']> = {
            c1AllPresent: Math.max(0, sumVaultWithMapping - (result.summary.taskDeletedInTodoist + result.summary.taskNonActive + result.summary.taskIssue)),
            c2VaultMappingOnly: result.summary.taskDeletedInTodoist + result.summary.taskNonActive + result.summary.taskIssue,
            c3VaultTodoistOnly: sumVaultWithoutMapping,
            c4VaultOnly: 0,
            c5TodoistMappingOnly: result.summary.taskNotInVault,
            c6MappingOnly: result.summary.mappingOrphan,
            c7TodoistOnly: 0,
            c8None: 0,
        };
        const caseStats = result.caseStats || fallbackCaseStats;

        const c1 = caseStats.c1AllPresent;
        const c2 = caseStats.c2VaultMappingOnly;
        const c3 = caseStats.c3VaultTodoistOnly;
        const c4 = caseStats.c4VaultOnly;
        const c5 = caseStats.c5TodoistMappingOnly;
        const c6 = caseStats.c6MappingOnly;
        const c7 = caseStats.c7TodoistOnly;
        const c8 = caseStats.c8None;

        // 计算横向和纵向总计
        const totalVaultYes = c1 + c2 + c3 + c4;
        const totalVaultNo = c5 + c6 + c7 + c8;
        const totalMappingYes = c1 + c2 + c5 + c6;
        const totalMappingNo = c3 + c4 + c7 + c8;
        const totalTodoistYes = c1 + c3 + c5 + c7;
        const totalTodoistNo = c2 + c4 + c6 + c8;
        const grandTotal = c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8;

        // 生成 Markdown 报告内容
        let markdown = `# Database Check Report

Generated: ${new Date().toLocaleString()}

## Summary

| Status | Total Issues |
|--------|--------------|
| ${result.success ? '✅ Passed' : '❌ Issues Found'} | ${result.totalIssues} |

---

## Vault vs Mapping Summary

| Combination | Vault | Mapping | Count | Description |
|------------|-------|---------|-------|-------------|
| Normal | ✅ | ✅ | ${sumVaultWithMapping} | Check consistency with Todoist |
| Need Rebuild | ✅ | ❌ | ${sumVaultWithoutMapping} | Need rebuild mapping |
| Orphan Mapping | ❌ | ✅ | ${sumOrphanMapping} | File missing or task deleted |
| Unknown | ❌ | ❌ | ${sumUnknownIssue} | Unknown issue |
| **Total** | | | **${totalVaultMapping}** | |

---

## 8 Cases Detail

| # | Vault | Mapping | Todoist | Count | Description |
|---|-------|---------|---------|-------|-------------|
| 1 | ✅ | ✅ | ✅ | ${c1} | All three present |
| 2 | ✅ | ✅ | ❌ | ${c2} | Todoist missing (manual/nonActive candidates) |
| 3 | ✅ | ❌ | ✅ | ${c3} | Mapping missing for matched task |
| 4 | ✅ | ❌ | ❌ | ${c4} | Vault-only task (no mapping, no Todoist) |
| 5 | ❌ | ✅ | ✅ | ${c5} | Vault task missing while mapping+Todoist exist |
| 6 | ❌ | ✅ | ❌ | ${c6} | Mapping-only orphan |
| 7 | ❌ | ❌ | ✅ | ${c7} | Todoist-only task |
| 8 | ❌ | ❌ | ❌ | ${c8} | Impossible |
| **Total** | | | | **${grandTotal}** | |

### Cross Totals

| | Vault ✅ | Vault ❌ | Total |
|---|---------|---------|-------|
| Mapping ✅ | ${c1 + c2} | ${c5 + c6} | ${totalMappingYes} |
| Mapping ❌ | ${c3 + c4} | ${c7 + c8} | ${totalMappingNo} |
| **Total** | ${totalVaultYes} | ${totalVaultNo} | **${grandTotal}** |

| | Todoist ✅ | Todoist ❌ | Total |
|---|---------|---------|-------|
| Vault ✅ | ${c1 + c3} | ${c2 + c4} | ${totalVaultYes} |
| Vault ❌ | ${c5 + c7} | ${c6 + c8} | ${totalVaultNo} |
| **Total** | ${totalTodoistYes} | ${totalTodoistNo} | **${grandTotal}** |

---

## Detailed Issues

`;
        // 如果没有问题
        if (result.issues.length === 0) {
            markdown += '*No issues found. Database is healthy.*\n';
        } else {
            // 按问题类型分组
            const groupedByType = new Map<string, DatabaseCheckIssue[]>();
            for (const issue of result.issues) {
                if (!groupedByType.has(issue.type)) {
                    groupedByType.set(issue.type, []);
                }
                groupedByType.get(issue.type)!.push(issue);
            }

            // 问题类型标签映射
            const typeLabels: Record<string, string> = {
                'mapping_file_missing': 'Mapping File Missing',
                'mapping_target_missing_in_todoist': 'Mapping Target Missing in Todoist',
                'mapping_orphaned': 'Orphan Mapping',
                'mapping_missing_for_task': 'Mapping Missing for Matched Task',
                'mapping_pointer_stale': 'Mapping Pointer Stale',
                'todoist_task_missing': 'Todoist Task Missing',
                'vault_task_missing': 'Vault Task Missing',
                'task_unsynced_new': 'New Task Not Synced',
                'task_marked_nonactive': 'Marked Non-Active',
                'task_requires_review': 'Requires Review',
                'issue_source_unconfirmed': 'Unconfirmed Source State',
                'issue_unclassified': 'Unclassified Issue',
                'sync_content_mismatch': 'Content Mismatch',
                'sync_completion_mismatch': 'Completion Status Mismatch',
                'sync_due_mismatch': 'Due Date Mismatch',
                'todoist_link_stale': 'Stale Obsidian Link in Todoist',
                'sync_priority_mismatch': 'Priority Mismatch',
                'sync_labels_mismatch': 'Labels Mismatch',
                'mapping_legacy_id': 'Legacy ID Migration Required',
                'sync_project_mismatch': 'Project Mismatch',
                'task_duplicate_candidate': 'Duplicate Task Candidate'
            };

            // 优先级标签映射
            const priorityLabels: Record<number, string> = {
                1: 'P1 (Low)',
                2: 'P2 (Medium)',
                3: 'P3 (High)',
                4: 'P4 (Urgent)'
            };

            // 输出每种问题类型
            for (const [type, issues] of groupedByType) {
                const label = typeLabels[type] || type;
                markdown += `### ${label} (${issues.length})\n\n`;

                // 转义 markdown 表格中的 pipe 字符
                    const escapePipe = (s: string): string => s.replace(/\|/g, '\\|');
                markdown += `| # | Task ID | Content | File | Line | Status | Details |\n`;
                markdown += `|---|---------|---------|------|------|--------|---------|\n`;
                for (let i = 0; i < issues.length; i++) {
                    const issue = issues[i];
                    // 截取任务内容
                    const taskContent = escapePipe(issue.taskContent?.substring(0, 30) || issue.obsidianContent?.substring(0, 30) || '-');
                    // 生成 Obsidian wiki link，显示文件名但链接到完整路径
                    const fileBaseName = issue.filePath ? (issue.filePath.split('/').pop()?.replace(/\.md$/, '') || issue.filePath) : null;
                    const filePath = issue.filePath
                        ? `[[${issue.filePath.replace(/\.md$/, '')}\\|${fileBaseName}]]`
                        : '-';
                    // 行号格式化
                    const lineNum = issue.lineNumber !== undefined ? String(issue.lineNumber + 1) : '-';
                    // 状态列
                    let statusCol = '';
                    if (issue.obsidianStatus !== undefined && issue.todoistStatus !== undefined) {
                        const obs = issue.obsidianStatus ? '✅' : '⬜';
                        const todo = issue.todoistStatus ? '✅' : '⬜';
                        statusCol = `Obs:${obs} Todo:${todo}`;
                    } else if (issue.obsidianStatus !== undefined) {
                        statusCol = issue.obsidianStatus ? '✅' : '⬜';
                    } else if (issue.todoistStatus !== undefined) {
                        statusCol = issue.todoistStatus ? '✅' : '⬜';
                    } else {
                        statusCol = '-';
                    }

                    const details = escapePipe(issue.details.substring(0, 40));
                    markdown += `| ${i + 1} | \`${issue.taskId || '-'}\` | ${taskContent} | ${filePath} | ${lineNum} | ${statusCol} | ${details} |\n`;
                }
                markdown += '\n';

                // 为内容不一致问题添加详细对比
                if (type === 'sync_content_mismatch') {
                    markdown += `#### Content Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        markdown += `**Task \`${issue.taskId}\`:**\n`;
                        if (issue.obsidianContent) {
                            markdown += `- **Vault:** ${issue.obsidianContent}\n`;
                        }
                        if (issue.todoistContent) {
                            markdown += `- **Todoist:** ${issue.todoistContent}\n`;
                        }
                        markdown += '\n';
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n\n`;
                    }
                }

                // 为状态不一致问题添加详细对比
                if (type === 'sync_completion_mismatch') {
                    markdown += `#### Status Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        const obsStatus = issue.obsidianStatus ? 'Completed' : 'Incomplete';
                        const todoStatus = issue.todoistStatus ? 'Completed' : 'Incomplete';
                        markdown += `- **\`${issue.taskId}\`**: Vault is **${obsStatus}**, Todoist is **${todoStatus}**\n`;
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n`;
                    }
                    markdown += '\n';
                }

                if (type === 'sync_due_mismatch') {
                    markdown += `#### Due Date Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        const obsDue = issue.dueDate || 'none';
                        const todoDue = issue.todoistDueDate || 'none';
                        markdown += `- **\`${issue.taskId}\`**: Vault is **${obsDue}**, Todoist is **${todoDue}**\n`;
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n`;
                    }
                    markdown += '\n';
                }

                // 为优先级不一致问题添加详细对比
                if (type === 'sync_priority_mismatch') {
                    markdown += `#### Priority Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        const obsP = priorityLabels[issue.obsidianPriority || 4] || `P${issue.obsidianPriority || 4}`;
                        const todoP = priorityLabels[issue.todoistPriority || 4] || `P${issue.todoistPriority || 4}`;
                        markdown += `- **\`${issue.taskId}\`**: Vault is **${obsP}**, Todoist is **${todoP}**\n`;
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n`;
                    }
                    markdown += '\n';
                }

                // 为标签不一致问题添加详细对比
                if (type === 'sync_labels_mismatch') {
                    markdown += `#### Label Details\n\n`;
                    for (let i = 0; i < Math.min(issues.length, 10); i++) {
                        const issue = issues[i];
                        const obsLabels = issue.obsidianLabels?.join(', ') || 'none';
                        const todoLabels = issue.todoistLabels?.join(', ') || 'none';
                        markdown += `- **\`${issue.taskId}\`**: Vault has **[${obsLabels}]**, Todoist has **[${todoLabels}]**\n`;
                    }
                    if (issues.length > 10) {
                        markdown += `*... and ${issues.length - 10} more*\n`;
                    }
                    markdown += '\n';
                }

            }
        }

        markdown += `---

*Report generated by Ultimate Todoist Sync for Obsidian*
`;

        try {
            const reportsDir = this.plugin.storagePathManager?.getReportsPath() 
                || `${this.plugin.settings.storageDirectory}/reports`;
            await this.plugin.storagePathManager?.ensureDir(reportsDir);
            
            const reportPath = `${reportsDir}/${reportFilename}`;
            await this.app.vault.adapter.write(reportPath, markdown);

            this.plugin.logOperation?.log('DATABASE_CHECK', `Report saved to ${reportPath}`);
            return reportPath;
        } catch (error) {
            console.error('Failed to save report:', error);
            this.plugin.logOperation?.log('DATABASE_CHECK', `Failed to save report: ${(error as Error).message}`);
            return undefined;
        }
    }
}
