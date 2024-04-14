import { Mutex } from "async-mutex";
import {SerializableElementData} from "./BrowserHelper";
import Port = chrome.runtime.Port;
import { Logger } from "loglevel";
import {createNamedLogger} from "./shared_logging_setup";
import {OpenAiEngine} from "./OpenAiEngine";


enum AgentControllerState {
    IDLE,//i.e. no active task
    WAITING_FOR_CONTENT_SCRIPT_INIT,//there's an active task, but injection of content script hasn't completed yet
    ACTIVE,//partway through an event handler function
    WAITING_FOR_ELEMENTS,// waiting for content script to retrieve interactive elements from page
    WAITING_FOR_ACTION,//waiting for content script to perform an action on an element
    PENDING_RECONNECT//content script disconnected, but waiting for new connection to be established when the onDisconnect listener gets to run
}


type ActionInfo = { elementIndex?: number, elementData?: SerializableElementData, action: string, value?: string };

//todo jsdoc
export class AgentController {
    readonly mutex = new Mutex();

    private taskId: string | undefined = undefined;
    private taskSpecification: string = "";
    private currTaskTabId: number | undefined;


    private tentativeActionInfo: ActionInfo | undefined;
    private mightNextActionCausePageNav: boolean = false;

    private actionsSoFar: { actionDesc: string, success: boolean }[] = [];

    private state: AgentControllerState = AgentControllerState.IDLE;

    private currPortToContentScript: Port | undefined;
    private aiEngine: OpenAiEngine;
    readonly logger: Logger;

    constructor(aiEngine: OpenAiEngine, logger?: Logger) {
        this.aiEngine = aiEngine;

        this.logger = logger ?? createNamedLogger('agent-controller', true);
    }


}








