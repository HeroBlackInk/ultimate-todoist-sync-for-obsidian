import { App} from 'obsidian';
import { stripTaskContent } from './taskContent';
import UltimateTodoistSyncForObsidian from "../../main";




interface dataviewTaskObject {
    status: string;
    checked: boolean;
    completed: boolean;
    fullyCompleted: boolean;
    text: string;
    visual: string;
    line: number;
    lineCount: number;
    path: string;
    section: string;
    tags: string[];
    outlinks: string[];
    link: string;
    children: any[];
    task: boolean;
    annotated: boolean;
    parent: number;
    blockId: string;
}
  
  
interface todoistTaskObject {
    content: string;
    description?: string;
    project_id?: string;
    section_id?: string;
    parent_id?: string;
    order?: number | null;
    labels?: string[];
    priority?: number | null;
    due_string?: string;
    due_date?: string;
    due_datetime?: string;
    due_lang?: string;
    assignee_id?: string;
}

type ParentTaskLookup = {
    project_id?: string;
};

type LineTaskComparable = {
    content?: string;
    labels?: string[];
    isCompleted?: boolean;
    dueDate?: string;
    projectId?: string;
    priority?: number;
};

type TodoistTaskComparable = {
    content?: string;
    labels?: string[];
    checked?: boolean;
    due?: { date?: string };
    dueDate?: string;
    projectId?: string;
    priority?: number;
};
  

const keywords = {
    TODOIST_TAG: "#todoist",
    DUE_DATE: "🗓️|📅|📆|🗓",
};

const REGEX = {
    TODOIST_TAG: new RegExp(`^[\\s]*[-] \\[[x ]\\] [\\s\\S]*${keywords.TODOIST_TAG}[\\s\\S]*$`, "i"),
    TODOIST_ID: /\[todoist_id::\s*\w+\]/,
    TODOIST_ID_NUM:/\[todoist_id::\s*(\S+)\]/,
    TODOIST_LINK:/\[link\]\((https?:\/\/[^)]*todoist\.com[^)]*|todoist:\/\/[^)]*)\)/,
    DUE_DATE_WITH_EMOJ: new RegExp(`(${keywords.DUE_DATE})\\s?\\d{4}-\\d{2}-\\d{2}`),
    DUE_DATE : new RegExp(`(?:${keywords.DUE_DATE})\\s?(\\d{4}-\\d{2}-\\d{2})`),
    PROJECT_NAME: /\[project::\s*(.*?)\]/,
    TASK_CONTENT: {
        REMOVE_PRIORITY: /\s!!([1-4])\s/,
        // 移除所有 #标签，不要求前面有空格
        REMOVE_TAGS: /#[\w\u4e00-\u9fa5-]+/g,
        REMOVE_SPACE: /^\s+|\s+$/g,
        REMOVE_DATE: new RegExp(`(${keywords.DUE_DATE})\\s?\\d{4}-\\d{2}-\\d{2}`),
        REMOVE_INLINE_METADATA: /%%\[\w+::\s*\w+\]%%/,
        REMOVE_CHECKBOX:  /^(-|\*)\s+\[(x|X| )\]\s/,
        REMOVE_CHECKBOX_WITH_INDENTATION: /^([ \t]*)?(-|\*)\s+\[(x|X| )\]\s/,
        // 旧格式链接: [xxx](https://todoist.com/showtask?id=123) - 使用 [^\]]* 避免匹配 checkbox [ ]
        REMOVE_TODOIST_LINK_OLD: /\[([^\]]*)\]\(https?:\/\/todoist\.com\/showtask\?id=\S*\)/,
        // 新格式链接: [xxx](https://app.todoist.com/app/task/abc123)
        REMOVE_TODOIST_LINK_NEW: /\[([^\]]*)\]\(https?:\/\/app\.todoist\.com\/app\/task\/\S*\)/,
        // 混合格式: [xxx](https://todoist.com/app/task/123) - 旧域名 + 新路径
        REMOVE_TODOIST_LINK_OLD_DOMAIN_NEW_PATH: /\[([^\]]*)\]\(https?:\/\/todoist\.com\/app\/task\/\S*\)/,
        REMOVE_TODOIST_LINK_APP_URI: /\[([^\]]*)\]\(todoist:\/\/task\?id=\S*\)/,
    },
    ALL_TAGS: /#[\w\u4e00-\u9fa5-]+/g,
    TASK_CHECKBOX_CHECKED: /- \[(x|X)\] /,
    TASK_INDENTATION: /^(\s{2,}|\t)(-|\*)\s+\[(x|X| )\]/,
    TAB_INDENTATION: /^(\t+)/,
    TASK_PRIORITY: /\s!!([1-4])\s/,
    BLANK_LINE: /^\s*$/,
    TODOIST_EVENT_DATE: /(\d{4})-(\d{2})-(\d{2})/,
    OBSIDIAN_FILE_QUERY: /[?&]file=([^&]+)/,
    OBSIDIAN_WIKILINK: /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/
};

export class TaskParser   {
	app:App;
    plugin: UltimateTodoistSyncForObsidian;

	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
        this.plugin = plugin
	}


  
  
    //convert line text to a task object
    async convertTextToTodoistTaskObject(lineText:string,filepath:string,lineNumber?:number,fileContent?:string) {
        //this.plugin.debugLog(`linetext is:${lineText}`)
        const todoistSyncAPI = this.plugin.todoistSyncAPI;
        const cacheOperation = this.plugin.cacheOperation;
        if (!todoistSyncAPI || !cacheOperation) {
            const fallbackContent = this.getTaskContentFromLineText(lineText);
            return {
                projectId: this.plugin.settings.defaultProjectId,
                content: fallbackContent || '',
                parentId: null,
                dueDate: this.getDueDateFromLineText(lineText) || '',
                labels: this.getAllTagsFromLineText(lineText) || [],
                description: '',
                isCompleted: this.isTaskCheckboxChecked(lineText),
                todoist_id: this.getTodoistIdFromLineText(lineText) || null,
                hasParent: false,
                priority: this.getTaskPriority(lineText)
            };
        }
    
        let hasParent = false
        let parentId: string | null = null
        let parentTaskObject: ParentTaskLookup | null = null
        // 检测 parentID
        let textWithoutIndentation = lineText
        const safeLineNumber = typeof lineNumber === 'number' && lineNumber > 0 ? lineNumber : 0;
        if(this.getTabIndentation(lineText) > 0 && typeof fileContent === 'string' && safeLineNumber > 0){
        //this.plugin.debugLog(`缩进为 ${this.getTabIndentation(lineText)}`)
        textWithoutIndentation = this.removeTaskIndentation(lineText)
        //this.plugin.debugLog(textWithoutIndentation)
        //this.plugin.debugLog(`这是子任务`)
        //读取filepath
        //const fileContent = await this.plugin.fileOperation.readContentFromFilePath(filepath)
        //遍历 line
        const lines = fileContent.split('\n')
        //this.plugin.debugLog(lines)
        for (let i = (safeLineNumber - 1 ); i >= 0; i--) {
            //this.plugin.debugLog(`正在check${i}行的缩进`)
            const line = lines[i] ?? ''
            //this.plugin.debugLog(line)
            //如果是空行说明没有parent
            if(this.isLineBlank(line)){
                break
            }
            //如果tab数量大于等于当前line,跳过
            if (this.getTabIndentation(line) >= this.getTabIndentation(lineText)) {
                    //this.plugin.debugLog(`缩进为 ${this.getTabIndentation(line)}`)
                    continue       
            }
                if((this.getTabIndentation(line) < this.getTabIndentation(lineText))){
                //this.plugin.debugLog(`缩进为 ${this.getTabIndentation(line)}`)
                if(this.hasTodoistId(line)){
                    parentId = this.getTodoistIdFromLineText(line)
                    //this.plugin.debugLog(`parent id is ${parentId}`)
                    if (parentId) {
                        parentTaskObject = await todoistSyncAPI.GetTaskById(parentId)
                    }
                    hasParent = !!parentTaskObject
                    break
                }
                else{
                    break
                }
            }
        }
    
    
        }
        
        const dueDate = this.getDueDateFromLineText(textWithoutIndentation)
        const labels =  this.getAllTagsFromLineText(textWithoutIndentation)
        //this.plugin.debugLog(`labels is ${labels}`)

        //dataview format metadata
        //const projectName = this.getProjectNameFromLineText(textWithoutIndentation) ?? this.plugin.settings.defaultProjectName
        //const projectId = await this.plugin.cacheOperation.getProjectIdByNameFromCache(projectName)
        //use tag as project name

        let projectId = cacheOperation.getDefaultProjectIdForFilepath(filepath) || this.plugin.settings.defaultProjectId || ''
        let projectName = projectId
            ? ((await todoistSyncAPI.getProjectById(projectId))?.name ?? this.plugin.settings.defaultProjectName)
            : this.plugin.settings.defaultProjectName

        if(hasParent && parentTaskObject && parentTaskObject.project_id){
            projectId = parentTaskObject.project_id
            projectName = (await todoistSyncAPI.getProjectById(projectId))?.name ?? this.plugin.settings.defaultProjectName
        }
        if(!hasParent){
                    //匹配 tag 和 peoject
            for (const label of labels){
        
                //this.plugin.debugLog(label)
                let labelName = label.replace(/#/g, "");
                //this.plugin.debugLog(labelName)
                let hasProjectId = (await todoistSyncAPI.getProjectByName(labelName))?.id
                if(!hasProjectId){
                    continue
                }
                projectName = labelName
                //this.plugin.debugLog(`project is ${projectName} ${label}`)
                projectId = hasProjectId
                break
            }
        }


        const content = this.getTaskContentFromLineText(textWithoutIndentation)
        const isCompleted = this.isTaskCheckboxChecked(textWithoutIndentation)
        let description = ""
        const todoist_id = this.getTodoistIdFromLineText(textWithoutIndentation)
        const priority = this.getTaskPriority(textWithoutIndentation)
        if(filepath){
            let url = encodeURI(`obsidian://open?vault=${this.app.vault.getName()}&file=${filepath}`)
            description =`[${filepath}](${url})`;
        }
    
        const todoistTask = {
        projectId: projectId,
        content: content || '',
        parentId: parentId || null,
        dueDate: dueDate || '',
        labels: labels || [],
        description: description,
        isCompleted:isCompleted,
        todoist_id:todoist_id || null,
        hasParent:hasParent,
        priority:priority
        };
        //this.plugin.debugLog(`converted task `)
        //this.plugin.debugLog(todoistTask)
        return todoistTask;
    }
  
  
  
  
    hasTodoistTag(text:string){
        //this.plugin.debugLog("检查是否包含 todoist tag")
        //this.plugin.debugLog(text)
        return(REGEX.TODOIST_TAG.test(text))
    }
    
  
  
    hasTodoistId(text:string){
        const result = REGEX.TODOIST_ID.test(text)
        //this.plugin.debugLog("检查是否包含 todoist id")
        //this.plugin.debugLog(text)
        return(result)
    }
  
  
    hasDueDate(text:string){
        return(REGEX.DUE_DATE_WITH_EMOJ.test(text))
    }
  
  
    getDueDateFromLineText(text: string) {
        const result = REGEX.DUE_DATE.exec(text);
        return result ? result[1] : null;
    }

  
  
    getProjectNameFromLineText(text:string){
        const result = REGEX.PROJECT_NAME.exec(text);
        return result ? result[1] : null;
    }
  
  
    getTodoistIdFromLineText(text:string){
        //this.plugin.debugLog(text)
        const result = REGEX.TODOIST_ID_NUM.exec(text);
        //this.plugin.debugLog(result)
        return result ? result[1] : null;
    }
  
    getDueDateFromDataview(dataviewTask:{ due?: unknown }){
        if(!dataviewTask.due){
        return ""
        }
        else{
        const dataviewTaskDue = String(dataviewTask.due).slice(0, 10)
        return(dataviewTaskDue)
        }

    }
  
  
  
    /*
    //convert line task to dataview task object
    async  getLineTask(filepath,line){
        //const tasks = this.app.plugins.plugins.dataview.api.pages(`"${filepath}"`).file.tasks
        const tasks = await getAPI(this.app).pages(`"${filepath}"`).file.tasks
        const tasksValues = tasks.values
        //this.plugin.debugLog(`dataview filepath is ${filepath}`)
        //this.plugin.debugLog(`dataview line is ${line}`)
        //this.plugin.debugLog(tasksValues)
        const currentLineTask = tasksValues.find(obj => obj.line === line )	
        this.plugin.debugLog(currentLineTask)
        return(currentLineTask)
    
    }
    */
  
  
  
    getTaskContentFromLineText(lineText:string) {
        // Implemented in taskContent.ts, where it is unit-tested: this is the
        // comparator behind every "did the task change?" decision.
        return stripTaskContent(lineText)
    }
  
  
    getAllTagsFromLineText(lineText:string): string[] {
        const tags = lineText.match(REGEX.ALL_TAGS);
        if (!tags) return [];
        return tags.map(tag => tag.replace('#', ''));
    }
  
    //get checkbox status
    isTaskCheckboxChecked(lineText:string) {
        return(REGEX.TASK_CHECKBOX_CHECKED.test(lineText))
    }
  
  
    //task content compare
    taskContentCompare(lineTask:LineTaskComparable,todoistTask:TodoistTaskComparable) {
        const lineTaskContent = (lineTask.content || '').trim();
        //this.plugin.debugLog(dataviewTaskContent)
        
        const todoistTaskContent = (todoistTask.content || '').trim();
        //this.plugin.debugLog(todoistTask.content)

        //content 是否修改
        const contentModified = (lineTaskContent === todoistTaskContent)
        return(contentModified)  
    }
  
  
    normalizeLabelsForCompare(labels: string[] | undefined): string[] {
        if (!labels || labels.length === 0) return [];
        const normalized = labels
            .map(label => (label ?? '').trim())
            .filter(label => label.length > 0);
        const deduped = Array.from(new Set(normalized));
        return deduped.sort();
    }

    taskTagCompare(lineTask:LineTaskComparable,todoistTask:TodoistTaskComparable) {
        const lineTaskTags = this.normalizeLabelsForCompare(lineTask.labels || []);
        const todoistTaskTags = this.normalizeLabelsForCompare(todoistTask.labels || []);
        return lineTaskTags.length === todoistTaskTags.length && lineTaskTags.every((val: string, index: number) => val === todoistTaskTags[index]);
    }
  
    taskStatusCompare(lineTask:LineTaskComparable,todoistTask:TodoistTaskComparable) {
        return !!lineTask.isCompleted === !!todoistTask.checked;
    }
  
  
    compareTaskDueDate(lineTask: LineTaskComparable, todoistTask: TodoistTaskComparable): boolean {
        const lineTaskDue = lineTask.dueDate || "";
        const todoistDueDate = todoistTask.due?.date || todoistTask.dueDate || "";

        if (lineTaskDue === "" && todoistDueDate === "") return true;
        if (lineTaskDue === "" || todoistDueDate === "") return false;

        return lineTaskDue === todoistDueDate;
    }

    taskPriorityCompare(lineTask:LineTaskComparable, todoistTask:TodoistTaskComparable): boolean {
        const linePriority = lineTask.priority || 1;
        const todoistPriority = todoistTask.priority || 1;
        return linePriority === todoistPriority;
    }
    
  
    //task project id compare
    async  taskProjectCompare(lineTask:LineTaskComparable,todoistTask:TodoistTaskComparable) {
        //project 是否修改
        //this.plugin.debugLog(dataviewTaskProjectId)
        //this.plugin.debugLog(todoistTask.projectId)
        return(lineTask.projectId === todoistTask.projectId)
    }
  
  
    //判断任务是否缩进
    isIndentedTask(text:string) {
        return(REGEX.TASK_INDENTATION.test(text));
    }
  
  
    //判断制表符的数量
    //this.plugin.debugLog(getTabIndentation("\t\t- [x] This is a task with two tabs")); // 2
    //this.plugin.debugLog(getTabIndentation("  - [x] This is a task without tabs")); // 0
    getTabIndentation(lineText:string){
        const match = REGEX.TAB_INDENTATION.exec(lineText)
        return match ? match[1].length : 0;
    }


    //	Task priority from 1 (normal) to 4 (urgent).
    getTaskPriority(lineText:string): number{
        const match = REGEX.TASK_PRIORITY.exec(lineText)
        return match ? Number(match[1]) : 1;
    }
  
  
  
    //remove task indentation
    removeTaskIndentation(text:string) {
        const regex = /^([ \t]*)?- \[(x| )\] /;
        return text.replace(regex, "- [$2] ");
    }
  
  
    //判断line是不是空行
    isLineBlank(lineText:string) {
        return(REGEX.BLANK_LINE.test(lineText))
    }
  
  
  //在linetext中插入日期
    insertDueDateBeforeTodoist(text:string, dueDate:string) {
        const regex = new RegExp(`(${keywords.TODOIST_TAG})`)
        return text.replace(regex, `📅 ${dueDate} $1`);
  }

    //extra date from obsidian event
    // 使用示例
    //const str = "2023-03-27T15:59:59.000000Z";
    //const dateStr = ISOStringToLocalDateString(str);
    //this.plugin.debugLog(dateStr); // 输出 2023-03-27
    ISOStringToLocalDateString(utcTimeString:string) {
        try {
          if(!utcTimeString){
            return null
          }
          let utcDateString = utcTimeString;
          let dateObj = new Date(utcDateString); // 将UTC格式字符串转换为Date对象
          if (Number.isNaN(dateObj.getTime())) {
            return null
          }
          let year = dateObj.getFullYear();
          let month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
          let date = dateObj.getDate().toString().padStart(2, '0');
          let localDateString = `${year}-${month}-${date}`;
          return localDateString;
        } catch (error) {
          console.error(`Error extracting date from string '${utcTimeString}': ${error}`);
          return null;
        }
    }


    //extra date from obsidian event
    // 使用示例
    //const str = "2023-03-27T15:59:59.000000Z";
    //const dateStr = ISOStringToLocalDatetimeString(str);
    //this.plugin.debugLog(dateStr); // 输出 Mon Mar 27 2023 23:59:59 GMT+0800 (China Standard Time)
    ISOStringToLocalDatetimeString(utcTimeString:string) {
        try {
          if(utcTimeString === null){
            return null
          }
          let utcDateString = utcTimeString;
          let dateObj = new Date(utcDateString); // 将UTC格式字符串转换为Date对象
          let result = dateObj.toString();
          return(result);
        } catch (error) {
          console.error(`Error extracting date from string '${utcTimeString}': ${error}`);
          return null;
        }
    }



    //convert date from obsidian event
    // 使用示例
    //const str = "2023-03-27";
    //const utcStr = localDateStringToUTCDatetimeString(str);
    //this.plugin.debugLog(dateStr); // 输出 2023-03-27T00:00:00.000Z
    localDateStringToUTCDatetimeString(localDateString:string) {
        try {
          if(localDateString === null){
            return null
          }
          localDateString = localDateString + "T00:00:00";
          let localDateObj = new Date(localDateString);
          let ISOString = localDateObj.toISOString()
          return(ISOString);
        } catch (error) {
          console.error(`Error extracting date from string '${localDateString}': ${error}`);
          return null;
        }
    }
    
    //convert date from obsidian event
    // 使用示例
    //const str = "2023-03-27";
    //const utcStr = localDateStringToUTCDateString(str);
    //this.plugin.debugLog(dateStr); // 输出 2023-03-27
    localDateStringToUTCDateString(localDateString:string) {
        try {
          if(localDateString === null || localDateString === ""){
            return null
          }
          return localDateString.slice(0, 10);
        } catch (error) {
          console.error(`Error extracting date from string '${localDateString}': ${error}`);
          return null;
        }
    }
    
    isMarkdownTask(str: string): boolean {
        const taskRegex = /^\s*-\s+\[([x ])\]/;
        return taskRegex.test(str);
    }

    addTodoistTag(str: string): string {
        return(str +` ${keywords.TODOIST_TAG}`);
    }

    getObsidianUrlFromFilepath(filepath:string){
        const url = encodeURI(`obsidian://open?vault=${this.app.vault.getName()}&file=${filepath}`)
        const obsidianUrl =`[${filepath}](${url})`;
        return(obsidianUrl)
    }

    extractFilePathFromObsidianDescription(description: string): string | null {
        if (!description) return null;

        const markdownLinkMatch = description.match(/\((obsidian:\/\/open\?[^)]*)\)/i);
        if (markdownLinkMatch) {
            const url = markdownLinkMatch[1];
            const fileMatch = url.match(REGEX.OBSIDIAN_FILE_QUERY);
            if (fileMatch?.[1]) {
                try {
                    return decodeURIComponent(fileMatch[1]);
                } catch (error) {
                    console.error(`[TaskParser] Failed to decode Obsidian description path: ${error}`);
                    return fileMatch[1];
                }
            }
        }

        const wikiLinkMatch = description.match(REGEX.OBSIDIAN_WIKILINK);
        if (wikiLinkMatch?.[1]) {
            return wikiLinkMatch[1];
        }

        return null;
    }


    addTodoistLink(linetext: string,todoistLink:string): string {
        const regex = new RegExp(`${keywords.TODOIST_TAG}`, "g");
        return linetext.replace(regex, todoistLink + ' ' + '$&');
    }


    //检查是否包含todoist link
    hasTodoistLink(lineText:string){
        return(REGEX.TODOIST_LINK.test(lineText))
    }
}
