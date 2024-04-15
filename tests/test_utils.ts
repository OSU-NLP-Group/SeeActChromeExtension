import { DOMWindow } from 'jsdom';


export function createMockPort(): chrome.runtime.Port {
    return {
        name: 'mockPort',
        disconnect: jest.fn(),
        onDisconnect: {
            hasListener: jest.fn(),
            hasListeners: jest.fn(),
            addRules: jest.fn(),
            getRules: jest.fn(),
            removeRules: jest.fn(),
            addListener: jest.fn(),
            removeListener: jest.fn()
        },
        onMessage: {
            hasListener: jest.fn(),
            hasListeners: jest.fn(),
            addRules: jest.fn(),
            getRules: jest.fn(),
            removeRules: jest.fn(),
            addListener: jest.fn(),
            removeListener: jest.fn()
        },
        postMessage: jest.fn(),
        sender: {
            tab: {
                id: 1,
                index: 0,
                windowId: 1,
                highlighted: false,
                active: true,
                pinned: false,
                status: 'complete',
                incognito: false,
                selected: true,
                discarded: false,
                autoDiscardable: true,
                groupId: -1
            },
            frameId: 0
        }
    };
}

/**
 * working around infuriating 8-yr-old gap in jsdom
 * @param testWindow jsdom window whose html elements need to realistically handle contenteditable attribute and
 *                      related properties
 */
export function fixHtmlElementContentEditable(testWindow: DOMWindow) {
    Object.defineProperty(testWindow.HTMLElement.prototype, 'contentEditable', {
        get: function() {
            return this.getAttribute('contenteditable');
        }
    });
    Object.defineProperty(testWindow.HTMLElement.prototype, 'isContentEditable', {
        get: function() {
            return this.getAttribute('contenteditable') === 'true';
        }
    });

}