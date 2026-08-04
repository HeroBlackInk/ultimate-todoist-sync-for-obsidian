/**
 * What to do about a mapped task that is no longer in the Sync API response.
 *
 * A completed task disappears from `/api/v1/sync` items rather than appearing
 * with checked=true, so "gone from the sync data" means completed, deleted, or
 * temporarily not-yet-synced — three cases that need very different handling and
 * used to be collapsed into "Task no longer exists in Todoist. Sync disabled."
 *
 * Kept free of imports so it can be unit-tested directly.
 */

/** What a direct task lookup told us about a task missing from the sync data. */
export type TaskCompletionState =
    /** Todoist has it, completed. */
    | 'completed'
    /** Todoist has it and it is open — it should not have been missing; treat as transient. */
    | 'active'
    /** Todoist returned 404: really gone. */
    | 'missing'
    /** The lookup failed (offline, rate limited, auth). Nothing can be concluded. */
    | 'unknown';

export type VanishedTaskAction =
    /** Tick the checkbox in the vault, then settle the mapping. */
    | 'complete-in-vault'
    /** Both sides already agree it is done; settle the mapping without writing. */
    | 'settle'
    /** Really deleted in Todoist: raise the issue and disable sync for it. */
    | 'flag-missing'
    /** Do nothing and look again later. */
    | 'wait';

export type VanishedTaskContext = {
    completionState: TaskCompletionState;
    /** Whether the vault line is already ticked. */
    vaultCompleted: boolean;
    /** Age of the mapping in ms, or undefined when it was never stamped. */
    mappingAgeMs?: number;
    /** Below this age, a task absent from the sync data is assumed to be mid-creation. */
    creationGraceMs: number;
};

export function resolveVanishedTask(context: VanishedTaskContext): VanishedTaskAction {
    const { completionState, vaultCompleted, mappingAgeMs, creationGraceMs } = context;

    // A task created moments ago may simply not be in the sync data yet. Never
    // draw conclusions inside that window — this is the window in which the
    // creation write-back and its first incremental sync are still racing.
    if (mappingAgeMs !== undefined && mappingAgeMs < creationGraceMs) {
        return 'wait';
    }

    switch (completionState) {
        case 'completed':
            // Todoist says done. Reflect it in the vault if it is not already.
            return vaultCompleted ? 'settle' : 'complete-in-vault';
        case 'missing':
            // Really deleted. A vault line that is already ticked needs no attention;
            // an open one has lost its Todoist counterpart and does.
            return vaultCompleted ? 'settle' : 'flag-missing';
        case 'active':
            // Todoist has it open, so its absence from the sync data was transient.
            return 'wait';
        case 'unknown':
        default:
            // Could not ask. Assume nothing rather than disabling a live task.
            return 'wait';
    }
}
