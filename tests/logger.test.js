'use strict';

/**
 * tests/logger.test.js
 * D-1: 構造化ログ JSON 出力の検証
 */

const { logger } = require('../src/backend/lib/logger');

describe('logger (D-1)', () => {
    let logSpy, warnSpy, errorSpy;

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    test('info logs JSON with severity=INFO and message', () => {
        logger.info('hello', { requestId: 'abc' });
        expect(logSpy).toHaveBeenCalledTimes(1);
        const arg = logSpy.mock.calls[0][0];
        const parsed = JSON.parse(arg);
        expect(parsed.severity).toBe('INFO');
        expect(parsed.message).toBe('hello');
        expect(parsed.requestId).toBe('abc');
    });

    test('warn logs JSON with severity=WARNING via console.warn', () => {
        logger.warn('careful', { route: '/x' });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const arg = warnSpy.mock.calls[0][0];
        const parsed = JSON.parse(arg);
        expect(parsed.severity).toBe('WARNING');
        expect(parsed.message).toBe('careful');
    });

    test('error logs JSON with severity=ERROR and stack when Error passed', () => {
        const e = new Error('boom');
        logger.error(e, { route: '/y' });
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const arg = errorSpy.mock.calls[0][0];
        const parsed = JSON.parse(arg);
        expect(parsed.severity).toBe('ERROR');
        expect(parsed.message).toBe('boom');
        expect(parsed.stack).toContain('Error: boom');
        expect(parsed.route).toBe('/y');
    });

    test('error logs JSON when string passed (no stack)', () => {
        logger.error('plain string error', { tag: 'X' });
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const arg = errorSpy.mock.calls[0][0];
        const parsed = JSON.parse(arg);
        expect(parsed.severity).toBe('ERROR');
        expect(parsed.message).toBe('plain string error');
        expect(parsed.tag).toBe('X');
    });
});
