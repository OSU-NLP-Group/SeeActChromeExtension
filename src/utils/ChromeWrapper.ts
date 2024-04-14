

/**
 * @description A fake object type that can be used to attach the debugger to a tab.
 * This fake type was created because the real type is chrome._debugger.Debuggee, and the chrome._debugger
 * namespace isn't exported
 */
export interface FakeDebuggee {
    /** Optional. The id of the tab which you intend to debug.  */
    tabId?: number | undefined;
}


/**
 * @description class with thin wrappers around chrome extension API functions
 * This is a class so that it can be mocked in unit tests (should reduce complexity/brittleness of mocking in unit tests)
 * It should never have any mutable state
 */
export class ChromeWrapper {


    /**
     * Gets all tabs that have the specified properties, or all tabs if no properties are specified.
     * @param queryInfo specifies properties used to filter the set of returned Tabs.
     * @return all tabs that have the specified properties, or all tabs if no properties are specified.
     */
    fetchTabs = async (queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> => {
        return chrome.tabs.query(queryInfo);
    }

    /**
     * Captures the visible area of the currently active tab in the specified window. You must have <all_urls> 
     *     permission to use this method.
     * @return A data URL which encodes an image of the visible area of the captured tab. May be assigned to the 'src' 
     *          property of an HTML Image element for display.
     */
    fetchVisibleTabScreenshot = async (): Promise<string> => {return chrome.tabs.captureVisibleTab();}


    /**
     * Injects a script into a target context. The script will be run at document_end.
     * @param injection the details of the script which to inject.
     * @return The resulting array contains the result of execution for each frame where the injection succeeded.
     */
    runScript = async (injection: chrome.scripting.ScriptInjection<any[], unknown>):
        Promise<chrome.scripting.InjectionResult<unknown>[]> => {
        return chrome.scripting.executeScript(injection);
    }

    /**
     * Attaches debugger to the given target tab
     * @param target Debugging target to which you want to attach (in this case, always a tab)
     * @param requiredVersion Required debugging protocol version ("0.1"). One can only attach to the debuggee with
     * matching major version and greater or equal minor version. List of the protocol versions can be obtained in the
     * chrome documentation pages.
     * @return Promise that resolves with no arguments when the debugger has been attached
     */
    attachDebugger = (target: FakeDebuggee, requiredVersion: string): Promise<void> => {
        return chrome.debugger.attach(target, requiredVersion);
    }

    /**
     * Detaches debugger from the given target tab
     * @param target Debugging target to which you want to detach the debugger from (in this case, always a tab)
     * @return Promise that resolves with no arguments when the debugger has been detached
     */
    detachDebugger = (target: FakeDebuggee): Promise<void> => {
        return chrome.debugger.detach(target);
    }

    /**
     * Sends a command to the debugging target (tab)
     * Should only be used after attaching the debugger to the target and before detaching it
     * @param target Debugging target to which you want to send a command to (in this case, always a tab)
     * @param method name of the method from the Chrome DevTools Protocol
     * @param commandParams a json object with the arguments for the method
     * @return Promise that resolves with the result of the command
     */
    //eslint-disable-next-line @typescript-eslint/ban-types -- this is a chrome API function, so we can't change the type
    sendCommand = (target: FakeDebuggee, method: string, commandParams: Object|undefined): Promise<Object> => {
        return chrome.debugger.sendCommand(target, method, commandParams);
    }

    /**
     * Sends a single message to event listeners within your extension/ app or a different extension/ app. Similar to
     * runtime.connect but only sends a single message, with an optional response. If sending to your extension, the
     * runtime.onMessage event will be fired in each page, or runtime.onMessageExternal, if a different extension.
     * Note that extensions cannot send messages to content scripts using this method. To send messages to content
     * scripts, use tabs.sendMessage.
     * @param message the message object to send to the service worker
     * @return Promise that resolves with the response from the service worker
     */
    sendMessageToServiceWorker = <M = any, R = any>(message: M): Promise<R> => {
        return chrome.runtime.sendMessage(message);
    }


}
