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
    "comment_on_permissions": "might want to revisit webNavigation, desktopCapture, tabs, sidePanel, ; also, remove debugger permission before release",
    "comment_on_host_permissions": "maybe give <all_urls> if/when we want SeeAct agent to be able to move off the current website and/or look things up in a separate tab partway through a process; would also need to do that and nix activeTab if activeTab doesn't cover navigation within the current website"
}
```