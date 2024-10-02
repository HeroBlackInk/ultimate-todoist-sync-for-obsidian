import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";


//https://developer.todoist.com/sync/v9/#user
export interface TzInfo {
  gmt_string: string;
  hours:      number;
  is_dst:     number;
  minutes:    number;
  timezone:   string;
}



type Event = {
  id: string;
  object_type: string;
  object_id: string;
  event_type: string;
  event_date: string;
  parent_project_id: string;
  parent_item_id: string | null;
  initiator_id: string | null;
  extra_data: Record<string, any>;
};

type FilterOptions = {
  event_type?: string;
  object_type?: string;
};

export class TodoistSyncAPI   {
	app:App;
  plugin: UltimateTodoistSyncForObsidian;
  sync_token: string;
  resources: object|undefined;
  user_timezone_info: TzInfo|undefined;

	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
    this.plugin = plugin;
    this.sync_token = "*";
    this.resources = undefined;
    this.user_timezone_info = undefined;
	}

  async init(){
    await this.syncAllResources()

  }  

    // Get resources from local cache
    getAllResources() {
        return this.resources;
    }


    // Get all resources from todoist
    //completed or archived resources are not returned 
    async syncAllResources() {
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/sync/v9/sync';
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          sync_token: this.sync_token,
          resource_types: '["all"]'
        })
      };
    
      try {
        const response = await fetch(url, options);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(`Failed to fetch all resources: ${response.status} ${response.statusText}`);
        }
    
        // 如果 this.resources 为空或未定义，直接赋值为 data
        if (!this.resources) {
          this.resources = data;
        } else {
          // 遍历每个资源类型（如 tasks, projects 等）
          Object.keys(data).forEach(key => {
            // 如果资源类型（如 tasks, projects）是数组，则追加数据到当前资源中
            if (Array.isArray(data[key])) {
              // 确保 this.resources[key] 是一个数组
              if (!this.resources[key]) {
                this.resources[key] = [];
              }

              // 将新数据追加到现有数据中，不做去重或检查，保持增量更新
              this.resources[key] = this.resources[key].concat(data[key]);
            } else {
              // 如果资源类型不是数组（如 sync_token 等），直接覆盖
              this.resources[key] = data[key];
            }
          });
        }


        return this.resources;
      } catch (error) {
        console.error(error);
        throw new Error('Failed to fetch all resources due to network error');
      }
    }

    //backup todoist
    //FIXME: What does this do?
    //https://developer.todoist.com/sync/v9/#user-plan-limits
     getUserResource() { 
      return this.resources["user_plan_limits"];
    }

      // Returns all tasks from todoist.
      // If updated is true, it will only return tasks that have been updated since the last sync
     // If updated is false, it will return all tasks. This is a heavy operation and should be avoided
	   getAllTasks() {
        return this.resources?.items;
	  }




      //update user timezone
      async updateUserTimezone() { 
        const unixTimestampString: string = Math.floor(Date.now() / 1000).toString();
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/sync/v9/sync';
        const commands = [
          {
            'type': "user_update",
            'uuid': unixTimestampString,
            'args': { 'timezone': 'Asia/Shanghai' },
          },
        ];
        const options = {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({ commands: JSON.stringify(commands) })
        };
      
        try {
          const response = await fetch(url, options);
      
          if (!response.ok) {
            throw new Error(`Failed to fetch all resources: ${response.status} ${response.statusText}`);
          }
      
          const data = await response.json();
          console.log(data)
          return data;
        } catch (error) {
          console.error(error);
          throw new Error('Failed to fetch user resources due to network error');
        }
        }
  
    //get activity logs
    //result  {count:number,events:[]}
    async getAllActivityEvents() {
    const accessToken = this.plugin.settings.todoistAPIToken
      const headers = new Headers({
        Authorization: `Bearer ${accessToken}`
      });
    
      try {
        const response = await fetch('https://api.todoist.com/sync/v9/activity/get', {
          method: 'POST',
          headers,
          body: JSON.stringify({})
        });
    
        if (!response.ok) {
          throw new Error(`API returned error status: ${response.status}`);
        }
    
        const data = await response.json();

        return data;
      } catch (error) {
        throw error;
      }
    }

    async getNonObsidianAllActivityEvents() {
      try{
        const allActivity = await this.getAllActivityEvents()
        //console.log(allActivity)
        const allActivityEvents = allActivity.events
        //client中不包含obsidian 的activity
        const filteredArray = allActivityEvents.filter(obj => !obj.extra_data.client?.includes("obsidian"))
        //console.log(filteredArray)
        return(filteredArray)

      }catch(err){
        console.error('An error occurred:', err);
      }

    }
  
  

    

    filterActivityEvents(events: Event[], options: FilterOptions): Event[] {
      return events.filter(event => 
        (options.event_type ? event.event_type === options.event_type : true) &&
        (options.object_type ? event.object_type === options.object_type : true)
    
        );
    };

    //get completed items activity
    //result  {count:number,events:[]}
    async getCompletedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/sync/v9/activity/get';
        const options = {
            method: 'POST',
            headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
            'object_type': 'item',
            'event_type': 'completed'
            })
        };
        
        try {
            const response = await fetch(url, options);
        
            if (!response.ok) {
            throw new Error(`Failed to fetch completed items: ${response.status} ${response.statusText}`);
            }
        
            const data = await response.json();
        
            return data;
        } catch (error) {
            console.error(error);
            throw new Error('Failed to fetch completed items due to network error');
        }
    }
  
  
  
    //get uncompleted items activity
    //result  {count:number,events:[]}
    async getUncompletedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/sync/v9/activity/get';
        const options = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            'object_type': 'item',
            'event_type': 'uncompleted'
        })
        };
    
        try {
        const response = await fetch(url, options);
    
        if (!response.ok) {
            throw new Error(`Failed to fetch uncompleted items: ${response.status} ${response.statusText}`);
        }
    
        const data = await response.json();
    
        return data;
        } catch (error) {
        console.error(error);
        throw new Error('Failed to fetch uncompleted items due to network error');
        }
    }
  
  
    //get non-obsidian completed event
    async getNonObsidianCompletedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const completedItemsActivity = await this.getCompletedItemsActivity()
        const completedItemsActivityEvents = completedItemsActivity.events
        //client中不包含obsidian 的activity
        const filteredArray = completedItemsActivityEvents.filter(obj => !obj.extra_data.client.includes("obsidian")); 
        return(filteredArray)     
    }
  
  
    //get non-obsidian uncompleted event
    async  getNonObsidianUncompletedItemsActivity() {
        const uncompletedItemsActivity = await this.getUncompletedItemsActivity()
        const uncompletedItemsActivityEvents = uncompletedItemsActivity.events
        //client中不包含obsidian 的activity
        const filteredArray = uncompletedItemsActivityEvents.filter(obj => !obj.extra_data.client.includes("obsidian")); 
        return(filteredArray) 
    }
  
  
    //get updated items activity
    //result  {count:number,events:[]}
    async  getUpdatedItemsActivity() {
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/sync/v9/activity/get';
        const options = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            'object_type': 'item',
            'event_type': 'updated'
        })
        };
    
        try {
        const response = await fetch(url, options);
    
        if (!response.ok) {
            throw new Error(`Failed to fetch updated items: ${response.status} ${response.statusText}`);
        }
    
        const data = await response.json();
        //console.log(data)
        return data;
        } catch (error) {
        console.error(error);
        throw new Error('Failed to fetch updated items due to network error');
        }
    }
  
  
    //get non-obsidian updated event
    async  getNonObsidianUpdatedItemsActivity() {
        const updatedItemsActivity = await this.getUpdatedItemsActivity()
        const updatedItemsActivityEvents = updatedItemsActivity.events
        //client中不包含obsidian 的activity
        const filteredArray = updatedItemsActivityEvents.filter(obj => {
          const client = obj.extra_data && obj.extra_data.client;
          return !client || !client.includes("obsidian");
        });
        return(filteredArray)
    }


        //get completed items activity
    //result  {count:number,events:[]}
    async getProjectsActivity() {
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/sync/v9/activity/get';
      const options = {
          method: 'POST',
          headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
          'object_type': 'project'
          })
      };
      
      try {
          const response = await fetch(url, options);
      
          if (!response.ok) {
          throw new Error(`Failed to fetch  projects activities: ${response.status} ${response.statusText}`);
          }
      
          const data = await response.json();
      
          return data;
      } catch (error) {
          console.error(error);
          throw new Error('Failed to fetch projects activities due to network error');
      }
  }



  //get completed or archived resource
  /*
  Items and sections archive
  To reduce the size and complexity of sync requests, completed items and archived sections are not returned by the sync endpoint.

  The sync endpoint returns a completed_info resource type. This is a list of entries for any active objects that contain archived entities. The /archive/sections and /archive/items endpoints can then be used to retrieve these archived objects.

  */
  //https://developer.todoist.com/sync/v9/#items-and-sections-archive



    //https://developer.todoist.com/sync/v9/#completed-info
    //Project completed info
    //Section completed info
    //item Completed info (number of completed child items at the root of an item)
    getCompletedInfo(){
      return this.resources["completed_info"]
    }



    //https://developer.todoist.com/sync/v9/#get-all-completed-items
    //This method get a list or items ,but the structure of the item object is different, missing a lot of necessary information.
    //don't use this method
    async getAllCompletedItemsOld() {
      // 获取所有资源，假设返回的对象包含已完成的任务统计数据
      const allResources = this.getAllResources();
      // 获取已完成任务的总数
      const completedCount = allResources.stats.completed_count;
      let offsetFetch = 0;

      const accessToken = this.plugin.settings.todoistAPIToken;
      const headers = new Headers({
        Authorization: `Bearer ${accessToken}`
      });

      try {
        // 初始化合并结果对象
        let result = {
          items: [],       // 初始化 items 为数组
          projects: {},    // 初始化 projects 为对象
          sections: {}     // 初始化 sections 为对象
        };

        while (offsetFetch < completedCount) {
          // 发起 POST 请求获取已完成任务
          const response = await fetch('https://api.todoist.com/sync/v9/completed/get_all', {
            method: 'POST',
            headers,
            body: new URLSearchParams({
              'limit': "200",
              'offset': `${offsetFetch}`
            })
          });

          // 检查请求是否成功
          if (!response.ok) {
            throw new Error(`API returned error status: ${response.status}`);
          }

          // 解析响应为 JSON 格式
          const data = await response.json();

          // 合并 items 数组
          if (Array.isArray(data.items)) {
            result.items = result.items.concat(data.items);
          }

          // 合并 projects 对象
          if (data.projects && typeof data.projects === 'object') {
            result.projects = { ...result.projects, ...data.projects };
          }

          // 合并 sections 对象
          if (data.sections && typeof data.sections === 'object') {
            result.sections = { ...result.sections, ...data.sections };
          }

          // 增加 offset，获取下一个批次的数据
          offsetFetch += 200;
        }

        // 返回合并后的对象
        return result;
      } catch (error) {
        console.error("Error fetching completed items:", error);
        throw error;
      }
    }
     


    

    // https://developer.todoist.com/sync/v9/#get-completed-items
    // Retrieves a list of completed items within a project, section, or parent item
    async getAllCompletedTasksWithaParent({ project_id, section_id, item_id }){

      
      if(project_id){
        console.log(project_id)
      }
      if(section_id){
        console.log(section_id)
      }
      if(item_id){
        console.log(item_id)
      }
      let allCompletedItemsWithaParent = [];
      let hasMore = true;
      let cursor = null;
      const accessToken = this.plugin.settings.todoistAPIToken;

      try{
        while (hasMore) {
          const url = new URL('https://api.todoist.com/sync/v9/archive/items');
          
          // Add optional parameters if provided
          if (project_id) url.searchParams.set('project_id', project_id);
          if (section_id) url.searchParams.set('section_id', section_id);
          if (item_id) url.searchParams.set('item_id', item_id);
          if (cursor) url.searchParams.set('cursor', cursor);


          url.searchParams.set('limit', "100");

          if (cursor) {
            url.searchParams.set('cursor', cursor);
          }
          
          const response = await fetch(url.toString(), {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          });
      
          const data = await response.json();
          //console.log(`Project Data: ${JSON.stringify(data)}`)

          // Check if 'items' exists in the response data
          if (!data.items) {
            console.error("Unexpected response format:", data);
            return [];
          }

          allCompletedItemsWithaParent = allCompletedItemsWithaParent.concat(data.items);
          hasMore = data.has_more;
          cursor = data.next_cursor;
        }
      
        return allCompletedItemsWithaParent;
      }catch(error){
        console.error("Error fetching completed tasks for project:", error);
        throw(error)
      }

    
    }



    async getAllCompletedTasks() {
      
      let allCompletedTasks = [];
    
      // 获取所有已完成的项目
      const completed_info =  this.getCompletedInfo()
      console.log({completed_info})

      let completed_items_count = 0

      // 异步处理函数
      //这里必须使用箭头函数，否则内部无法访问 this.getAllCompletedTaskWithaParent() 函数
      const processItem = async(item) => {
        console.log(item)
        const params = { 
          project_id: item.project_id, 
          section_id: item.section_id, 
          item_id: item.item_id 
        };
        completed_items_count += item.completed_items
        console.log(`Processing id: ${JSON.stringify(params)}`);
        // 假设有一个异步操作，例如：等待1秒
        try {

    
          // 逐个执行每个项目的任务获取
          const allCompletedTasksInTheProject = await this.getAllCompletedTasksWithaParent(params);
    
          // 检查获取的任务数组是否为有效结构
          if (Array.isArray(allCompletedTasksInTheProject)) {
            console.log(`Retrieved ${allCompletedTasksInTheProject.length} tasks for project ${JSON.stringify(params)}.`);
            
            // 合并任务到总的数组中
            allCompletedTasks = allCompletedTasks.concat(allCompletedTasksInTheProject);
          } else {
            console.error(`Invalid task data structure for project ID: ${JSON.stringify(params)}`);
          }
    
        } catch (error) {
          console.error(`Failed to retrieve tasks for project ID: ${JSON.stringify(params)}`, error);
        }
        
      }
      
      // 使用经典 for 循环和 await
      const processCompletedInfo = async (completed_info) => {
        for (let i = 0; i < completed_info.length; i++) {
          await processItem(completed_info[i]);
        }
        //console.log('All completed info items processed in sequence!');
      }
      
      await processCompletedInfo(completed_info);
    
     
      
      return allCompletedTasks;
    }






}





















