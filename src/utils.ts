/**
 * Utility functions for Ultimate Todoist Sync
 */

/**
 * Generates a Todoist task URL in the new format.
 * The old format (https://todoist.com/showTask?id=XXX) is deprecated.
 * New format: https://app.todoist.com/app/task/XXX
 *
 * @param taskId - The Todoist task ID
 * @returns The URL to the task in the new format
 */
export function getTodoistTaskUrl(taskId: string): string {
    return `https://app.todoist.com/app/task/${taskId}`;
}

/**
 * Generates a Todoist app URI for deep linking.
 * Format: todoist://task?id=XXX
 *
 * @param taskId - The Todoist task ID
 * @returns The app URI for the task
 */
export function getTodoistAppUri(taskId: string): string {
    return `todoist://task?id=${taskId}`;
}
