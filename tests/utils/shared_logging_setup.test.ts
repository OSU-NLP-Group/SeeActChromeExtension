import {assertIsValidLogLevelName, augmentLogMsg} from '../../src/utils/shared_logging_setup';
import log, {LogLevelNames} from 'loglevel';

describe('augmentLogMsg', () => {
    it('returns correct message for valid inputs and INFO level in main-popup logger', () => {
        const timestampStr = new Date(2022, 0, 1, 0, 0, 0, 0).toISOString();
        const loggerName = 'main-popup';
        const levelName: LogLevelNames = 'info';
        const args = ['arg1'];
        const expectedMsg = `${timestampStr} ${loggerName} ${levelName.toUpperCase()} arg1`;
        expect(augmentLogMsg(timestampStr, loggerName, levelName, ...args)).toBe(expectedMsg);
    });

    it('returns correct message for valid inputs and WARN level in service-worker logger', () => {
        const timestampStr = new Date(2022, 3, 2, 12, 34, 56, 789).toISOString();
        const loggerName = 'service-worker';
        const levelName: LogLevelNames = 'warn';
        const args = ['arg1', 'arg2', 3.2];
        const expectedMsg = `${timestampStr} ${loggerName} ${levelName.toUpperCase()} arg1 arg2 3.2`;
        expect(augmentLogMsg(timestampStr, loggerName, levelName, ...args)).toBe(expectedMsg);
    });

    it('returns correct message when args contains substitution string and ERROR level in open-ai-engine logger', () => {
        const timestampStr = new Date(2022, 0, 3, 23, 59, 59, 999).toISOString();
        const loggerName = 'open-ai-engine';
        const levelName: LogLevelNames = 'error';
        const args = ['%s arg1', 'arg2'];
        const expectedMsg = `${timestampStr} ${loggerName} ${levelName.toUpperCase()} %s arg1 arg2`;
        expect(augmentLogMsg(timestampStr, loggerName, levelName, ...args)).toBe(expectedMsg);
    });

    it('returns correct message when args is empty and TRACE level in shared-logging-setup logger', () => {
        const timestampStr = new Date(2022, 5, 4, 6, 28, 14, 357).toISOString();
        const loggerName = 'shared-logging-setup';
        const levelName: LogLevelNames = 'trace';
        const args: unknown[] = [];
        const expectedMsg = `${timestampStr} ${loggerName} ${levelName.toUpperCase()}`;
        expect(augmentLogMsg(timestampStr, loggerName, levelName, ...args)).toBe(expectedMsg);
    });
});


describe('assertIsValidLogLevelName', () => {
    test('throws error for invalid log level name', () => {
        const invalidLogLevelName = 'invalid';
        expect(() => assertIsValidLogLevelName(invalidLogLevelName)).toThrow(`Invalid log level name: ${invalidLogLevelName}`);
    });

    test('throws error for non-string log level name', () => {
        const nonStringLogLevelName = 123;
        expect(() => assertIsValidLogLevelName(nonStringLogLevelName)).toThrow(`Invalid log level name: ${nonStringLogLevelName}`);
    });

    test('throws error for "SILENT" log level name', () => {
        const silentLogLevelName = 'SILENT';
        expect(() => assertIsValidLogLevelName(silentLogLevelName)).toThrow(`Invalid log level name: ${silentLogLevelName}`);
    });

    test('throws error for uppercase log level name', () => {
        const uppercaseLogLevelName = 'DEBUG';
        expect(() => assertIsValidLogLevelName(uppercaseLogLevelName)).toThrow(`Invalid log level name: ${uppercaseLogLevelName}`);
    });

    test('does not throw error for any valid log level names', () => {
        const validLogLevelNames = Object.keys(log.levels).map(level => level.toLowerCase()).filter(level => level !== 'silent');
        validLogLevelNames.forEach(level => {
            expect(() => assertIsValidLogLevelName(level)).not.toThrow();
        });
    });
});