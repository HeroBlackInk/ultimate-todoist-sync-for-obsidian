import { App} from 'obsidian';
import { UltimateTodoistSyncSettings } from './settings';



export class TodoistSyncAPI   {
	app:App;
    settings:UltimateTodoistSyncSettings;

	constructor(app:App, settings:UltimateTodoistSyncSettings) {
		//super(app,settings);
		this.app = app;
        this.settings = settings;
	}

    //backup todoist
    async getAllResources() { 
    const accessToken = this.settings.todoistAPIToken
    const url = 'https://api.todoist.com/sync/v9/sync';
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        sync_token: "*",
        resource_types: '["all"]'
      })
    };
  
    try {
      const response = await fetch(url, options);
  
      if (!response.ok) {
        throw new Error(`Failed to fetch all resources: ${response.status} ${response.statusText}`);
      }
  
      const data = await response.json();
  
      return data;
    } catch (error) {
      console.error(error);
      throw new Error('Failed to fetch all resources due to network error');
    }
    }
  
    //get activity logs
    //result  {count:number,events:[]}
    async getActivity() {
    const accessToken = this.settings.todoistAPIToken
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
  
  
    //get completed items activity
    //result  {count:number,events:[]}
    async getCompletedItemsActivity() {
        const accessToken = this.settings.todoistAPIToken
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
        const accessToken = this.settings.todoistAPIToken
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
        const accessToken = this.settings.todoistAPIToken
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
        const accessToken = this.settings.todoistAPIToken
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
      const accessToken = this.settings.todoistAPIToken
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





















