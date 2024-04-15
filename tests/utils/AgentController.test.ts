

describe('AgentController.injectPageActorScript', () => {
    //todo setup

    //todo 1 case where tab already provided but contains undefined tab id, and not start of task and sendResponse undefined

    //todo 1 case where tab is already provided with defined tab id, not start of task and sendResponse undefined, and tab id is equal to currTaskTabId, but error when injecting script

    //todo 1 case where tab is already provided with defined tab id, not start of task and sendResponse undefined, and tab id is not equal to currTaskTabId, but mightNextActionCausePageNav is true, so inject script

    //todo 1 case where tab not provided (is start of task, sendResponse defined), but error when getting tab so end early

    //todo 1 case where tab not provided, tab info is retrieved (containing tab id), and not start of task and sendResponse undefined, and tab id is not equal to currTaskTabId, and mightNextActionCausePageNav is false

    //todo 1 case where tab not provided, is start of task, sendResponse defined, and tab info is retrieved (containing undefined tab id)

    //todo 1 case where tab not provided, is start of task, sendResponse defined, and tab info is retrieved (containing defined tab id), so inject script

    //todo 1 case where tab not provided, is start of task, sendResponse defined, and tab info is retrieved (containing defined tab id), but error when injecting script
});

describe('AgentController.startTask', () => {
    //todo setup

    //todo case where taskId is defined so send error resp

    //todo case where taskId was undefined and successfully call injectPageActorScript

    //todo case where taskId was undefined and error when calling injectPageActorScript
});

describe('AgentController.processPageActorInitialized', () => {
    //todo setup

    //todo case where state is not waiting for content script init

    //todo case where state is waiting for content script init and sending response succeeds

    //todo case where state is waiting for content script init and sending response fails with standard "port disconnection" error

    //todo case where state is waiting for content script init and sending response fails with non-standard error
});

describe('AgentController.processPageStateFromActor', () => {
    //todo

    //todo will fill this out after it's been restructured/broken-up (which will be after/part-of adding the "skip element listing/selection if LLM indicates in planning output that it wants to do a non-element-based action" feature)

});

describe('AgentController.processActionPerformedConfirmation', () => {
    //todo setup

    //todo case where state is not waiting for action

    //todo one case where mightNextActionCausePageNav is true but tab id is same as currTaskTabId, and just request page state (which goes without error)
    // where message.result undefined but tentativeActionInfo defined

    //todo one case where mightNextActionCausePageNav is true but tab id is same as currTaskTabId, and request page state but routine "port disconnection" error
    // where message.result undefined and tentativeActionInfo undefined

    //todo one case where mightNextActionCausePageNav is false, and request page state but weird/unexpected error
    // where message.result is defined

    //todo one case where mightNextActionCausePageNav is true and tab id is different from currTaskTabId, and inject script
    // where message.result is defined
});

describe('AgentController.handlePageMsgToAgentController', () => {
    //todo setup

    //todo case where request's message is READY

    //TODO case where request's message is PAGE_STATE

    //todo case where request's message is ACTION_DONE

    //todo case where request's message is TERMINAL

    //todo case where request's message is unknown type
});

describe('AgentController.processActorDisconnectDuringAction', () => {
    //todo setup

    //todo case where tentativeActionInfo undefined, so early end

    //todo case where mightNextActionCausePageNav is true but tab id is same as currTaskTabId, and just inject script

    //todo case where mightNextActionCausePageNav is true and tab id is different from currTaskTabId, and inject script

    //todo case where mightNextActionCausePageNav is false and tab id is same, then inject script
});

describe('AgentController.handlePageDisconnectFromAgentController', () => {
    //todo setup

    //todo case where state is waiting for action

    //todo case where state is pending reconnect

    //todo case where state is something else (so terminate task)
});

describe('AgentController.killPageConnection', () => {
    //todo

    //todo happy path where port is defined, removing controller's listener leaves no others, and disconnect succeeds

    //todo case where  port is defined, removing controller's listener leaves others, and disconnect fails with strange error during disconnect()

    //todo case where port is defined but trying to disconnect yields "port already disconnected" error
});

describe('AgentController.terminateTask', () => {
    //todo setup

    //todo case where port is already undefined

    //todo case where port is defined, and disconnect succeeds
});

describe('AgentController.getActiveTab', () => {
    //todo setup

    //todo case where error when fetching tabs

    //todo case where no tabs found

    //todo case where tab id not defined

    //todo case where tab id defined but url starts with chrome://, so return tab with undefined tab id

    //todo happy path where tab is returned (complete with defined tab id)
});

describe('AgentController.sendEnterKeyPress', () => {
    //todo single happy-path test case (for now, until press_sequentially type functionality is implemented)
});

