# SeeActChromeExtension

Chrome extension to allow end-users to leverage the logic/behavior of the Python code in 
the [SeeAct repository](https://github.com/OSU-NLP-Group/SeeAct/tree/main) (i.e. just loading a chrome extension 
rather than having to install python and playwright locally and then download/run SeeAct). It also allows them to use 
their own login sessions (since it runs in their existing Chrome window/tab rather than in a separate/playwright-created 
browser window).

# Setup

## End users of Chrome extension

A prepared zip file of each official version of the extension can be found in the [releases section](https://github.com/BareBeaverBat/SeeActChromeExtension/releases) of this repo.
Once you download the zip file for a version of your choice, you can extract its contents to a folder on your computer.
![unzipping archive](images/unzipping.png)

The below installation instructions err on the side of excessive detail on the theory that people for whom this is excessive
can probably figure out most of the installation process without this guide. Click [here](#developers) to jump past this

Once you have extracted the contents of the release zip, please follow these steps to load the extension into Chrome:
1. Open a new tab in Chrome.
2. Enter "chrome://extensions" in the address bar and press Enter.
3. Ensure that the "Developer mode" switch in the upper right corner is turned on.
4. Click the "Load unpacked" button.
   ![button for loading extension](images/click_load_unpacked.png)
5. Navigate to the dist folder in the release zip and click the "Select Folder" button.
   ![Loading dist folder into Chrome](images/loading_dist_into_chrome.png)
6. In the resulting "installation greeting" page, review the privacy policy and license agreement, then click the "I agree ..." button at the bottom to enable the extension's functionality.
   ![Accepting Privacy Policy and License Agreement](images/accepting_privacy_policy.png)
7. Click on the "Extensions" puzzle-piece icon near upper right corner of window
   ![Opening Extensions dropdown](images/opening_extensions_dropdown.png)
8. Click the pin icon next to the "SeeAct Web Agent for Chrome" extension to make its icon show up in the browser's upper right corner.
   ![Pin extension to toolbar](images/pinning_extension.png)
9. Click the extension's icon (robot next to monitor) to open the extension's side-panel.
   ![Opening extension's side panel](images/open_side_panel.png)
10. Open the Options menu by clicking the button with that name in lower left corner of the side panel
    ![Opening options menu](images/open_options_menu.png)
11. If you intend to use the web agent functionality, choose an AI provider and enter your API key for that provider's API
- If you don't have an API key, you can get one from the provider's website after making an account with them (note that this would be a separate account from any account you may have already made for use of that company's chatbot page):
 - [OpenAI](https://platform.openai.com/signup)
 - [Anthropic](https://console.anthropic.com/)
 - [Google DeepMind](https://ai.google.dev/gemini-api/docs/api-key/)
 ![Entering OpenAI API key](images/set_ai_api_key.png)
12. Save the options changes with the "Save" button
    ![Saving options changes](images/save_options_changes.png)

## Developers
Clone the repository to your local machine and run `npm install` (in a shell where the repository's root directory is the current working directory) to install the necessary dependencies.

# Usage
Many UI elements (in side panel and options menu) have more explanation of their purpose and behavior in the form of
tooltips that appear when hovering over the elements' labels.

Also, text blocks in the side panel (under "Action History" or "Pending Action" headings, plus some of the temporary status messages that appear just above the "Pending Action" section) 
will have tooltips with more detail when you hover over them.

Please see the [user manual](user_manual.pdf) for more details.

## Logs
For a given task, almost all of the logs related to it will have been associated with its task id and will be automatically
exported upon task termination (whether by task-completion, error, or user intervention) to a zip file in the downloads folder (along with screenshots and a few summary json files about the task).

However, logs related to the options menu will only be accessible by clicking the "Download misc logs" button near the bottom right corner of the side panel.

Likewise, logs related to a batch of annotations of unsafe actions will only be accessible by clicking the "Download misc logs" button.

Also, more troublesomely, a handful of the first logs that're conceptually/temporally related to a task and several of the last logs that're conceptually/temporally related to a task will not be associated with the task id and will not be exported in that task's zip file. These logs can be found based on timestamp in the "non-task-specific" logs export by clicking the "Export non-task-specific logs" button (in the upper right corner of the side panel) again a bit after the task ended.

# Conventions

## Typescript

Files which export multiple utility methods will have all_lowercase names. Files which export a single main class will 
have PascalCase names.

## Testing

White-box as well as black-box types of unit tests (both using jest).

## Logging

TRACE log level has the same meaning as in Java/C#/etc, not the meaning it has in JavaScript console.trace() (which prints out 
a stack trace to the calling line of code)

Use WARN for problems from user input or AI model outputs being bad (even if those problems cause task failure)  
Only use ERROR if one of the assumptions/expectations in the extension's design is violated (e.g. unexpected type of 
error, controller is in a particular state at a point in code execution where that shouldn't be possible, etc.)

Some timestamps are higher precision (5 to 100 microseconds precision rather than 1 millisecond precision). They use the
Performance browser API. Please [beware](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#description) 
possible confusion from system clock adjustments (e.g. DST) or clock skew when comparing high-precision vs normal timestamps.

Regex for finding log messages that are trying to tell the developer about something unexpected but not necessarily bad that happened:  
```regexp
([A-Z]+)( [A-Z]+)+
```

## Developer notes

I'm using ".58495" (as a 4th number in the chrome extension version in the manifest.json) to indicate that the current
unpacked extension install is a snapshot version (not an official/finalized release). This is needed because the
version number in the chrome extension's manifest.json file must be a string that matches the regex
`^(\d+(\.\d+){0,3})$` (i.e. up to 4 numbers separated by periods).

The official distributed zip files are being named like this `SeeActChromeExtension-A-B-C.zip`
and the snapshot distributed zip files like this `SeeActChromeExtension-A-B-C-SOMETHING-SNAPSHOT-#.zip`
where A, B, and C are the major, minor, and patch version numbers respectively. The SOMETHING part is a string that
provides context about the reason for the creation of the snapshot zip file, and the # is a number that is incremented 
each time a new snapshot zip file is created for the same troubleshooting purpose.


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
