TODO consider replacing "utils" folder with frontend, serviceworker, and shared folders


TODO explore use of desktopCapture permission when adding support for voice input during tasks

TODO really need to standardize naming conventions for certain entities at some point (not just variable/enum-entry names but also comments and strings like log messages)
- agent controller in background script- "Controller"/"AgentController"/"ServiceWorker"/"Background"
- page actor in content script- "Actor"/"Page"/"PageActor"/"ContentScript"
- manager in side panel- "SidePanelManager"/"Panel"/"SidePanel"
- task_history_entry vs action_performed_record  etc.
- etc.


Open question for chrome.debugger api: how to handle the case where the tab is already being
debugged by another extension? tell the LLM that it can't use HOVER for now and must try to click instead?
