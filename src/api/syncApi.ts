import { App, Notice, requestUrl } from 'obsidian';
import UltimateTodoistSyncForObsidian from "../../main";
import { DeviceManager } from '../utils/deviceManager';


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

type ApiHttpError = Error & {
	statusCode: number;
	context: string;
	retryAfterSeconds?: number;
	isRetryable: boolean;
	isAuthError: boolean;
};

type RequestUrlResponse = Awaited<ReturnType<typeof requestUrl>>;

export class TodoistSyncAPI   {
	app:App;
  	plugin: UltimateTodoistSyncForObsidian;
  	deviceManager: DeviceManager;

	private readonly PARTIAL_SYNC_LIMIT = 1000;
	private readonly FULL_SYNC_LIMIT = 100;
	private readonly ROLLING_WINDOW_MINUTES = 15;
	private readonly RATE_LIMIT_BUCKET_MS = 60 * 1000;
	private rateLimitBuckets = new Map<number, { partial: number; full: number }>();

	// Store complete raw API response
	// Store complete raw API response
	private syncData: Record<string, any> | null = null;
	// taskId → what a direct lookup said about a task missing from syncData.
	private completionStateCache = new Map<string, 'completed' | 'missing'>();

	// API-level sync lock — prevents concurrent incrementalSync/initializeSync
	private _syncRunning = false;
	private _syncDirty = false;
	private _syncWaiters: Array<{ resolve: () => void; reject: (err: any) => void }> = [];
	private authFailureStatusCode: 401 | 403 | null = null;
	private authFailureToken = '';
	private authFailureBlockedUntil = 0;
	private lastAuthNoticeAt = 0;
	private readonly AUTH_NOTICE_COOLDOWN_MS = 30 * 1000;
	private readonly AUTH_FAILURE_BLOCK_MS = 60 * 1000;

	constructor(app:App, plugin:UltimateTodoistSyncForObsidian) {
		//super(app,settings);
		this.app = app;
    	this.plugin = plugin;
		this.deviceManager = new DeviceManager(app, plugin);
	}

	private getCurrentMinuteEpoch(): number {
		return Math.floor(Date.now() / this.RATE_LIMIT_BUCKET_MS);
	}

	private pruneRateLimitBuckets(nowMinute: number): void {
		const minMinute = nowMinute - (this.ROLLING_WINDOW_MINUTES - 1);
		for (const minute of this.rateLimitBuckets.keys()) {
			if (minute < minMinute) {
				this.rateLimitBuckets.delete(minute);
			}
		}
	}

	private getRateLimitUsage(nowMinute = this.getCurrentMinuteEpoch()): { partial: number; full: number } {
		this.pruneRateLimitBuckets(nowMinute);
		let partial = 0;
		let full = 0;
		for (const bucket of this.rateLimitBuckets.values()) {
			partial += bucket.partial;
			full += bucket.full;
		}
		return { partial, full };
	}

	private incrementRateLimitUsage(isFullSync: boolean): void {
		const nowMinute = this.getCurrentMinuteEpoch();
		this.pruneRateLimitBuckets(nowMinute);
		const existing = this.rateLimitBuckets.get(nowMinute) ?? { partial: 0, full: 0 };
		if (isFullSync) {
			existing.full++;
		} else {
			existing.partial++;
		}
		this.rateLimitBuckets.set(nowMinute, existing);
	}

	private estimateWaitMinutes(isFullSync: boolean, nowMinute: number): number {
		const limit = isFullSync ? this.FULL_SYNC_LIMIT : this.PARTIAL_SYNC_LIMIT;
		const key = isFullSync ? 'full' : 'partial';
		const entries = Array.from(this.rateLimitBuckets.entries())
			.filter(([minute]) => minute >= nowMinute - (this.ROLLING_WINDOW_MINUTES - 1))
			.sort((a, b) => a[0] - b[0]);

		let total = entries.reduce((sum, [, bucket]) => sum + bucket[key], 0);
		if (total < limit) return 0;

		for (const [minute, bucket] of entries) {
			total -= bucket[key];
			const wait = Math.max(1, minute + this.ROLLING_WINDOW_MINUTES - nowMinute);
			if (total < limit) return wait;
		}

		return this.ROLLING_WINDOW_MINUTES;
	}

	private async checkRateLimit(isFullSync: boolean): Promise<void> {
		const nowMinute = this.getCurrentMinuteEpoch();
		const usage = this.getRateLimitUsage(nowMinute);
		const limit = isFullSync ? this.FULL_SYNC_LIMIT : this.PARTIAL_SYNC_LIMIT;
		const used = isFullSync ? usage.full : usage.partial;

		if (used >= limit) {
			const waitMinutes = this.estimateWaitMinutes(isFullSync, nowMinute);
			const kind = isFullSync ? 'full' : 'partial';
			throw new Error(`RATE_LIMIT_EXCEEDED:${kind}:${waitMinutes}`);
		}
	}

	private handleRateLimitError(error: Error): void {
		const message = error.message;
		if (this.isApiHttpError(error) && error.statusCode === 429) {
			const retryAfter = error.retryAfterSeconds ?? 15 * 60;
			const waitMinutes = Math.max(1, Math.ceil(retryAfter / 60));
			new Notice(
				`⚠️ Too Many Requests to Todoist!\n\n` +
				`Please wait about ${waitMinutes} minutes before next sync.\n\n` +
				`Tip: Reduce sync frequency to avoid hitting rate limits.`,
				15000
			);
			return;
		}

		if (message.includes('RATE_LIMIT_EXCEEDED')) {
			const parts = message.split(':');
			const limitTypeFromError = parts.length >= 3 ? parts[1] : undefined;
			const waitMinutes = parts.length >= 3 ? parts[2] : (parts[1] || '15');
			const usage = this.getRateLimitUsage();
			const derivedType = usage.full >= this.FULL_SYNC_LIMIT ? 'full' : 'partial';
			const limitType = (limitTypeFromError === 'full' || limitTypeFromError === 'partial')
				? limitTypeFromError
				: derivedType;
			new Notice(
				`⚠️ Todoist API Rate Limit Reached!\n\n` +
				`You have reached the ${limitType} sync limit.\n` +
				`Please wait ${waitMinutes} minutes before next sync.\n\n` +
				`Tip: Reduce sync frequency to avoid hitting limits.`,
				15000
			);
		} else if (message.includes('429')) {
			new Notice(
				`⚠️ Too Many Requests to Todoist!\n\n` +
				`Please wait 15 minutes before next sync.\n\n` +
				`Tip: Reduce sync frequency to avoid hitting rate limits.`,
				15000
			);
		}
	}

	private isApiHttpError(error: unknown): error is ApiHttpError {
		if (!(error instanceof Error)) return false;
		const candidate = error as Partial<ApiHttpError>;
		return typeof candidate.statusCode === 'number' && typeof candidate.context === 'string';
	}

	private normalizeRequestUrlThrownHttpError(context: string, error: unknown): ApiHttpError | null {
		if (!error || typeof error !== 'object') return null;
		const candidate = error as {
			status?: unknown;
			statusCode?: unknown;
			headers?: unknown;
		};

		const statusCode = typeof candidate.status === 'number'
			? candidate.status
			: (typeof candidate.statusCode === 'number' ? candidate.statusCode : null);
		if (statusCode === null) return null;

		let retryAfterSeconds: number | undefined;
		if (statusCode === 429 && candidate.headers && typeof candidate.headers === 'object') {
			const headerRecord = candidate.headers as Record<string, unknown>;
			const retryAfterRaw = headerRecord['retry-after'] ?? headerRecord['Retry-After'];
			if (typeof retryAfterRaw === 'string') {
				const parsed = Number.parseInt(retryAfterRaw, 10);
				if (Number.isFinite(parsed) && parsed > 0) {
					retryAfterSeconds = parsed;
				}
			}
		}

		return Object.assign(new Error(`${context} failed: HTTP ${statusCode}`), {
			statusCode,
			context,
			retryAfterSeconds,
			isRetryable: statusCode === 429 || statusCode >= 500,
			isAuthError: statusCode === 401 || statusCode === 403,
		}) as ApiHttpError;
	}

	private getRetryAfterSeconds(response: RequestUrlResponse): number | undefined {
		const body = response.json as { error_extra?: { retry_after?: unknown } } | undefined;
		const retryAfterFromBody = body?.error_extra?.retry_after;
		if (typeof retryAfterFromBody === 'number' && Number.isFinite(retryAfterFromBody) && retryAfterFromBody > 0) {
			return retryAfterFromBody;
		}

		const headers = response.headers as unknown;
		if (headers && typeof headers === 'object') {
			const headerRecord = headers as Record<string, unknown>;
			const raw = headerRecord['retry-after'] ?? headerRecord['Retry-After'];
			if (typeof raw === 'string') {
				const parsed = Number.parseInt(raw, 10);
				if (Number.isFinite(parsed) && parsed > 0) return parsed;
			}
		}

		return undefined;
	}

	private createApiHttpError(context: string, response: RequestUrlResponse): ApiHttpError {
		const statusCode = response.status;
		const retryAfterSeconds = statusCode === 429 ? this.getRetryAfterSeconds(response) : undefined;
		let message = `${context} failed: HTTP ${statusCode}`;
		if (statusCode === 400) message = `${context} failed: HTTP 400 Bad Request`;
		if (statusCode === 401) message = `${context} failed: HTTP 401 Unauthorized`;
		if (statusCode === 403) message = `${context} failed: HTTP 403 Forbidden`;
		if (statusCode === 404) message = `${context} failed: HTTP 404 Not Found`;
		if (statusCode === 429) {
			message = `${context} failed: HTTP 429 Too Many Requests${retryAfterSeconds ? ` (retry_after=${retryAfterSeconds}s)` : ''}`;
		}

		return Object.assign(new Error(message), {
			statusCode,
			context,
			retryAfterSeconds,
			isRetryable: statusCode === 429 || statusCode >= 500,
			isAuthError: statusCode === 401 || statusCode === 403,
		});
	}

	private maybeNotifyAuthFailure(statusCode: 401 | 403): void {
		const now = Date.now();
		if (now - this.lastAuthNoticeAt < this.AUTH_NOTICE_COOLDOWN_MS) return;
		this.lastAuthNoticeAt = now;

		if (statusCode === 401) {
			new Notice('Todoist authentication failed (401). Please verify or refresh your API token.', 10000);
			return;
		}

		new Notice('Todoist access forbidden (403). Token or permission may be invalid. Please re-check Todoist authorization.', 10000);
	}

	private registerAuthFailure(statusCode: 401 | 403): void {
		this.authFailureStatusCode = statusCode;
		this.authFailureToken = this.plugin.settings.todoistAPIToken || '';
		this.authFailureBlockedUntil = Date.now() + this.AUTH_FAILURE_BLOCK_MS;
		this.maybeNotifyAuthFailure(statusCode);
	}

	private clearAuthFailureIfTokenChanged(): void {
		const currentToken = this.plugin.settings.todoistAPIToken || '';
		if (this.authFailureStatusCode !== null && this.authFailureToken !== currentToken) {
			this.authFailureStatusCode = null;
			this.authFailureToken = '';
			this.authFailureBlockedUntil = 0;
		}
	}

	private ensureAuthFailureNotBlocked(context: string): void {
		this.clearAuthFailureIfTokenChanged();
		if (this.authFailureStatusCode === null) return;
		if (Date.now() >= this.authFailureBlockedUntil) {
			this.authFailureStatusCode = null;
			this.authFailureToken = '';
			this.authFailureBlockedUntil = 0;
			return;
		}

		const statusCode = this.authFailureStatusCode;
		const message = `${context} aborted: previous Todoist auth failure (${statusCode}). Update token/permissions before retrying.`;
		const blockedError = Object.assign(new Error(message), {
			statusCode,
			context,
			isRetryable: false,
			isAuthError: true,
		}) as ApiHttpError;
		throw blockedError;
	}

	private assertSuccessfulResponse(context: string, response: RequestUrlResponse): void {
		if (response.status >= 200 && response.status < 300) return;

		const httpError = this.createApiHttpError(context, response);
		if (httpError.statusCode === 401 || httpError.statusCode === 403) {
			this.registerAuthFailure(httpError.statusCode);
		}
		throw httpError;
	}

	private async getClientHeader(): Promise<string> {
		return await this.deviceManager.getClientHeader();
	}

  private async resolveLegacyId(objName: 'projects' | 'tasks' | 'sections', id?: string | null): Promise<string | undefined> {
    if (!id) {
      return undefined;
    }

    return await this.plugin.todoistRestAPI?.resolveId(objName, id);
  }

	// Waiters must be drained *after* the run completes, not captured before it:
	// callers that join while a sync is in flight push themselves onto the queue
	// during the run, and would otherwise stay pending until some later sync
	// happened to drain them — hanging every `await incrementalSync()` and, with
	// it, the sync lock its caller is holding.
	private resolveSyncWaiters(): void {
		for (const waiter of this._syncWaiters.splice(0)) {
			waiter.resolve();
		}
	}

	private rejectSyncWaiters(error: unknown): void {
		for (const waiter of this._syncWaiters.splice(0)) {
			waiter.reject(error);
		}
	}

	async initializeSync(): Promise<void> {
		// Route through incrementalSync lock so concurrent callers wait
		if (this._syncRunning) {
			return new Promise<void>((resolve, reject) => {
				this._syncDirty = true;
				this._syncWaiters.push({ resolve, reject });
			});
		}
		this._syncRunning = true;
		this._syncDirty = false;
		try {
			const data = await this.getAllResources(true);
			this.syncData = data;
			await this.plugin.safeSettings?.update({ syncDataCache: data }, true);
			this.plugin.debugLog('[TodoistSyncAPI] Sync initialized with full data and cached');
			// A full sync answers every waiter, including those that joined mid-run.
			this.resolveSyncWaiters();
		} catch (error) {
			this.rejectSyncWaiters(error);
			throw error;
		} finally {
			this._syncRunning = false;
		}
	}
	async incrementalSync(): Promise<void> {
		if (!this.syncData) {
			await this.initializeSync();
			return;
		}

		// If a sync is already running, mark dirty and wait for it to finish
		if (this._syncRunning) {
			return new Promise<void>((resolve, reject) => {
				this._syncDirty = true;
				this._syncWaiters.push({ resolve, reject });
			});
		}

		this._syncRunning = true;
		this._syncDirty = false;
		try {
			do {
				this._syncDirty = false;
				const changes = await this.getAllResources(false);
				// Detect sync_token expiration: if Todoist returns full_sync=true,
				// the token was expired/invalid. Fall back to full sync.
				if (changes.full_sync === true) {
					console.warn('[TodoistSyncAPI] sync_token expired, falling back to full sync');
					this.syncData = changes;
					await this.plugin.safeSettings?.update({ syncDataCache: this.syncData }, true);
					this.plugin.debugLog('[TodoistSyncAPI] Full sync fallback completed');
					break;
				}
				this.mergeSyncData(changes);
				await this.plugin.safeSettings?.update({ syncDataCache: this.syncData }, true);
				this.plugin.debugLog('[TodoistSyncAPI] Incremental sync completed and cached');
			} while (this._syncDirty);
			// Loop condition guarantees anyone who joined mid-run got a fetch that
			// started after their change landed.
			this.resolveSyncWaiters();
		} catch (error) {
			console.error('[TodoistSyncAPI] Incremental sync failed:', error);
			this.rejectSyncWaiters(error);
			throw error;
		} finally {
			this._syncRunning = false;
		}
	}

	private mergeSyncData(changes: any): void {
		if (!this.syncData) return;

		// Merge all top-level fields from the API response
		for (const key of Object.keys(changes)) {
			if (key === 'sync_token') {
				// Update sync_token separately
				this.syncData.sync_token = changes.sync_token;
				continue;
			}

			const changesData = changes[key];

			// Handle array data with ID-based merging (projects, items, sections, labels, notes)
			if (Array.isArray(changesData)) {
				const existingData = this.syncData[key];
				if (Array.isArray(existingData)) {
					const dataMap = new Map(existingData.map((item: any) => [item.id, item]));
					for (const item of changesData) {
						if (item.is_deleted) {
							dataMap.delete(item.id);
						} else {
							dataMap.set(item.id, item);
						}
					}
					this.syncData[key] = Array.from(dataMap.values());
				} else {
					// No existing data, just use the changes
					this.syncData[key] = changesData;
				}
			} else {
				// Non-array data (objects like settings, user, etc.) - just replace
				this.syncData[key] = changesData;
			}
		}
	}

	getSyncData(): Record<string, any> | null {
		return this.syncData;
	}

	// Load sync data from cache (called on plugin startup)
	loadFromCache(): boolean {
		if (this.plugin.settings.syncDataCache) {
			this.syncData = this.plugin.settings.syncDataCache;
			this.plugin.debugLog('[TodoistSyncAPI] Loaded sync data from cache');
			return true;
		}
		return false;
	}

    async getAllResources(fullSync = false) { 
		this.ensureAuthFailureNotBlocked('getAllResources');
		const clientId = await this.getClientHeader();
     	const accessToken = this.plugin.settings.todoistAPIToken;
		const syncToken = fullSync ? '*' : (this.syncData?.sync_token || '*');
		
		await this.checkRateLimit(fullSync);

    	const url = 'https://api.todoist.com/api/v1/sync';
    	const options = {
    		url: url,
    		method: 'POST',
    		headers: {
    			'Authorization': `Bearer ${accessToken}`,
 				'Content-Type': 'application/json',
 				'X-Todoist-Client': clientId
    		},
    		body: JSON.stringify({
    			sync_token: syncToken,
    			resource_types: ['all'],
    		}),
    	};
  
	    	try {
	    		const response = await requestUrl(options);
			this.assertSuccessfulResponse('getAllResources', response);
  
  			const data = response.json;

		this.incrementRateLimitUsage(fullSync);
  
      		return data;
	    	} catch (error) {
			if (this.isApiHttpError(error)) {
				if (error.statusCode === 401 || error.statusCode === 403) {
					this.registerAuthFailure(error.statusCode);
				}
				if (error.statusCode === 429) {
					this.handleRateLimitError(error);
				}
				console.error(error);
				throw error;
			}

			const normalizedHttpError = this.normalizeRequestUrlThrownHttpError('getAllResources', error);
			if (normalizedHttpError) {
				if (normalizedHttpError.statusCode === 401 || normalizedHttpError.statusCode === 403) {
					this.registerAuthFailure(normalizedHttpError.statusCode);
				}
				if (normalizedHttpError.statusCode === 429) {
					this.handleRateLimitError(normalizedHttpError);
				}
				console.error(error);
				throw normalizedHttpError;
			}

			if (error instanceof Error && (error.message.includes('RATE_LIMIT') || error.message.includes('429'))) {
				this.handleRateLimitError(error);
				console.error(error);
				throw error;
			}

			console.error(error);
			if (error instanceof Error) {
				throw error;
			}
			throw new Error('Failed to fetch all resources due to network error');
	    	}
    }

    //backup todoist
    async getUserResource() { 
	  this.ensureAuthFailureNotBlocked('getUserResource');
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/api/v1/sync';
      const options = {
        url: url,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sync_token: '*',
          resource_types: ['user_plan_limits'],
        }),
      };
    
      try {
        const response = await requestUrl(options);
		this.assertSuccessfulResponse('getUserResource', response);
    
        const data = response.json;
        this.plugin.debugLog(data)
        return data;
      } catch (error) {
		if (this.isApiHttpError(error)) {
			throw error;
		}
        console.error(error)
        throw new Error('Failed to fetch user resources due to network error');
      }
      }


      //update user timezone
      async updateUserTimezone() { 
		this.ensureAuthFailureNotBlocked('updateUserTimezone');
        const unixTimestampString: string = Math.floor(Date.now() / 1000).toString();
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/sync';
        const commands = [
          {
            'type': "user_update",
            'uuid': unixTimestampString,
            'args': { 'timezone': Intl.DateTimeFormat().resolvedOptions().timeZone },
          },
        ];
        const options = {
          url: url,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ commands }),
        };

        try {
          const response = await requestUrl(options);
		  this.assertSuccessfulResponse('updateUserTimezone', response);

          const data = response.json;
          this.plugin.debugLog(data)
          return data;
        } catch (error) {
		  if (this.isApiHttpError(error)) {
			  throw error;
		  }
          console.error('[updateUserTimezone] Failed:', error);
          throw new Error('Failed to fetch user resources due to network error');
        }
        }
   
    //get activity logs
    //result  {results:[],next_cursor:null}
    async getAllActivityEvents() {
	this.ensureAuthFailureNotBlocked('getAllActivityEvents');
  	const clientId = await this.getClientHeader();
    const accessToken = this.plugin.settings.todoistAPIToken
    
      try {
        const response = await requestUrl({
          url: 'https://api.todoist.com/api/v1/activities',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
    		'X-Todoist-Client': clientId
          }
        });
    
		this.assertSuccessfulResponse('getAllActivityEvents', response);
    
        const data = response.json;
    
        // API v1 返回格式: { results: [], next_cursor: null }
        // 转换为旧格式: { events: [] }
        return { events: data.results || [] };
      } catch (error) {
		if (this.isApiHttpError(error)) {
			throw error;
		}
        throw error;
      }
    }


  
  

    

    filterActivityEvents(events: Event[], options: FilterOptions): Event[] {
      return events.filter(event => 
        (options.event_type ? event.event_type === options.event_type : true) &&
        (options.object_type ? event.object_type === options.object_type : true)
    
        );
    }

    //get completed items activity
    //result  {results:[],next_cursor:null}
    async getCompletedItemsActivity() {
		this.ensureAuthFailureNotBlocked('getCompletedItemsActivity');
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/activities?event_type=completed';
        
        try {
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
        
			this.assertSuccessfulResponse('getCompletedItemsActivity', response);
        
            const data = response.json;
        
            // API v1 返回格式: { results: [], next_cursor: null }
            // 转换为旧格式: { events: [] }
            return { events: data.results || [] };
        } catch (error) {
			if (this.isApiHttpError(error)) {
				throw error;
			}
            console.error(error);
            throw new Error('Failed to fetch completed items due to network error');
        }
    }
  
  
  
    //get uncompleted items activity
    //result  {results:[],next_cursor:null}
    async getUncompletedItemsActivity() {
		this.ensureAuthFailureNotBlocked('getUncompletedItemsActivity');
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/activities?event_type=uncompleted';
    
        try {
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
    
			this.assertSuccessfulResponse('getUncompletedItemsActivity', response);
    
            const data = response.json;
    
            // API v1 返回格式: { results: [], next_cursor: null }
            // 转换为旧格式: { events: [] }
            return { events: data.results || [] };
        } catch (error) {
			if (this.isApiHttpError(error)) {
				throw error;
			}
            console.error(error);
            throw new Error('Failed to fetch uncompleted items due to network error');
        }
    }
  
   

  
  

  
  
    //get updated items activity
    //result  {results:[],next_cursor:null}
    async getUpdatedItemsActivity() {
		this.ensureAuthFailureNotBlocked('getUpdatedItemsActivity');
        const accessToken = this.plugin.settings.todoistAPIToken
        const url = 'https://api.todoist.com/api/v1/activities?event_type=updated';
    
        try {
            const response = await requestUrl({
                url: url,
                method: 'GET',
                headers: {
                'Authorization': `Bearer ${accessToken}`
                }
            });
    
			this.assertSuccessfulResponse('getUpdatedItemsActivity', response);
    
            const data = response.json;
    
            // API v1 返回格式: { results: [], next_cursor: null }
            // 转换为旧格式: { events: [] }
            return { events: data.results || [] };
        } catch (error) {
			if (this.isApiHttpError(error)) {
				throw error;
			}
            console.error(error);
            throw new Error('Failed to fetch updated items due to network error');
        }
    }
   
   


//get projects activity
    //result  {results:[],next_cursor:null}
    async getProjectsActivity() {
	  this.ensureAuthFailureNotBlocked('getProjectsActivity');
      const accessToken = this.plugin.settings.todoistAPIToken
      const url = 'https://api.todoist.com/api/v1/activities?object_type=project';
      
      try {
          const response = await requestUrl({
              url: url,
              method: 'GET',
              headers: {
              'Authorization': `Bearer ${accessToken}`
              }
          });
      
		  this.assertSuccessfulResponse('getProjectsActivity', response);
      
          const data = response.json;
      
          // API v1 返回格式: { results: [], next_cursor: null }
          // 转换为旧格式: { events: [] }
          return { events: data.results || [] };
      } catch (error) {
		  if (this.isApiHttpError(error)) {
			  throw error;
		  }
          console.error(error);
          throw new Error('Failed to fetch projects activities due to network error');
      }
  }

  // Generate unique UUID for commands
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private generateTempId(): string {
    return this.generateUUID();
  }

  // Execute Sync API commands
  async executeCommands(commands: any[]): Promise<any> {
	this.ensureAuthFailureNotBlocked('executeCommands');
  	await this.checkRateLimit(false);

 	const clientId = await this.getClientHeader();
    const accessToken = this.plugin.settings.todoistAPIToken;
    const url = 'https://api.todoist.com/api/v1/sync';
    
    const options = {
      url: url,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
 		'Content-Type': 'application/json',
 		'X-Todoist-Client': clientId
      },
      body: JSON.stringify({ commands }),
    };

    try {
      const response = await requestUrl(options);
		this.assertSuccessfulResponse('executeCommands', response);
      const data = response.json;

		if (data?.sync_status) {
			for (const [uuid, status] of Object.entries(data.sync_status)) {
				if (status !== 'ok' && typeof status === 'object' && status !== null) {
					const err = status as { error?: string; error_code?: number; error_tag?: string };
					console.error(`[TodoistSyncAPI] Command ${uuid} failed:`, err);
				}
			}
		}

		this.incrementRateLimitUsage(false);


      return data;
    } catch (error) {
		if (this.isApiHttpError(error)) {
			if (error.statusCode === 429) this.handleRateLimitError(error);
			console.error('Error executing commands:', error);
			throw error;
		}

		if (error instanceof Error && (error.message.includes('RATE_LIMIT') || error.message.includes('429'))) {
			this.handleRateLimitError(error);
		}
	      	console.error('Error executing commands:', error);
	      	throw error;
    }
  }

  // Add task using Sync API
  async addTask(args: {
    content: string;
    project_id: string;
    parent_id?: string;
    due?: { string?: string; date?: string; datetime?: string };
    priority?: number;
    description?: string;
    labels?: string[];
  }): Promise<any> {
    const todoistRestAPI = this.plugin.todoistRestAPI;
    if (!todoistRestAPI) {
      throw new Error('Todoist REST API is not initialized');
    }

    const projectId = await this.resolveLegacyId('projects', args.project_id);
    const parentId = await this.resolveLegacyId('tasks', args.parent_id);
    return await todoistRestAPI.AddTask({
      projectId: projectId || undefined,
      content: args.content,
      parentId,
      dueDate: args.due?.date,
      dueDatetime: args.due?.datetime,
      labels: args.labels,
      description: args.description,
      priority: args.priority,
    });
  }

  // Update task using Sync API
  async updateTask(taskId: string, args: {
    content?: string;
    description?: string;
    priority?: number;
    labels?: string[];
    parent_id?: string;
    due?: { string?: string; date?: string; datetime?: string };
  }): Promise<any> {
    const todoistRestAPI = this.plugin.todoistRestAPI;
    if (!todoistRestAPI) {
      throw new Error('Todoist REST API is not initialized');
    }

    const resolvedTaskId = await this.resolveLegacyId('tasks', taskId);
    return await todoistRestAPI.UpdateTask(resolvedTaskId || taskId, {
      content: args.content,
      description: args.description,
      labels: args.labels,
      dueDate: args.due?.date,
      dueDatetime: args.due?.datetime,
      dueString: args.due?.string,
      parentId: await this.resolveLegacyId('tasks', args.parent_id),
      priority: args.priority,
    });
  }

  // Close task using Sync API
  async closeTask(taskId: string): Promise<boolean> {
    const todoistRestAPI = this.plugin.todoistRestAPI;
    if (!todoistRestAPI) {
      throw new Error('Todoist REST API is not initialized');
    }

    const resolvedTaskId = await this.resolveLegacyId('tasks', taskId);
    return await todoistRestAPI.CloseTask(resolvedTaskId || taskId);
  }

  // Reopen task using Sync API (item_uncomplete per official docs)
  async reopenTask(taskId: string): Promise<boolean> {
    const todoistRestAPI = this.plugin.todoistRestAPI;
    if (!todoistRestAPI) {
      throw new Error('Todoist REST API is not initialized');
    }

    const resolvedTaskId = await this.resolveLegacyId('tasks', taskId);
    return await todoistRestAPI.OpenTask(resolvedTaskId || taskId);
  }

  // Compatible wrapper: AddTask
  async AddTask(task: {
    projectId: string;
    content: string;
    parentId?: string | null;
    dueDate?: string;
    dueDatetime?: string;
    labels?: string[];
    description?: string;
    priority?: number;
  }): Promise<any> {
    const args: any = {
      content: task.content,
    };

    if (task.projectId) {
      args.project_id = task.projectId;
    }

    if (task.parentId) {
      args.parent_id = task.parentId;
    }

    if (task.dueDate) {
      args.due = { date: task.dueDate };
    } else if (task.dueDatetime) {
      args.due = { datetime: task.dueDatetime };
    }

    if (task.priority) {
      args.priority = task.priority;
    }

    if (task.description) {
      args.description = task.description;
    }

    if (task.labels && task.labels.length > 0) {
      args.labels = task.labels;
    }

    return this.addTask(args);
  }

  // Compatible wrapper: UpdateTask
  async UpdateTask(taskId: string, updates: {
    content?: string;
    description?: string;
    labels?: string[];
    dueDate?: string;
    dueDatetime?: string;
    dueString?: string;
    parentId?: string;
    priority?: number;
  }): Promise<any> {
    const args: any = {};

    if (updates.content) args.content = updates.content;
    if (updates.description) args.description = updates.description;
    if (updates.labels) args.labels = updates.labels;
    if (updates.parentId) args.parent_id = updates.parentId;
    if (updates.priority) args.priority = updates.priority;

    if (updates.dueDate) {
      args.due = { date: updates.dueDate };
    } else if (updates.dueDatetime) {
      args.due = { datetime: updates.dueDatetime };
    } else if (updates.dueString) {
      args.due = { string: updates.dueString };
    }

    return this.updateTask(taskId, args);
  }

  // Compatible wrapper: CloseTask
  async CloseTask(taskId: string): Promise<boolean> {
    return this.closeTask(taskId);
  }

  // Compatible wrapper: OpenTask
  async OpenTask(taskId: string): Promise<boolean> {
    return this.reopenTask(taskId);
  }

  // Compatible wrapper: GetAllProjects
  async GetAllProjects(): Promise<any[]> {
    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      return this.syncData?.projects || [];
    } catch (error) {
      console.error('Error getting all projects:', error);
      throw error;
    }
  }

  // Compatible wrapper: GetTaskById
  async GetTaskById(taskId: string, options?: { allowNetworkRefresh?: boolean }): Promise<any> {
    try {
      taskId = (await this.resolveLegacyId('tasks', taskId)) || taskId;
      const allowNetworkRefresh = options?.allowNetworkRefresh !== false;

      if (!this.syncData) {
        if (!allowNetworkRefresh) {
          return undefined;
        }
        this.syncData = await this.getAllResources(true);
      }
      const tasks = this.syncData?.items || [];
      const found = tasks.find((t: any) => t.id === taskId);
      if (found) return found;

      if (!allowNetworkRefresh) {
        return undefined;
      }

      // A task we already know is completed or deleted will never come back in a
      // sync, so refreshing for it is a guaranteed-useless round trip. Without
      // this, every settled task costs one full sync per pass that touches it.
      const knownTerminal = this.completionStateCache.get(taskId);
      if (knownTerminal) {
        this.plugin.debugLog(`[TodoistSyncAPI] Skipping refresh for ${taskId}: known ${knownTerminal}`);
        return undefined;
      }

      // Not in local cache — do an incremental sync and retry once.
      // This handles the race where a task was just created and syncData
      // hasn't been updated yet (e.g. lineModifiedTaskCheck fires immediately
      // after lineContentNewTaskCheck).
      try {
        await this.incrementalSync();
      } catch (error) {
        console.warn(`[TodoistSyncAPI] Incremental refresh in GetTaskById failed for ${taskId}:`, error);
      }
      const refreshed = this.syncData?.items || [];
      return refreshed.find((t: any) => t.id === taskId);
    } catch (error) {
      console.error('Error getting task by id:', error);
      throw error;
    }
  }

  /**
   * What became of a task that is not in the sync data: 'completed', 'active',
   * 'missing', or 'unknown' when Todoist could not be reached.
   *
   * Results are cached for the session so a task that stays gone — which is the
   * normal state for a completed one — costs one request rather than one per
   * sync pass. 'unknown' is never cached, so a failed lookup is retried.
   */
  async GetTaskCompletionState(taskId: string): Promise<'completed' | 'active' | 'missing' | 'unknown'> {
    const cached = this.completionStateCache.get(taskId);
    if (cached) return cached;

    const restApi = this.plugin.todoistRestAPI;
    if (!restApi) return 'unknown';

    const resolvedId = (await this.resolveLegacyId('tasks', taskId)) || taskId;

    // A pre-migration numeric ID that Todoist could not map to a current one is
    // unaddressable, so a lookup by it would 404 and read as "deleted" for a task
    // that may be perfectly alive under its new ID. Refuse to guess.
    if (/^\d+$/.test(taskId) && resolvedId === taskId) {
      this.plugin.debugLog(`[TodoistSyncAPI] ${taskId} is an unresolved legacy ID; completion state unknown`);
      return 'unknown';
    }

    const state = await restApi.getTaskCompletionState(resolvedId);
    // Only terminal verdicts are cached. 'active' means the absence was transient,
    // so caching it would hide a completion that happens later in the session, and
    // 'unknown' means the question was never answered.
    if (state === 'completed' || state === 'missing') {
      this.completionStateCache.set(taskId, state);
    }
    this.plugin.debugLog(`[TodoistSyncAPI] Completion state for ${taskId}: ${state}`);
    return state;
  }

  // Local-only lookup: no network requests, returns undefined if not found
  getTaskByIdLocal(taskId: string): any {
    return this.syncData?.items?.find((t: any) => t.id === taskId);
  }

  // Compatible wrapper: GetActiveTasks
  async GetActiveTasks(options?: {
    projectId?: string;
    section_id?: string;
    label?: string;
    filter?: string;
    lang?: string;
    ids?: string[];
  }): Promise<any[]> {
    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      let tasks = this.syncData?.items || [];
      const resolvedProjectId = options?.projectId
        ? await this.resolveLegacyId('projects', options.projectId)
        : undefined;

      if (options) {
        if (resolvedProjectId) {
          tasks = tasks.filter((t: any) => t.project_id === resolvedProjectId);
        }
        if (options.section_id) {
          tasks = tasks.filter((t: any) => t.section_id === options.section_id);
        }
        if (options.label) {
          tasks = tasks.filter((t: any) => t.labels && t.labels.includes(options.label));
        }
        if (options.ids && options.ids.length > 0) {
          tasks = tasks.filter((t: any) => options.ids!.includes(t.id));
        }
      }

      return tasks;
    } catch (error) {
      console.error('Error getting active tasks:', error);
      throw error;
    }
  }

  // Get project by ID from syncData
  async getProjectById(projectId: string): Promise<any> {
    try {
      projectId = (await this.resolveLegacyId('projects', projectId)) || projectId;
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      const projects = this.syncData?.projects || [];
      return projects.find((p: any) => p.id === projectId);
    } catch (error) {
      console.error('Error getting project by id:', error);
      throw error;
    }
  }

  // Get project by name from syncData
  async getProjectByName(projectName: string): Promise<any> {
    try {
      if (!this.syncData) {
        this.syncData = await this.getAllResources(true);
      }
      const projects = this.syncData?.projects || [];
      return projects.find((p: any) => p.name === projectName);
    } catch (error) {
      console.error('Error getting project by name:', error);
      throw error;
    }
  }

  // Compatible wrapper: InitializeAPI (returns self for compatibility)
  initializeAPI(): TodoistSyncAPI {
    return this;
  }

  // Delete task using Sync API
  async deleteTask(taskId: string): Promise<boolean> {
    const todoistRestAPI = this.plugin.todoistRestAPI;
    if (!todoistRestAPI) {
      throw new Error('Todoist REST API is not initialized');
    }

    const resolvedTaskId = await this.resolveLegacyId('tasks', taskId);
    return await todoistRestAPI.DeleteTask(resolvedTaskId || taskId);
  }

  /**
   * Convert legacy (numeric) IDs to new opaque string IDs by matching task content
   * @param tasksNeedConversion - Array of tasks with legacy IDs and their content
   * @returns Mapping from legacy ID to new ID
   */
  async convertLegacyIds(
    tasksNeedConversion: { taskId: string; content: string; filePath: string; lineNumber: number }[]
  ): Promise<{ [oldId: string]: string }> {
    const mapping: { [oldId: string]: string } = {};
    console.log(`[convertLegacyIds] start: inputCandidates=${tasksNeedConversion?.length || 0}`);
    
    if (!tasksNeedConversion || tasksNeedConversion.length === 0) {
      console.log('[convertLegacyIds] early-return: no candidates');
      return mapping;
    }

    try {
      if (!this.syncData) {
        console.log('[convertLegacyIds] syncData missing -> fetching full resources');
        this.syncData = await this.getAllResources(true);
      }
      const allTasks = this.syncData?.items || [];
      console.log(`[convertLegacyIds] todoistItemsLoaded=${allTasks.length}`);
      
      for (const taskInfo of tasksNeedConversion) {
        const normalizedContent = this.normalizeContent(taskInfo.content);
        console.log(`[convertLegacyIds] checking candidate oldId=${taskInfo.taskId} file=${taskInfo.filePath}:${taskInfo.lineNumber} normalizedContent="${normalizedContent}"`);
        
        const matches = allTasks.filter((t: any) => 
          this.normalizeContent(t.content) === normalizedContent
        );
        console.log(`[convertLegacyIds] candidate oldId=${taskInfo.taskId} matches=${matches.length}`);
        
        if (matches.length === 0) {
          this.plugin.debugLog(`[convertLegacyIds] No match found for: ${taskInfo.content}`);
          console.log(`[convertLegacyIds] skip-no-match oldId=${taskInfo.taskId}`);
          continue;
        }
        
        if (matches.length > 1) {
          // Disambiguate by comparing filePath from Todoist description
          const filePathMatches = matches.filter((t: any) => {
            const descPath = this.plugin.taskParser?.extractFilePathFromObsidianDescription(t.description || '');
            return descPath && descPath === taskInfo.filePath;
          });
          if (filePathMatches.length === 1) {
            mapping[taskInfo.taskId] = filePathMatches[0].id;
            console.log(`[convertLegacyIds] resolved-by-filepath oldId=${taskInfo.taskId} -> newId=${filePathMatches[0].id}`);
            this.plugin.debugLog(`[convertLegacyIds] Resolved ambiguous match via filePath: ${taskInfo.taskId} -> ${filePathMatches[0].id}`);
            continue;
          }
          console.warn(`[convertLegacyIds] Multiple matches found for "${taskInfo.content}" in ${taskInfo.filePath}:${taskInfo.lineNumber}, skipping (${filePathMatches.length} after filepath filter)...`);
          console.log(`[convertLegacyIds] skip-ambiguous-after-filepath oldId=${taskInfo.taskId}`);
          continue;
        }
        
        mapping[taskInfo.taskId] = matches[0].id;
        console.log(`[convertLegacyIds] mapped oldId=${taskInfo.taskId} -> newId=${matches[0].id}`);
        this.plugin.debugLog(`[convertLegacyIds] Mapped ${taskInfo.taskId} -> ${matches[0].id} (${taskInfo.content})`);
      }
      
      this.plugin.debugLog(`[convertLegacyIds] Converted ${Object.keys(mapping).length} IDs`);
      console.log(`[convertLegacyIds] done: converted=${Object.keys(mapping).length} input=${tasksNeedConversion.length}`);
    } catch (error) {
      console.error('[convertLegacyIds] Error converting legacy IDs:', error);
      console.log('[convertLegacyIds] failed: throwing error to caller');
      throw error;
    }
    
    return mapping;
  }

  private normalizeContent(content: string): string {
    return content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
        
}
