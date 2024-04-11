# OsuNlpGrpSeeActChromeExtension

Chrome extension to allow end-users to leverage the logic/behavior of the Python code in the SeeAct repository (i.e.
just installing a chrome extension from chrome web store rather than having to install python and playwright locally and
then download/run SeeAct).

# Conventions

## Typescript

Files which export multiple utility methods will have all_lowercase names. Files which export a single class will have
PascalCase names.

## Testing

White-box as well as black-box types of unit tests (both using jest).

TODO if we decide to open-source this, b4 doing that, go through code and mark things private or something similar
wherever possible (to leave room for maneuver in later updates)

# Comments from manifest.json

```json
{
    "comment_on_permissions": "might want to revisit webNavigation, desktopCapture, sidePanel, storage (e.g. will need storage if given requirement for actual persistence of logs, but that might possibly open a whole can of worms in terms of user data/PII/privacy)"
}
```