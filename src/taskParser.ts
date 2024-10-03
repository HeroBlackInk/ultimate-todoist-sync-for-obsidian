import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";




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
  

const keywords = {
    TODOIST_TAG: "#todoist",
    DUE_DATE: "🗓️|📅|📆|🗓",
};

const REGEX = {
    TODOIST_TAG: new RegExp(`^[\\s]*[-] \\[[x ]\\] [\\s\\S]*${keywords.TODOIST_TAG}[\\s\\S]*$`, "i"),
    TODOIST_ID: /\[todoist_id::\s*\d+\]/,
    TODOIST_ID_NUM:/\[todoist_id::\s*(.*?)\]/,
    TODOIST_LINK:/\[link\]\(.*?\)/,
    DUE_DATE_WITH_EMOJ: new RegExp(`(${keywords.DUE_DATE})\\s?\\d{4}-\\d{2}-\\d{2}`),
    DUE_DATE : new RegExp(`(?:${keywords.DUE_DATE})\\s?(\\d{4}-\\d{2}-\\d{2})`),
    PROJECT_NAME: /\[project::\s*(.*?)\]/,
    TASK_CONTENT: {
        REMOVE_PRIORITY: /\s!!([1-4])\s/,
        REMOVE_TAGS: /(^|\s)(#[a-zA-Z\d\u4e00-\u9fa5-]+)/g,
        REMOVE_SPACE: /^\s+|\s+$/g,
        REMOVE_DATE: new RegExp(`(${keywords.DUE_DATE})\\s?\\d{4}-\\d{2}-\\d{2}`),
        REMOVE_INLINE_METADATA: /%%\[\w+::\s*\w+\]%%/,
        REMOVE_CHECKBOX:  /^(-|\*)\s+\[(x|X| )\]\s/,
        REMOVE_CHECKBOX_WITH_INDENTATION: /^([ \t]*)?(-|\*)\s+\[(x|X| )\]\s/,
        REMOVE_TODOIST_LINK: /\[link\]\(.*?\)/,
    },
    ALL_TAGS: /#[\w\u4e00-\u9fa5-]+/g,
    TASK_CHECKBOX_CHECKED: /- \[(x|X)\] /,
    TASK_INDENTATION: /^(\s{2,}|\t)(-|\*)\s+\[(x|X| )\]/,
    TAB_INDENTATION: /^(\t+)/,
    TASK_PRIORITY: /\s!!([1-4])\s/,
    BLANK_LINE: /^\s*$/,
    TODOIST_EVENT_DATE: /(\d{4})-(\d{2})-(\d{2})/
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
        //console.log(`linetext is:${lineText}`)
    
        let hasParent = false
        let parentId = null
        let parentTaskObject = null
        // 检测 parentID
        let textWithoutIndentation = lineText
        if(this.getTabIndentation(lineText) > 0){
        //console.log(`缩进为 ${this.getTabIndentation(lineText)}`)
        textWithoutIndentation = this.removeTaskIndentation(lineText)

        //console.log(textWithoutIndentation)
        //console.log(`这是子任务`)
        //读取filepath
        //const fileContent = await this.plugin.fileOperation.readContentFromFilePath(filepath)
        //遍历 line
        const lines = fileContent.split('\n')
        //console.log(lines)
        for (let i = (lineNumber - 1 ); i >= 0; i--) {
            console.log(`正在check${i}行的缩进`)
            const line = lines[i]
            console.log(line)
            //如果是空行说明没有parent
            if(this.isLineBlank(line)){
                break
            }
            //如果tab数量大于等于当前line,跳过
            if (this.getTabIndentation(line) >= this.getTabIndentation(lineText)) {
                    console.log(`缩进为 ${this.getTabIndentation(line)}`)
                    continue       
            }
            if((this.getTabIndentation(line) < this.getTabIndentation(lineText))){
                //console.log(`缩进为 ${this.getTabIndentation(line)}`)
                if(this.hasTodoistId(line)){
                    parentId = this.getTodoistIdFromLineText(line)
                    hasParent = true
                    if(this.plugin.settings.debugMode){
                        console.log(`parent id is ${parentId}`)
                    }
                    
                    parentTaskObject = this.plugin.cacheOperation.loadTaskFromCacheByID(parentId)

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
        //console.log(`labels is ${labels}`)

        //dataview format metadata
        //const projectName = this.getProjectNameFromLineText(textWithoutIndentation) ?? this.plugin.settings.defaultProjectName
        //const projectId = await this.plugin.cacheOperation.getProjectIdByNameFromCache(projectName)
        //use tag as project name

        let projectId = this.plugin.cacheOperation.getDefaultProjectIdForFilepath(filepath as string)
        let projectName = this.plugin.cacheOperation.getProjectNameByIdFromCache(projectId)

        if(hasParent){
            projectId = parentTaskObject.projectId || parentTaskObject.project_id
            projectName =this.plugin.cacheOperation.getProjectNameByIdFromCache(projectId)
        }

        if(!hasParent){
                    //匹配 tag 和 peoject
            for (const label of labels){
        
                //console.log(label)
                let labelName = label.replace(/#/g, "");
                //console.log(labelName)
                let hasProjectId = this.plugin.cacheOperation.getProjectIdByNameFromCache(labelName)
                if(!hasProjectId){
                    continue
                }
                projectName = labelName
                //console.log(`project is ${projectName} ${label}`)
                projectId = hasProjectId
                break
            }
        }
        if(!projectId){
            throw new Error(`An error occured while converting a line to a taks: projectId not found. linetext:${lineText} \n filepath:${filepath}, lineNumber:${lineNumber}`)
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
        if(this.plugin.settings.debugMode){
          console.log(`converted task `)
          console.log(todoistTask)
        }

        return todoistTask;
    }
  
  
  
  
    hasTodoistTag(text:string){
        //console.log("检查是否包含 todoist tag")
        //console.log(text)
        return(REGEX.TODOIST_TAG.test(text))
    }
    
  
  
    hasTodoistId(text:string){
        const result = REGEX.TODOIST_ID.test(text)
        //console.log("检查是否包含 todoist id")
        //console.log(text)
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
        //console.log(text)
        const result = REGEX.TODOIST_ID_NUM.exec(text);
        //console.log(result)
        return result ? result[1] : null;
    }
  
    getDueDateFromDataview(dataviewTask:object){
        if(!dataviewTask.due){
        return ""
        }
        else{
        const dataviewTaskDue = dataviewTask.due.toString().slice(0, 10)
        return(dataviewTaskDue)
        }

    }
  
  
  
    /*
    //convert line task to dataview task object
    async  getLineTask(filepath,line){
        //const tasks = this.app.plugins.plugins.dataview.api.pages(`"${filepath}"`).file.tasks
        const tasks = await getAPI(this.app).pages(`"${filepath}"`).file.tasks
        const tasksValues = tasks.values
        //console.log(`dataview filepath is ${filepath}`)
        //console.log(`dataview line is ${line}`)
        //console.log(tasksValues)
        const currentLineTask = tasksValues.find(obj => obj.line === line )	
        console.log(currentLineTask)
        return(currentLineTask)
    
    }
    */
  
  
  
    getTaskContentFromLineText(lineText:string) {
        const TaskContent = lineText.replace(REGEX.TASK_CONTENT.REMOVE_INLINE_METADATA,"")
                                    .replace(REGEX.TASK_CONTENT.REMOVE_TODOIST_LINK,"")
                                    .replace(REGEX.TASK_CONTENT.REMOVE_PRIORITY," ") //priority 前后必须都有空格，
                                    .replace(REGEX.TASK_CONTENT.REMOVE_TAGS,"")
                                    .replace(REGEX.TASK_CONTENT.REMOVE_DATE,"")
                                    .replace(REGEX.TASK_CONTENT.REMOVE_CHECKBOX,"")
                                    .replace(REGEX.TASK_CONTENT.REMOVE_CHECKBOX_WITH_INDENTATION,"")
                                    .replace(REGEX.TASK_CONTENT.REMOVE_SPACE,"")
        return(TaskContent)
    }
  
  
    //get all tags from task text
    getAllTagsFromLineText(lineText:string){
        let tags = lineText.match(REGEX.ALL_TAGS);
    
        if (tags) {
            // Remove '#' from each tag
            tags = tags.map(tag => tag.replace('#', ''));
        }
    
        return tags;
    }
  
    //get checkbox status
    isTaskCheckboxChecked(lineText:string) {
        return(REGEX.TASK_CHECKBOX_CHECKED.test(lineText))
    }
  
  
    //task content compare
    taskContentCompare(lineTask:Object,todoistTask:Object) {
        const lineTaskContent = lineTask.content
        //console.log(dataviewTaskContent)
        
        const todoistTaskContent = todoistTask.content
        //console.log(todoistTask.content)

        //content 是否修改
        const contentModified = (lineTaskContent === todoistTaskContent)
        return(contentModified)  
    }
  
  
    //tag compare
    taskTagCompare(lineTask:Object,todoistTask:Object) {
    
    
        const lineTaskTags = lineTask.labels
        //console.log(dataviewTaskTags)
        
        const todoistTaskTags = todoistTask.labels
        //console.log(todoistTaskTags)
    
        //content 是否修改
        const tagsModified  = lineTaskTags.length === todoistTaskTags.length && lineTaskTags.sort().every((val, index) => val === todoistTaskTags.sort()[index]);
        return(tagsModified) 
    }
  
    // Compare task status
    taskStatusCompare(lineTask:Object, todoistTask:Object) {
        // Determine the task status keys
        const lineTaskStatus = lineTask.isCompleted ?? lineTask.checked; // 优先使用 isCompleted，如果不存在则使用 checked
        const todoistTaskStatus = todoistTask.checked ?? todoistTask.isCompleted; // 优先使用 checked，如果不存在则使用 isCompleted

        // Compare task statuses
        const statusModified = (lineTaskStatus === todoistTaskStatus) || (lineTaskStatus === false && todoistTaskStatus !== null);

        // Return the comparison result
        return statusModified;
    }

    getLocalSystemTimezone(){
        return Intl.DateTimeFormat().resolvedOptions().timeZone; // 系统时区
    }


    isUTCFormat(string) {
        // 定义 UTC 格式的正则表达式
        const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
        
        // 使用正则表达式测试字符串
        return utcPattern.test(string);
    }
    //task due date compare
    //linetask: pulled from file
    //todoistTask: task get from cache
    async compareTaskDueDate(lineTaskDue, lineTaskTimeZone, todoistTaskDue, todoistTaskTimeZone): Promise<boolean> {

    
        // 1. 如果两个任务的 dueDate 都是 null，则认为相等
        if (!lineTaskDue && !todoistTaskDue) {
            return true;
        }
    
        // 2. 如果 lineTask 的 dueDate 是 null，但 todoistTask 的 dueDate 不为 null，则认为不相等
        if (!lineTaskDue) {
            return false;
        }
    
        // 3. 如果 todoistTask 的 dueDate 是 null，但 lineTask 的 dueDate 不为 null，则认为不相等
        if (!todoistTaskDue) {
            return false;
        }
    
        // 4. 如果两个日期都是 10 位的 YYYY-MM-DD 格式，则直接比较
        if (lineTaskDue.length === 10 && todoistTaskDue.length === 10) {
            return lineTaskDue === todoistTaskDue;
        }
    
        // 5. 处理 todoistTaskDue 为 UTC 标准格式的情况，例如 'YYYY-MM-DDTHH:mm:ssZ'
        try {
            const lineTaskDate = new Date(lineTaskDue + 'T00:00:00'); // 将 lineTaskDue 转换为 Date 对象，假设时间为本地时区的零点
            const todoistDate = new Date(todoistTaskDue); // 将 todoistTaskDue 转换为 Date 对象（自动处理 UTC 格式）
    
            // 比较两个日期是否在相同的日历天（注意，比较的是本地时区的日期部分）
            return (
                lineTaskDate.getFullYear() === todoistDate.getFullYear() &&
                lineTaskDate.getMonth() === todoistDate.getMonth() &&
                lineTaskDate.getDate() === todoistDate.getDate()
            );
        } catch (error) {
            console.error(`Failed to compare due dates: lineTask=${JSON.stringify(lineTask)}, todoistTask=${JSON.stringify(todoistTask)}`, error);
            return false;
        }
    }
    
  
    //task project id compare
    async  taskProjectCompare(lineTask:Object,todoistTask:Object) {
        //project 是否修改
        //console.log(dataviewTaskProjectId)
        //console.log(todoistTask.projectId)
        return(lineTask.projectId === todoistTask.projectId)
    }
  
  
    //判断任务是否缩进
    isIndentedTask(text:string) {
        return(REGEX.TASK_INDENTATION.test(text));
    }
  
  
    //判断制表符的数量
    //console.log(getTabIndentation("\t\t- [x] This is a task with two tabs")); // 2
    //console.log(getTabIndentation("  - [x] This is a task without tabs")); // 0
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
    removeTaskIndentation(text) {
        const regex = /^([ \t]*)?- \[(x| )\] /;
        return text.replace(regex, "- [$2] ");
    }
  
  
    //判断line是不是空行
    isLineBlank(lineText:string) {
        return(REGEX.BLANK_LINE.test(lineText))
    }
  
  
  //在linetext中插入日期
    insertDueDateBeforeTodoist(text, dueDate) {
        const regex = new RegExp(`(${keywords.TODOIST_TAG})`)
        return text.replace(regex, `📅 ${dueDate} $1`);
  }

 


    //extra date from obsidian event
    // 使用示例
    //const str = "2023-03-27T15:59:59.000000Z";
    //const dateStr = ISOStringToLocalDatetimeString(str);
    //console.log(dateStr); // 输出 Mon Mar 27 2023 23:59:59 GMT+0800 (China Standard Time)
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
    //console.log(dateStr); // 输出 2023-03-27T00:00:00.000Z
    localDateStringToUTCDatetimeString(localDateString:string) {
        try {
          if(localDateString === null){
            return null
          }

			
          localDateString = localDateString + "T00:00";
          
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
    //console.log(dateStr); // 输出 2023-03-27
    localDateStringToUTCDateString(localDateString:string) {
        try {
          if(localDateString === null){
            return null
          }

          
            localDateString = localDateString + "T00:00";
          

          let localDateObj = new Date(localDateString);
          let ISOString = localDateObj.toISOString()
          let utcDateString = ISOString.slice(0,10)
          return(utcDateString);
        } catch (error) {
          console.error(`Error extracting date from string '${localDateString}': ${error}`);
          return null;
        }
    }


    // 示例用法：
    //const utcTimeStr = "2023-06-16T00:00:00Z";
    //const localDate = convertUtcToLocalDate(utcTimeStr);
    //console.log(localDate);  // 输出为本地日期，如 Asia/Shanghai 时区则为 2023-06-16
    convertUtcToLocalDate(utcTimeStr) {
        try {
            // 将 UTC 时间字符串转换为 Date 对象，并验证格式是否正确
            const utcTime = new Date(utcTimeStr);
            
            // 检查输入是否为有效的日期
            if (isNaN(utcTime.getTime())) {
                throw new Error("输入的 UTC 时间字符串格式不正确，应为 'YYYY-MM-DDTHH:MM:SSZ' 格式。");
            }
    
            // 获取本地时间与 UTC 时间的时差（单位：分钟），注意这是相对于本地时区的分钟差
            const localOffsetMinutes = new Date().getTimezoneOffset();
            
            // 将分钟差转换为毫秒，并计算本地时间
            const localTime = new Date(utcTime.getTime() - localOffsetMinutes * 60 * 1000);
    
            // 格式化日期字符串为 YYYY-MM-DD
            const year = localTime.getFullYear();
            const month = String(localTime.getMonth() + 1).padStart(2, '0'); // 月份从 0 开始，因此要加 1
            const day = String(localTime.getDate()).padStart(2, '0');
    
            // 拼接格式化后的日期字符串
            const localDateStr = `${year}-${month}-${day}`;
    
            return localDateStr;
        } catch (error) {
            console.error("发生错误:", error.message);
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


    addTodoistLink(linetext: string,todoistLink:string): string {
        const regex = new RegExp(`${keywords.TODOIST_TAG}`, "g");
        return linetext.replace(regex, todoistLink + ' ' + '$&');
    }


    //检查是否包含todoist link
    hasTodoistLink(lineText:string){
        return(REGEX.TODOIST_LINK.test(lineText))
    }
}
