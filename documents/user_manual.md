# End-User Manual for SeeAct Chrome Web Agent

## Table of Contents
1. [Introduction](#introduction)
2. [Initial Setup](#initial-setup)
3. [Extension Tips](#extension-tips)
4. [Using the Extension to Annotate Unsafe Actions](#using-the-extensions-unsafe-action-annotation-feature)
5. [Troubleshooting](#troubleshooting)
6. [Configuration](#configuration)
7. [Feedback](#feedback)
8. [Contributing](#contributing)
9. [License](#license)
10. [Privacy Policy](#privacy-policy)
11. [Acknowledgements](#acknowledgements)

## Introduction

The SeeAct Chrome Web Agent is a powerful browser extension that allows you to collect information about unsafe actions in web pages.

## Initial Setup
Once the extension is loaded into Chrome, please follow steps 3-4 of the README's [installation instructions](https://github.com/OSU-NLP-Group/SeeActChromeExtension/blob/main/README.md#end-users-of-chrome-extension) to prepare the extension for use (steps 6-9 of the exhaustive walkthrough).  
With the annotator-mode-only version of the extension, you don't need to touch the options menu at all unless you want to change the log level.

## Extension tips
Many UI elements (in side panel and options menu) have more explanation of their purpose and behavior in the form of
tooltips that appear when hovering over the elements' labels.

Also, text blocks in the side panel (some of the temporary status messages) will have tooltips with more detail when you hover over them.

## Using the Extension's 'Unsafe Action Annotation' Feature
Please see [this separate document](https://github.com/OSU-NLP-Group/SeeActChromeExtension/blob/main/documents/How_to_annotate_state_changing_actions_with_SeeAct_Chrome_Extension.pdf).

## Troubleshooting

### Possible fixes for rare/extreme issues:

1. **The extension isn't responding**:
    - Try closing and reopening the side panel
    - If problems persist, try disabling and re-enabling the extension

If you encounter persistent issues, please check the ["Feedback" section](#feedback) for ways to report problems.

## Configuration

Access the configuration menu by clicking the "Options" button in the side panel.

- **Log Level**: Control the detail level of logs (useful for troubleshooting)

If you aren't sure what a setting (or an option in a dropdown) does, hover over the option's label (or the dropdown option) for an explanation.

## Feedback

We value your input! If you encounter issues, have suggestions, or want to share your experience, the best avenue is creating a GitHub Issue in the extension's [repository](https://github.com/OSU-NLP-Group/SeeActChromeExtension/issues).

This enables easier tracking of issues and makes them visible to other users who may have similar problems. It requires creating a (free) Github account but does not require any coding knowledge.

If you're unable to use GitHub, you can also just email your feedback to the extension's developers at salisbury.100@buckeyemail.osu.edu . Please be aware that this method may take longer to receive a response.

In general, please provide as much detail as you can about the issue you're facing. This includes:
- The steps you took before encountering the issue
- A description of the problematic behavior
- A copy of the annotation batch file if possible, with any sensitive information redacted
  - If the annotation batch involved any pages containing sensitive personal information, this may require unzipping the file and redacting those parts of the screenshots and HTML files inside (e.g. using Paint or Notepad), then re-zipping the folder
  - We understand that this may not be feasible for people who are not fully comfortable with non-typical uses of computers. 
- The log file produced by clicking the 'Download misc logs' button in the side panel shortly after the issue occurred
  - This may also contain sensitive data that needs to be redacted

In general, it may be safer to provide the zip file and log file to the developers via email after creating the Github issue (rather than posting them to the publicly visible Github issue). When doing so, please include the Github issue number in the email.

## Contributing

If you're interested in contributing to the development of the SeeAct Chrome Web Agent, please fork the extension's [GitHub repository](https://github.com/OSU-NLP-Group/SeeActChromeExtension), commit your changes in the fork, and make a pull request back to the main repository.

If you contribute to the project, you agree to license your contributions under the [Open RAIL-S](https://www.licenses.ai/ai-pubs-open-rails-vz1) license. You also agree to follow the [SeeAct project's code of conduct](https://github.com/OSU-NLP-Group/SeeAct/blob/main/CODE_OF_CONDUCT.md)

## License

This extension is made available to users under an [Open RAIL-S](https://www.licenses.ai/ai-pubs-open-rails-vz1) license.

## Privacy Policy

Please see the [full privacy policy](https://github.com/OSU-NLP-Group/SeeActChromeExtension/blob/main/documents/privacy_policy.pdf). This can also be accessed from a link at the bottom of the extension's Options menu.

## Acknowledgements

This extension is built on top of the [SeeAct](https://github.com/OSU-NLP-Group/SeeAct/tree/main) project, with guidance and supervision from Boyuan Zheng and Professor Yu Su of The Ohio State University's NLP Group.

The 'unsafe action annotation' feature is an implementation of ideas that were originated by Professor Yu Su & Ziyu (Maggie) Huan and then refined by Boyuan Zheng, Zeyuan Liu, and Scott Salisbury.  
Additionally, the 'unsafe action annotation' feature's implementation was refined based on feedback from beta users Alvin Huang, Cloudy Zheng, Lee A. Davis, Michael Lin, Xiaolong Jin, Zeyuan Liu, and Zheng Du.

A majority of the logic for identifying interactive UI elements, collecting information about them, formatting that information in LLM prompts, and generally structuring the LLM prompts is ported from that project's Python code.   
The 'monitor mode' feature's design was also based on that project (although the UI, keyboard shortcuts, and text-feedback-field are new).  

This project of course benefits from a number of open-source libraries, from `idb` and `jszip` to `async-mutex` and `get-xpath`.

Finally, of course, the actual AI brains behind this extension's web agent functionality are provided by OpenAI, Anthropic, and Google DeepMind.
