import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxConfig } from '@/persistence';
import { createSessionMetadata } from './createSessionMetadata';

vi.mock('node:child_process', () => ({
    execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

function createSandboxConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
    return {
        enabled: true,
        workspaceRoot: '~/Developer',
        sessionIsolation: 'workspace',
        customWritePaths: [],
        denyReadPaths: ['~/.ssh', '~/.aws', '~/.gnupg'],
        extraWritePaths: ['/tmp'],
        denyWritePaths: ['.env'],
        networkMode: 'allowed',
        allowedDomains: [],
        deniedDomains: [],
        allowLocalBinding: true,
        ...overrides,
    };
}

describe('createSessionMetadata', () => {
    beforeEach(() => {
        mockedExecSync.mockReset();
        mockedExecSync.mockReturnValue('main\n');
    });

    it('sets metadata.sandbox to the config when enabled', () => {
        const sandbox = createSandboxConfig();
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-1',
            startedBy: 'terminal',
            sandbox,
        });

        expect(metadata.sandbox).toEqual(sandbox);
    });

    it('sets metadata.sandbox to null when sandbox is disabled', () => {
        const sandbox = createSandboxConfig({ enabled: false });
        const { metadata } = createSessionMetadata({
            flavor: 'gemini',
            machineId: 'machine-2',
            startedBy: 'daemon',
            sandbox,
        });

        expect(metadata.sandbox).toBeNull();
    });

    it('sets metadata.sandbox to null when sandbox is not provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-3',
        });

        expect(metadata.sandbox).toBeNull();
    });

    it('sets metadata.dangerouslySkipPermissions to null when not provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-4',
        });

        expect(metadata.dangerouslySkipPermissions).toBeNull();
    });

    it('sets metadata.dangerouslySkipPermissions when provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-5',
            dangerouslySkipPermissions: true,
        });

        expect(metadata.dangerouslySkipPermissions).toBe(true);
    });

    it('sets fork lineage metadata when provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-6',
            parentSessionId: 'happy-source',
            forkedFromMessageId: 'message-2',
        });

        expect(metadata.parentSessionId).toBe('happy-source');
        expect(metadata.forkedFromMessageId).toBe('message-2');
    });

    it('sets metadata.isSideChat when the session is a side chat', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-side',
            parentSessionId: 'happy-parent',
            isSideChat: true,
        });

        expect(metadata.isSideChat).toBe(true);
        expect(metadata.parentSessionId).toBe('happy-parent');
    });

    it('omits metadata.isSideChat for a normal session', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-normal',
        });

        expect(metadata.isSideChat).toBeUndefined();
    });

    it('sets metadata.gitBranch when a git branch is detected', () => {
        mockedExecSync.mockReturnValue('fix/session-status\n');

        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-7',
        });

        expect(metadata.gitBranch).toBe('fix/session-status');
        expect(mockedExecSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD', expect.objectContaining({
            cwd: process.cwd(),
        }));
    });

    it('omits metadata.gitBranch when git is unavailable or detached', () => {
        mockedExecSync.mockReturnValue('HEAD\n');

        const detached = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-8',
        });

        expect(detached.metadata.gitBranch).toBeUndefined();

        mockedExecSync.mockImplementation(() => {
            throw new Error('not a git repository');
        });

        const unavailable = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-9',
        });

        expect(unavailable.metadata.gitBranch).toBeUndefined();
    });
});

describe('createSessionMetadata model catalog', () => {
    const originalModel = process.env.ANTHROPIC_MODEL;
    const originalLabel = process.env.HAPPY_MODEL_LABEL;

    beforeEach(() => {
        mockedExecSync.mockReset();
        mockedExecSync.mockReturnValue('main\n');
        delete process.env.ANTHROPIC_MODEL;
        delete process.env.HAPPY_MODEL_LABEL;
    });

    afterEach(() => {
        if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL;
        else process.env.ANTHROPIC_MODEL = originalModel;
        if (originalLabel === undefined) delete process.env.HAPPY_MODEL_LABEL;
        else process.env.HAPPY_MODEL_LABEL = originalLabel;
    });

    it('publishes the configured Claude model so the app can show it', () => {
        process.env.ANTHROPIC_MODEL = 'deepseek-flash[1m]';

        const { metadata } = createSessionMetadata({ flavor: 'claude', machineId: 'machine-1' });

        // The code stays the full configured id — it is what the app matches
        // against. Only the label is shortened to survive the 16-character chip.
        expect(metadata.currentModelCode).toBe('deepseek-flash[1m]');
        expect(metadata.models).toEqual([
            { code: 'deepseek-flash[1m]', value: 'deepseek-flash', description: null },
        ]);
    });

    it('leaves a model id that already fits the chip untouched', () => {
        process.env.ANTHROPIC_MODEL = 'deepseek-flash';

        const { metadata } = createSessionMetadata({ flavor: 'claude', machineId: 'machine-1' });

        expect(metadata.models).toEqual([
            { code: 'deepseek-flash', value: 'deepseek-flash', description: null },
        ]);
    });

    it('uses HAPPY_MODEL_LABEL for the name the composer chip shows', () => {
        process.env.ANTHROPIC_MODEL = 'deepseek-flash[1m]';
        process.env.HAPPY_MODEL_LABEL = 'DS Flash 1M';

        const { metadata } = createSessionMetadata({ flavor: 'claude', machineId: 'machine-1' });

        expect(metadata.models).toEqual([
            { code: 'deepseek-flash[1m]', value: 'DS Flash 1M', description: null },
        ]);
    });

    it('publishes nothing without a configured model, or for other flavors', () => {
        const unconfigured = createSessionMetadata({ flavor: 'claude', machineId: 'machine-2' });

        expect(unconfigured.metadata.models).toBeUndefined();
        expect(unconfigured.metadata.currentModelCode).toBeUndefined();

        process.env.ANTHROPIC_MODEL = 'deepseek-flash[1m]';

        const codex = createSessionMetadata({ flavor: 'codex', machineId: 'machine-3' });

        expect(codex.metadata.models).toBeUndefined();
        expect(codex.metadata.currentModelCode).toBeUndefined();
    });
});
