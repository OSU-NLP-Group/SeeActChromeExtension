For privacy fields of the Chrome Web Store submission form
https://developer.chrome.com/docs/webstore/cws-dashboard-privacy

## Single Purpose
The sole purpose of this extension is to allow users to more easily play around with AI agents that act in web browsers. In that vein, we may in future add a secondary feature that would make it easier for the user could manually collect/label/download information about actions in webpages that would be unsafe for web agents to perform without human oversight. However, this secondary feature would not increase personal data collection.  

## Permissions Justification

### scripting

The extension needs to be able to inject a content script into the current tab during the task for several reasons.

1. The frontier AI models are still not remotely good enough at spatial or visual reasoning to be able to identify the correct elements on a webpage to interact with just based on the screenshot, so we have to also provide filtered information about the HTML elements on the page.  
2. It's markedly faster and less visually disruptive if we implement the AI model's actions on the page using JavaScript rather than the Chrome debugger API where possible.
3. For more clarity about what the AI model is doing (both in the moment and when reviewing screenshots after the fact), we need to be able to highlight the element that the AI model is about to interact with.

### debugger

Some forms of interaction between a human user and a webpage (e.g. pressing enter, or hovering over an element) cannot be mimicked with JavaScript alone, so we need to be able to use the Chrome debugger API to interact with the page in those cases.
Similarly, sometimes using Javascript to click something or type into a field won't work, and so we may in future also need to use the debugger API to interact with the page in those cases. 

### tabs

We need to be able to ask the browser what the active tab is, so that we can inject the extension's content script into the correct tab when the user starts a task (or when the performing of a task causes page navigation).  
Also, without this, the extension would not be able to visually show the AI _Vision_-Language Model (aka LMM, Large _Multimodal_ Model) what the page currently looks like. The whole motivation for the " _See_ Act" project would be undermined.  
Finally, this is necessary to create a 'welcome' page on installation, which is particularly necessary so that users can be clearly informed if something goes wrong during installation (solely storing the error message in the Chrome Extensions management menu would not be very user-friendly).

### storage

This is needed to store the user's configuration choices for the extension.

### sidePanel

This is needed to create a side panel for the extension, which is necessary for the user to be able to interact with the extension.

### alarms

This is needed to schedule the regular task of cleaning up old screenshots and logs from the browser's IndexedDB (which both averts the waste of the user's hard drive space and reduces privacy risks).  
It also proved necessary for ensuring that the service worker doesn't get killed _while the side panel is open_ but not in use (because it being killed would slow the responsiveness of the side panel when the user next tried to interact with it). 

### host_permissions: ["<all_urls>"]
For the extension to be able to handle nontrivial tasks, it must be able to deal with the case where clicking on a link
opens a page in a new tab. If it only had the "activeTab" permission, attempting to inject the content script into the new tab right away would fail.

Also, the method `chrome.tabs.captureVisibleTab()` requires not only the tabs permission but also this `<all_urls>` permission, and the importance of being able to take screenshots of the current tab was explained in the [tabs](#tabs) section.

## Data Use Practices Certification

pretty much all of them? or possibly just "website content"; not sure what they want


## Privacy Policy
https://github.com/OSU-NLP-Group/SeeAct/blob/main/chrome_extension/privacy_policy.pdf
