import { App} from 'obsidian';
import UltimateTodoistSyncForObsidian from "../main";


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

	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
        this.plugin = plugin;
        this.sync_token = "*";
        this.resources = undefined;
	}

    // Get resources from last sync call
    getCachedResources() {
        return this.resources;
    }

    // Get updated resources from todoist since last call
    async getUpdatedResources() {
        return this.getAllResources(true)
    }

    // Get all resources from todoist
    // If updateResources is true, it will use the last sync_token to fetch only the changes
    // If updateResources is false, it will fetch all resources. This is a heavy operation and should be avoided
    // For backward compatibility, updateResources is false by default
    async getAllResources(updateResources = false) {
    const accessToken = this.plugin.settings.todoistAPIToken
    const url = 'https://api.todoist.com/sync/v9/sync';
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        sync_token: (updateResources) ? this.sync_token : "*",
        resource_types: '["all"]'
      })
    };
  
    try {
      const response = await fetch(url, options);
  
      if (!response.ok) {
        throw new Error(`Failed to fetch all resources: ${response.status} ${response.statusText}`);
      }
  
      const data = await response.json();
      this.sync_token = data.sync_token;
      this.resources = data;

      return data;
    } catch (error) {
      console.error(error);
      throw new Error('Failed to fetch all resources due to network error');
    }
    }

    //backup todoist
    //FIXME: What does this do?
    async getUserResource() { 
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/sync/v9/sync';
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          sync_token: "*",
          resource_types: '["user_plan_limits"]'
        })
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

	  async getAllTasks() {
		const all_resources = await this.getUpdatedResources();
        if(this.plugin.settings.pullFromProjectId == "-1") {
            return all_resources.items;
        }
		const all_tasks_filtered = all_resources.items.filter((item: any) => item.project_id == this.plugin.settings.pullFromProjectId);
		return all_tasks_filtered;
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
     
}





















