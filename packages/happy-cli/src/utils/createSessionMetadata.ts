/**
 * Session Metadata Factory
 *
 * Creates session state and metadata objects for all backends (Claude, Codex, Gemini).
 * This follows DRY principles by providing a single implementation for all backends.
 *
 * @module createSessionMetadata
 */

import os from 'node:os';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import type { AgentState, Metadata } from '@/api/types';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import type { SandboxConfig } from '@/persistence';
import packageJson from '../../package.json';

/**
 * Backend flavor identifier for session metadata.
 */
export type BackendFlavor = 'claude' | 'codex' | 'gemini' | 'opencode' | 'openclaw' | 'agy' | 'acp';

/**
 * Options for creating session metadata.
 */
export interface CreateSessionMetadataOptions {
    /** Backend flavor (claude, codex, gemini) */
    flavor: BackendFlavor;
    /** Machine ID for server identification */
    machineId: string;
    /** How the session was started */
    startedBy?: 'daemon' | 'terminal';
    /** Active sandbox config for the session, or undefined when not used */
    sandbox?: SandboxConfig;
    /** Whether the backend runs with "dangerously skip permissions" behavior */
    dangerouslySkipPermissions?: boolean;
    /** Happy session id this session was forked from. */
    parentSessionId?: string;
    /** Happy message id used as the fork rewind point. */
    forkedFromMessageId?: string;
    /** Marks this session as a hidden side chat of `parentSessionId`. */
    isSideChat?: boolean;
}

/**
 * Result containing both state and metadata for session creation.
 */
export interface SessionMetadataResult {
    /** Agent state for session */
    state: AgentState;
    /** Session metadata */
    metadata: Metadata;
}

/**
 * The model catalog to publish for a Claude session, if any.
 *
 * Claude Code resolves its model from the environment, so the configured id is
 * the only honest answer. Publishing it matters because the app has no other
 * channel to learn it: without `models` it falls back to its own hardcoded
 * Claude catalog and its `claude-opus-5-5` default, and shows that for every
 * session no matter what actually runs. The app normalizes these two fields
 * into its picker and composer chip — the same channel ACP agents already use
 * (see the `models` / `currentModelCode` fields on Metadata).
 *
 * `value` is the label the picker and composer chip show, and the chip cuts it
 * at 16 characters, so a long id can set HAPPY_MODEL_LABEL to something short.
 *
 * Exported because the Claude backend builds its metadata inline in runClaude
 * rather than going through createSessionMetadata — the other flavors are the
 * ones this module's factory serves.
 */
export function configuredClaudeModelMetadata(): Partial<Metadata> {
    const model = process.env.ANTHROPIC_MODEL?.trim();
    if (!model) {
        return {};
    }
    const label = process.env.HAPPY_MODEL_LABEL?.trim() || shortModelLabel(model);
    return {
        models: [{ code: model, value: label, description: null }],
        currentModelCode: model,
    };
}

/**
 * A label that survives the composer chip, which cuts at 16 characters. The
 * bracketed suffix is the first thing to go (`deepseek-flash[1m]` becomes
 * `deepseek-flash`), because the chip's own cut renders as `deepseek-flash[1…`,
 * which reads as a bug rather than as a shortened name.
 */
function shortModelLabel(model: string): string {
    const CHIP_LIMIT = 16;
    if (model.length <= CHIP_LIMIT) {
        return model;
    }
    return model.replace(/\[[^\]]*\]$/, '') || model;
}

function getGitBranch(cwd: string): string | undefined {
    try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        }).trim();
        return branch && branch !== 'HEAD' ? branch : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Creates session state and metadata for backend agents.
 *
 * This utility consolidates the common session metadata creation logic used by
 * Codex and Gemini backends, ensuring consistency across all backend implementations.
 *
 * @param opts - Options specifying flavor, machineId, and startedBy
 * @returns Object containing state and metadata for session creation
 *
 * @example
 * ```typescript
 * const { state, metadata } = createSessionMetadata({
 *     flavor: 'gemini',
 *     machineId: settings.machineId,
 *     startedBy: opts.startedBy
 * });
 *
 * const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });
 * ```
 */
export function createSessionMetadata(opts: CreateSessionMetadataOptions): SessionMetadataResult {
    const state: AgentState = {
        controlledByUser: false,
    };
    const cwd = process.cwd();
    const gitBranch = getGitBranch(cwd);

    const metadata: Metadata = {
        path: cwd,
        host: os.hostname(),
        version: packageJson.version,
        os: os.platform(),
        machineId: opts.machineId,
        homeDir: os.homedir(),
        happyHomeDir: configuration.happyHomeDir,
        happyLibDir: projectPath(),
        happyToolsDir: resolve(projectPath(), 'tools', 'unpacked'),
        startedFromDaemon: opts.startedBy === 'daemon',
        hostPid: process.pid,
        startedBy: opts.startedBy || 'terminal',
        lifecycleState: 'running',
        lifecycleStateSince: Date.now(),
        flavor: opts.flavor,
        sandbox: opts.sandbox?.enabled ? opts.sandbox : null,
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions ?? null,
        ...(gitBranch ? { gitBranch } : {}),
        ...(opts.parentSessionId ? { parentSessionId: opts.parentSessionId } : {}),
        ...(opts.forkedFromMessageId ? { forkedFromMessageId: opts.forkedFromMessageId } : {}),
        ...(opts.isSideChat ? { isSideChat: true } : {}),
        ...(opts.flavor === 'claude' ? configuredClaudeModelMetadata() : {}),
    };

    return { state, metadata };
}
