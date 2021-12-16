import { TextEncoder } from 'util';
import { TX_CACHE } from './__txcache__';
import { WS_CACHE } from './__wscache__';
import { MockedWorker } from './__wscache__/worker';

jest.setTimeout(20000);

// Always mock blockchain-link worker unless it's explicitly required not to.
if (process.env.TESTS_USE_WS_CACHE !== 'false') {
    jest.mock('tiny-worker', () => ({
        __esModule: true,
        default: MockedWorker,
    }));
}

global.TestUtils = {
    ...global.TestUtils,
    TX_CACHE,
    WS_CACHE,
};

// TextEncoder is global in Node v11 and browsers but not currently in jsdom https://github.com/jsdom/jsdom/issues/2524
// TODO: Remove when supported by jsdom/jest https://github.com/facebook/jest/issues/9983
global.TextEncoder = TextEncoder;
