
/**
 * @description class with thin wrappers around chrome extension API functions
 * This is a class so that it can be mocked in unit tests (should reduce complexity/brittleness of mocking in unit tests)
 * It should never have any mutable state
 */
export class ChromeWrapper {


    //todo chrome.tabs.query() for AgentController.getActiveTab()

    //todo chrome.tabs.captureVisibleTab() for AgentController.processPageStateFromActor()

    //todo chrome.scripting.executeScript() for AgentController.injectPageActorScript()

    //todo chrome.debugger.attach/sendCommand/detach for AgentController.sendEnterKeyPress()

    //todo chrome.runtime.sendMessage() for PageActor.performPressEnterAction()



}
