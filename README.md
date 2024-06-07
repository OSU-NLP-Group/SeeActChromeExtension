# OsuNlpGrpSeeActChromeExtension

Chrome extension to allow end-users to leverage the logic/behavior of the Python code in the SeeAct repository (i.e.
just installing a chrome extension from chrome web store rather than having to install python and playwright locally and
then download/run SeeAct). It also allows them to use their own login sessions (since it runs in their existing Chrome
window/tab rather than in a separate/playwright-created browser window).

# Setup

The zip of this repo included the dist folder for ease of installing the built extension. However, the zip omits the 
node_modules folder as it's irrelevant for quick installation.
![unzipping archive](images/unzipping.png)

Once you have extracted the contents of the repo, please follow these steps to load the extension into Chrome:
1. Open a new tab in Chrome.
2. Enter "chrome://extensions" in the address bar and press enter.
3. Ensure that the "Developer mode" switch in the upper right corner is turned on.
4. Click the "Load unpacked" button.
![button for loading extension](images/setup_step4.png)
5. Navigate to the dist folder in the extracted contents of the repo, and click the "Select Folder" button.
![Loading dist folder into Chrome](images/loading_dist_into_chrome.png)
6. Switch to another tab and click on the "Extensions" puzzle-piece icon near upper right corner of window
![Opening Extensions dropdown](images/setup_step6.png)
7. Click the pin icon next to the "SeeAct Web Agent for Chrome" extension to make its icon show up in the browser's upper right corner. 
![Pin extension to toolbar](images/pinning_extension.png)

# Usage

## Opening the Extension's DevTools Window
1. Open a new tab in Chrome.
2. Enter "chrome://extensions" in the address bar and press enter.
3. Find the "SeeAct Web Agent for Chrome" extension in the list of extensions.
4. There will be a line "Inspect views: service worker"; with the "service worker" part being a link. Click that link.
![Inspecting Service Worker](images/open_service_worker_console.png)

TODO add updated screenshots that reflect side-panel-based ui
## Starting a Task
1. To ensure that the browser's focus is in the appropriate tab, please click somewhere in the tab which you want the 
agent to act in, just before starting a task.
2. Click the extension's icon (robot next to monitor) to open the extension's side-panel.
3. Type a task description into the "Task Specification" text box and click the "Start Task" button.  

Please be sure not to click anything outside of the web agent's window/tab while a task is running, as this
will cause an error and the task will be terminated.


## Terminating a Task
If the agent does something undesirable, becomes stuck in a loop, goes in a non-viable direction, etc.,
you can terminate the task by clicking the "Terminate Task" button in the side panel.

## Hover Action

In order for the agent to be able to perform a hover action, the user's actual mouse cursor must be moved outside the
bounds of the window which the web agent is operating in, immediately after the "start task" button had been clicked 
in the extension's side panel.

# Conventions

## Typescript

Files which export multiple utility methods will have all_lowercase names. Files which export a single main class will 
have PascalCase names.

## Testing

White-box as well as black-box types of unit tests (both using jest).

## Logging

TRACE log level has the same meaning as in java/c#/etc, not the meaning it has in js console.trace() (which prints out 
a stack trace to the calling line of code)

Use WARN for problems from user input or AI model outputs being bad (even if those problems cause task failure)  
Only use ERROR if one of the assumptions/expectations in the extension's design is violated (e.g. unexpected type of 
error, controller is in a particular state at a point in code execution where that shouldn't be possible, etc.)

Some timestamps are higher precision (5 to 100 microseconds precision rather than 1 millisecond precision). They use the
Performance browser API. Please [beware](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#description) 
possible confusion from system clock adjustments (e.g. DST) or clock skew when comparing high-precision vs normal timestamps.



## Developer notes

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
