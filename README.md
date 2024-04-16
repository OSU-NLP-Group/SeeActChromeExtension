# OsuNlpGrpSeeActChromeExtension

Chrome extension to allow end-users to leverage the logic/behavior of the Python code in the SeeAct repository (i.e.
just installing a chrome extension from chrome web store rather than having to install python and playwright locally and
then download/run SeeAct).

TODO consider replacing "utils" folder with front, back, and shared folders

# Conventions

## Typescript

Files which export multiple utility methods will have all_lowercase names. Files which export a single class will have
PascalCase names.

## Testing

White-box as well as black-box types of unit tests (both using jest).

TODO if we decide to open-source this, b4 doing that, go through code and mark things private or something similar
wherever possible (to leave room for maneuver in later updates)

## Logging

TRACE log level has the same meaning as in java/c#/etc, not the meaning it has in js console.trace() (which prints out a stack trace to the calling line of code)

Use WARN for problems from user input or ai model outputs being bad (even if those problems cause task failure)  
Only use ERROR if one of the assumptions/expectations in the extension's design is violated (e.g. unexpected type of error, controller is in a particular state at a point in code execution where that shouldn't be possible, etc.)


# Comments from manifest.json

```json
{
    "comment_on_permissions": "might want to revisit webNavigation, desktopCapture, sidePanel, storage (e.g. will need storage if given requirement for actual persistence of logs, but that might possibly open a whole can of worms in terms of user data/PII/privacy)"
}
```