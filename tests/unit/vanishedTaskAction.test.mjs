// Unit tests for resolveVanishedTask (src/sync/vanishedTaskAction.ts).
//
// Run with `npm test`.
//
// Getting this wrong is expensive in both directions: too eager and a task that
// was merely completed in Todoist gets flagged as a problem and has its sync
// switched off; too lax and a genuinely deleted task keeps being pushed to.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVanishedTask } from '../.build/sync/vanishedTaskAction.mjs';

const GRACE = 60_000;

/** Old enough that the creation grace window does not apply. */
const settled = (overrides) => ({
	mappingAgeMs: 10 * 60_000,
	creationGraceMs: GRACE,
	vaultCompleted: false,
	...overrides,
});

test('completed in Todoist ticks the vault line', () => {
	assert.equal(resolveVanishedTask(settled({ completionState: 'completed' })), 'complete-in-vault');
});

test('completed in Todoist and already ticked just settles', () => {
	assert.equal(
		resolveVanishedTask(settled({ completionState: 'completed', vaultCompleted: true })),
		'settle'
	);
});

test('deleted in Todoist is flagged only while the vault line is open', () => {
	assert.equal(resolveVanishedTask(settled({ completionState: 'missing' })), 'flag-missing');
	assert.equal(
		resolveVanishedTask(settled({ completionState: 'missing', vaultCompleted: true })),
		'settle'
	);
});

test('an open task in Todoist means the absence was transient', () => {
	assert.equal(resolveVanishedTask(settled({ completionState: 'active' })), 'wait');
});

test('a failed lookup never disables a task', () => {
	assert.equal(resolveVanishedTask(settled({ completionState: 'unknown' })), 'wait');
	assert.equal(
		resolveVanishedTask(settled({ completionState: 'unknown', vaultCompleted: true })),
		'wait'
	);
});

test('nothing is concluded inside the creation grace window', () => {
	for (const completionState of ['completed', 'missing', 'active', 'unknown']) {
		assert.equal(
			resolveVanishedTask({
				completionState,
				vaultCompleted: false,
				mappingAgeMs: 1_000,
				creationGraceMs: GRACE,
			}),
			'wait',
			`state ${completionState} inside grace window`
		);
	}
});

test('the grace window is exclusive at its boundary', () => {
	const at = (mappingAgeMs) =>
		resolveVanishedTask({
			completionState: 'missing',
			vaultCompleted: false,
			mappingAgeMs,
			creationGraceMs: GRACE,
		});
	assert.equal(at(GRACE - 1), 'wait');
	assert.equal(at(GRACE), 'flag-missing');
});

test('an unstamped mapping is treated as old enough to judge', () => {
	// Entries written before createdAt existed have no age; they are all long-lived.
	assert.equal(
		resolveVanishedTask({
			completionState: 'completed',
			vaultCompleted: false,
			mappingAgeMs: undefined,
			creationGraceMs: GRACE,
		}),
		'complete-in-vault'
	);
});
